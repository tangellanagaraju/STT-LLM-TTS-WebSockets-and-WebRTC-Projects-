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

logger = logging.getLogger(__name__)

# Initialize AsyncOpenAI config
api_key = os.environ.get("OPENAI_API_KEY", "")
client = AsyncOpenAI(api_key=api_key) if api_key else None

def get_temp_file():
    fd, name = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    return name

class VoiceConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.message_history = [
            {"role": "system", "content": "You are a brief, helpful, and highly conversational AI voice assistant. Keep answers short and natural for speech."}
        ]
        self.pc = None
        self.recorder = None
        self.temp_filename = None
        self.process_task = None
        
        await self.accept()
        
        if not api_key:
            await self.send(json.dumps({"type": "error", "message": "No OPENAI_API_KEY set on server."}))
        else:
            await self.send(json.dumps({"type": "info", "message": "Connected to Server (WebRTC active)."}))

    async def disconnect(self, close_code):
        if self.process_task and not self.process_task.done():
            self.process_task.cancel()
        if self.recorder:
            await self.recorder.stop()
        if self.pc:
            await self.pc.close()
        if self.temp_filename and os.path.exists(self.temp_filename):
            try:
                os.remove(self.temp_filename)
            except Exception:
                pass

    async def receive(self, text_data=None, bytes_data=None):
        if text_data:
            try:
                data = json.loads(text_data)
                
                if data.get("type") == "offer":
                    offer = RTCSessionDescription(sdp=data["sdp"], type="offer")
                    
                    if self.pc:
                        await self.pc.close()
                    if self.recorder:
                        await self.recorder.stop()
                    
                    self.pc = RTCPeerConnection()
                    self.temp_filename = get_temp_file()
                    self.recorder = MediaRecorder(self.temp_filename)
                    
                    @self.pc.on("track")
                    def on_track(track):
                        if track.kind == "audio":
                            self.recorder.addTrack(track)
                    
                    await self.pc.setRemoteDescription(offer)
                    
                    # Start the recorder once the remote description is set
                    await self.recorder.start()
                    
                    # Create Answer
                    answer = await self.pc.createAnswer()
                    await self.pc.setLocalDescription(answer)
                    
                    await self.send(json.dumps({
                        "type": "answer",
                        "sdp": self.pc.localDescription.sdp
                    }))
                
                # Signal to process the accumulated audio
                elif data.get("type") == "process_audio":
                    if self.recorder:
                        await self.recorder.stop()
                    
                    old_recorder = self.recorder
                    old_pc = self.pc
                    old_temp_filename = self.temp_filename
                    
                    self.recorder = None
                    self.pc = None
                    self.temp_filename = None
                    
                    self.process_task = asyncio.create_task(
                        self.process_audio_task(old_recorder, old_pc, old_temp_filename)
                    )

                elif data.get("type") == "interrupt":
                    if self.process_task and not self.process_task.done():
                        self.process_task.cancel()
                        logger.info("Task cancelled by explicit interrupt.")
                            
            except json.JSONDecodeError:
                pass

    async def process_audio_task(self, recorder, pc, temp_filename):
        try:
            if pc:
                await pc.close()

            if not temp_filename or not os.path.exists(temp_filename):
                await self.send(json.dumps({"type": "error", "message": "No audio received or file missing."}))
                return
            
            if os.path.getsize(temp_filename) == 0:
                await self.send(json.dumps({"type": "error", "message": "Audio file is empty."}))
                return
            
            # Ensure API key
            if not client:
                await self.send(json.dumps({"type": "error", "message": "Missing OpenAI API Key."}))
                return
                
            # 1. STT: Whisper
            with open(temp_filename, "rb") as audio_file:
                transcript_response = await client.audio.transcriptions.create(
                    model="whisper-1", 
                    file=audio_file
                )
            
            user_text = transcript_response.text.strip()
            if not user_text:
                await self.send(json.dumps({"type": "error", "message": "Could not hear anything."}))
                return
                
            await self.send(json.dumps({"type": "transcription", "text": user_text}))
            
            # 2. LLM: Agent response
            self.message_history.append({"role": "user", "content": user_text})
            
            chat_response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=self.message_history
            )
            
            ai_text = chat_response.choices[0].message.content
            self.message_history.append({"role": "assistant", "content": ai_text})
            
            # 3. Output payload back to client
            await self.send(json.dumps({"type": "ai_response", "text": ai_text}))
            
        except asyncio.CancelledError:
            logger.info("process_audio_task was cancelled.")
            raise
        except Exception as e:
            logger.error(f"Error calling OpenAI API: {e}")
            await self.send(json.dumps({"type": "error", "message": str(e)}))
        finally:
            if temp_filename and os.path.exists(temp_filename):
                try:
                    os.remove(temp_filename)
                except Exception:
                    pass
