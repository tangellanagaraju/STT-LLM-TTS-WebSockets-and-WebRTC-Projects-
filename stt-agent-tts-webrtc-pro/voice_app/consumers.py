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

# Configure logging to monitor the system events
logger = logging.getLogger(__name__)

def get_openai_client():
    """Initializes the OpenAI client using the environment's API key."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    return AsyncOpenAI(api_key=api_key) if api_key else None

def get_temp_file():
    """Creates a unique temporary file path for incoming audio data."""
    fd, name = tempfile.mkstemp(suffix=".wav")
    os.close(fd) # Close file descriptor; we'll re-open it with standard Python IO
    return name

class VoiceConsumer(AsyncWebsocketConsumer):
    """
    Manages the real-time interaction between the user browser and the AI pipeline.
    This class handles:
    1. Signaling for WebRTC connection.
    2. Dynamic recording of user audio based on VAD signals.
    3. The AI Processing Pipeline (Speech-to-Text -> LLM -> Text-to-Speech).
    """

    async def connect(self):
        """Called when a new WebSocket connection is established from the client."""
        self.client = get_openai_client()
        self.session_id = None
        self.pc = None              # WebRTC Peer Connection
        self.audio_track = None     # The remote audio track from the microphone
        self.recorder = None        # aiortc tool to record audio track to a file
        self.temp_filename = None   # Current recording filename
        
        # State Management: IDLE, RECORDING, PROCESSING, SPEAKING
        # Prevents capturing audio if the AI is still talking or processing.
        self.state = "IDLE" 
        self.pending_utterance = False
        
        # System instructions given to the AI to define its personality/behavior.
        self.message_history = [
            {"role": "system", "content": "You are Stellaris, a highly intelligent and efficient AI voice assistant. Provide clear, direct, and concise solutions. Avoid internal monologue or conversational filler. Always respond in a professional and helpful tone."}
        ]

        await self.accept() # Complete the WebSocket handshake
        
        status_msg = "Stellaris Online. Systems Active." if self.client else "API Key Missing."
        await self.send(json.dumps({"type": "info", "message": status_msg}))

    async def disconnect(self, close_code):
        """Called when the user closes the page or disconnects."""
        await self._cleanup()

    async def _cleanup(self):
        """Gracefully release all resources (WebRTC, Temp Files, Recorder)."""
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
        """
        Main router for incoming WebSocket messages from the client.
        The client sends 'signals' to change state or share WebRTC metadata.
        """
        if not text_data: return
        data = json.loads(text_data)
        m_type = data.get("type")

        if m_type == "init_session":
            # Load previous conversation history based on session ID
            await self._handle_init_session(data)
            
        elif m_type == "offer":
            # Begin the WebRTC handshake to receive audio
            await self._handle_offer(data)
            
        elif m_type == "speech_start":
            # Client VAD detected the user started talking
            await self._handle_speech_start()
            
        elif m_type == "speech_end":
            # Client VAD detected the user stopped talking
            await self._handle_speech_end()
            
        elif m_type == "tts_start":
            # Inform backend that client has started playing AI audio
            self.state = "SPEAKING"
            
        elif m_type == "tts_end":
            # AI voice finished playing, system is ready for user again
            self.state = "IDLE"
            await self.send(json.dumps({"type": "ready"}))
        elif m_type == "ready_signal":
            # Client-side rejected some noise, reset backend to IDLE
            self.state = "IDLE"
            if self.recorder:
                try: await self.recorder.stop()
                except: pass
                self.recorder = None
            await self.send(json.dumps({"type": "ready"}))
        elif m_type == "cancel_recording":
            # Client rejected noise; stop recording and delete temp file without closing PC
            self.state = "IDLE"
            if self.recorder:
                try: await self.recorder.stop()
                except: pass
                self.recorder = None
            if self.temp_filename and os.path.exists(self.temp_filename):
                try: os.remove(self.temp_filename)
                except: pass
            await self.send(json.dumps({"type": "ready"}))
        elif m_type == "stop_session":
            # Manual shutdown from the client
            await self._cleanup()
            self.state = "IDLE"

    async def _handle_init_session(self, data):
        """Loads existing conversation history from the database if session_id is provided."""
        sid = data.get("session_id")
        if sid:
            try:
                session = await sync_to_async(ConversationSession.objects.get)(id=sid)
                self.session_id = str(session.id)
                
                # Fetch recent messages to provide context to the LLM
                msgs = await sync_to_async(list)(Message.objects.filter(session=session).order_by("timestamp")[:15])
                for m in msgs: 
                    self.message_history.append({"role": m.role, "content": m.content})
            except:
                pass
        else:
            # Create a brand new session if none exists
            session = await sync_to_async(ConversationSession.objects.create)()
            self.session_id = str(session.id)
            await self.send(json.dumps({"type": "session_created", "session_id": self.session_id}))

    async def _handle_offer(self, data):
        """Handles the WebRTC handshaking (The 'Offer' from the browser)."""
        self.pc = RTCPeerConnection()
        
        # This event listener captures the audio stream coming from the user's mic
        @self.pc.on("track")
        def on_track(track):
            if track.kind == "audio":
                self.audio_track = track
                logger.info("WebRTC Audio Track Received")

        # Set the browser's configuration (SDP) and create our response (Answer)
        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=data["sdp"], type="offer"))
        answer = await self.pc.createAnswer()
        await self.pc.setLocalDescription(answer)
        
        # Send the answer back to the browser via WebSocket
        await self.send(json.dumps({"type": "answer", "sdp": self.pc.localDescription.sdp}))

    async def _handle_speech_start(self):
        """
        Triggered when VAD on the browser thinks speech has started.
        We start saving the incoming WebRTC audio track to a temporary file.
        """
        if not self.audio_track: 
            return
        
        # TURN-TAKING LOCK: Ignore user input if we are AI is already processing or speaking
        if self.state != "IDLE":
            logger.info(f"Ignoring speech_start: Current state is {self.state}")
            return
        
        # Ensure any old recorder is stopped
        if self.recorder:
            try: await self.recorder.stop()
            except: pass
        
        # 1.Initialize a new recorder linked to the audio track
        self.temp_filename = get_temp_file()
        self.recorder = MediaRecorder(self.temp_filename)
        self.recorder.addTrack(self.audio_track)
        await self.recorder.start()
        
        self.state = "RECORDING"
        logger.info("Started recording audio chunk...")

    async def _handle_speech_end(self):
        """
        Triggered when the user stops talking.
        We stop the recorder and begin the main AI processing pipeline.
        """
        if not self.recorder or self.state != "RECORDING": 
            return

        try:
            await self.recorder.stop()
            self.recorder = None
        except Exception as e:
            logger.error(f"Error stopping recorder: {e}")
        
        self.state = "PROCESSING"
        # Run the intensive AI tasks in the background so the WebSocket stays responsive
        asyncio.create_task(self._process_audio())


    async def _process_audio(self):
        """
        The Complete AI Voice Pipeline:
        Step 1: Speech-To-Text (Whisper) converts audio to string.
        Step 2: Large Language Model (GPT) decides on a smart response.
        Step 3: Text-To-Speech (OpenAI TTS) generates an audio file of the response.
        """
        file_path = self.temp_filename
        
        # Basic validation: ensure file exists and isn't just a tiny bit of noise
        # A file smaller than 10KB is usually less than 0.5s of audio @ 16kHz
        if not file_path or not os.path.exists(file_path) or os.path.getsize(file_path) < 10000:
            logger.info(f"Audio file ({os.path.getsize(file_path) if file_path and os.path.exists(file_path) else 0} bytes) too short; likely noise. Resetting.")
            await self._reset_to_idle()
            return
            
        try:
            # =====================================================
            # PRINT AFTER RECORDING, BEFORE STT (Whisper)
            # =====================================================
            print("========== AUDIO CHECK BEFORE STT ==========")
            print(f"Audio file path: {file_path}")
            print(f"Audio file size: {os.path.getsize(file_path)} bytes")

            logger.info("Audio recording completed before STT")
            logger.info(f"Audio file path: {file_path}")
            logger.info(f"Audio file size: {os.path.getsize(file_path)} bytes")
            
            
            # --- 1. Transcription (Whisper) ---
            with open(file_path, "rb") as audio_file:
                transcription = await self.client.audio.transcriptions.create(
                    model="whisper-1", 
                    file=audio_file,
                    prompt="Human voice interacting with Stellaris AI." 
                )
            
            
            user_text = transcription.text.strip()
            
            print("========== TRANSCRIPTION RESULT ==========")
            print(f"Transcribed Text: '{user_text}'")
            
            # STIRCT FILTER: Ignore common filler or very short noise-like transcriptions
            # Whisper sometimes transcribes silence as "Thank you." or "you" or background TV noise.
            ignore_phrases = ["Thank you.", "Thank you", "you", ".", "Stop.", "Bye."]
            
            if not user_text or len(user_text) < 5 or user_text in ignore_phrases:
                logger.info(f"Ghost transcription detected: '{user_text}'. Ignoring.")
                await self._reset_to_idle()
                return
            
            logger.info(f"User Request: {user_text}")
            await self.send(json.dumps({"type": "transcription", "text": user_text}))
            
            # --- 2. Intelligent Reasoning (GPT-4o) ---
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=self.message_history + [{"role": "user", "content": user_text}]
            )
            ai_text = response.choices[0].message.content.strip()
            print(f"AI Response: '{ai_text}'")
            
            # Update history cache
            self.message_history.append({"role": "user", "content": user_text})
            self.message_history.append({"role": "assistant", "content": ai_text})
            
            # --- 3. Voice Synthesis (TTS) ---
            # Converts the text response into high-quality speech data
            tts_response = await self.client.audio.speech.create(
                model="tts-1", 
                voice="nova", 
                input=ai_text
            )
            
            # Send the result back to the client
            # The audio is base64 encoded because WebSockets handle strings/json easiest.
            await self.send(json.dumps({
                "type": "ai_response",
                "text": ai_text,
                "audio": base64.b64encode(tts_response.content).decode()
            }))
            
            # Persist the interaction to the database
            if self.session_id:
                asyncio.create_task(self._save_to_db(user_text, ai_text))
                
        except Exception as e:
            logger.error(f"Critical AI Pipeline Error: {e}")
            await self.send(json.dumps({"type": "error", "message": "Neural systems encountered an error."}))
            self._reset_to_idle()
        finally:
            # Always delete the temporary audio file to save disk space
            if file_path and os.path.exists(file_path):
                try: os.remove(file_path)
                except: pass

    async def _reset_to_idle(self):
        """Small helper to reset state and inform client."""
        self.state = "IDLE"
        await self.send(json.dumps({"type": "ready"}))

    async def _save_to_db(self, user_text, ai_text):
        """Asynchronously saves the conversation exchange to the Django DB."""
        await sync_to_async(Message.objects.create)(session_id=self.session_id, role="user", content=user_text)
        await sync_to_async(Message.objects.create)(session_id=self.session_id, role="assistant", content=ai_text)
