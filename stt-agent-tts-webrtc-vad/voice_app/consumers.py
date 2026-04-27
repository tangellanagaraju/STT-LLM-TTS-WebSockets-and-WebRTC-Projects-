import json
import base64
import tempfile
import os
import logging
import asyncio
from channels.generic.websocket import AsyncWebsocketConsumer
from openai import AsyncOpenAI
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRecorder
from .models import ConversationSession, Message
from asgiref.sync import sync_to_async

logger = logging.getLogger(__name__)

def get_openai_client():
    api_key = os.environ.get("OPENAI_API_KEY", "")
    return AsyncOpenAI(api_key=api_key) if api_key else None

def get_temp_file():
    fd, name = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    return name

class VoiceConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        """Initializes the connection and creates a fresh state."""
        self.client = get_openai_client()
        self.session_id = None
        self.pc = None
        self.audio_track = None
        self.recorder = None
        self.temp_filename = None
        
        # State: IDLE, RECORDING, PROCESSING, SPEAKING
        self.state = "IDLE" 
        self.pending_utterance = False
        
        # In-memory history for quick context
        self.message_history = [
            {"role": "system", "content": "You are a helpful and concise voice assistant. Short answers only."}
        ]

        await self.accept()
        status_msg = "Neural Link Ready." if self.client else "API Key Missing."
        await self.send(json.dumps({"type": "info", "message": status_msg}))

    async def disconnect(self, close_code):
        await self._cleanup()

    async def _cleanup(self):
        """Standard cleanup for WebRTC and temp files."""
        if self.recorder:
            try: await self.recorder.stop()
            except: pass
            self.recorder = None
        if self.pc:
            try: await self.pc.close()
            except: pass
            self.pc = None
        if self.temp_filename and os.path.exists(self.temp_filename):
            try: os.remove(self.temp_filename)
            except: pass

    async def receive(self, text_data=None):
        """Main router for incoming WebSocket signals."""
        if not text_data: return
        data = json.loads(text_data)
        m_type = data.get("type")

        if m_type == "init_session":
            await self._handle_init_session(data)
        elif m_type == "offer":
            await self._handle_offer(data)
        elif m_type == "speech_start":
            await self._handle_speech_start()
        elif m_type == "speech_end":
            await self._handle_speech_end()
        elif m_type == "tts_start":
            self.state = "SPEAKING"
        elif m_type == "tts_end":
            self.state = "IDLE"
            await self.send(json.dumps({"type": "ready"}))
            if self.pending_utterance: # Process user speech that happened during AI response
                self.pending_utterance = False
                asyncio.create_task(self._process_audio())
        elif m_type == "stop_session":
            await self._cleanup()
            self.state = "IDLE"

    async def _handle_init_session(self, data):
        """Loads or creates a user session."""
        sid = data.get("session_id")
        if sid:
            try:
                session = await sync_to_async(ConversationSession.objects.get)(id=sid)
                self.session_id = str(session.id)
                msgs = await sync_to_async(list)(Message.objects.filter(session=session).order_by("timestamp")[:15])
                for m in msgs: self.message_history.append({"role": m.role, "content": m.content})
            except: pass
        else:
            session = await sync_to_async(ConversationSession.objects.create)()
            self.session_id = str(session.id)
            await self.send(json.dumps({"type": "session_created", "session_id": self.session_id}))

    async def _handle_offer(self, data):
        """Establishes WebRTC Peer Connection."""
        self.pc = RTCPeerConnection()
        @self.pc.on("track")
        def on_track(track):
            if track.kind == "audio":
                self.audio_track = track

        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=data["sdp"], type="offer"))
        answer = await self.pc.createAnswer()
        await self.pc.setLocalDescription(answer)
        await self.send(json.dumps({"type": "answer", "sdp": self.pc.localDescription.sdp}))

    async def _handle_speech_start(self):
        """Starts recording the audio track locally."""
        if not self.audio_track: return
        
        if self.recorder:
            try: await self.recorder.stop()
            except: pass
        
        self.temp_filename = get_temp_file()
        self.recorder = MediaRecorder(self.temp_filename)
        self.recorder.addTrack(self.audio_track)
        await self.recorder.start()
        self.state = "RECORDING" if self.state == "IDLE" else self.state

    async def _handle_speech_end(self):
        """Stops recording and triggers processing."""
        if not self.recorder: return
        try:
            await self.recorder.stop()
            self.recorder = None
        except: pass
        
        if self.state == "RECORDING":
            self.state = "PROCESSING"
            asyncio.create_task(self._process_audio())
        elif self.state in ("PROCESSING", "SPEAKING"):
            self.pending_utterance = True # User spoke during AI, queue it

    async def _process_audio(self):
        """The AI Pipeline: STT -> LLM -> TTS."""
        fname = self.temp_filename
        if not fname or not os.path.exists(fname) or os.path.getsize(fname) < 4000:
            self.state = "IDLE"; await self.send(json.dumps({"type": "ready"})); return

        try:
            # 1. Transcription (Whisper)
            with open(fname, "rb") as f:
                ts = await self.client.audio.transcriptions.create(model="whisper-1", file=f)
            
            user_text = ts.text.strip()
            if not user_text:
                self.state = "IDLE"; await self.send(json.dumps({"type": "ready"})); return
            
            await self.send(json.dumps({"type": "transcription", "text": user_text}))
            
            # 2. Reasoning (GPT-4o)
            resp = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=self.message_history + [{"role": "user", "content": user_text}]
            )
            ai_text = resp.choices[0].message.content.strip()
            
            self.message_history.append({"role": "user", "content": user_text})
            self.message_history.append({"role": "assistant", "content": ai_text})
            
            # 3. Voice Synthesis (TTS)
            tts = await self.client.audio.speech.create(model="tts-1", voice="nova", input=ai_text)
            
            await self.send(json.dumps({
                "type": "ai_response",
                "text": ai_text,
                "audio": base64.b64encode(tts.content).decode()
            }))
            
            if self.session_id:
                asyncio.create_task(self._save_to_db(user_text, ai_text))
                
        except Exception as e:
            logger.error(f"AI Pipeline Error: {e}")
            self.state = "IDLE"; await self.send(json.dumps({"type": "ready"}))
        finally:
            if fname and os.path.exists(fname):
                try: os.remove(fname)
                except: pass

    async def _save_to_db(self, user_text, ai_text):
        """Saves message pair to database asynchronously."""
        await sync_to_async(Message.objects.create)(session_id=self.session_id, role="user", content=user_text)
        await sync_to_async(Message.objects.create)(session_id=self.session_id, role="assistant", content=ai_text)
