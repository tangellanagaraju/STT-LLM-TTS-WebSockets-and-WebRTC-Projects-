import json
import logging
import io
import wave
import uuid
import os
import asyncio
import base64
import numpy as np
from channels.generic.websocket import AsyncWebsocketConsumer
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
from openai import OpenAI
import av

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- CONFIGURATION ---
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "your_openai_api_key_here")
client = OpenAI(api_key=OPENAI_API_KEY)

class AudioReceiver:
    def __init__(self):
        self.buffer = None
        self.wave_file = None
        self.is_recording = False
        self.sample_rate = 48000

    def start(self):
        logger.info("--- Audio Recording Started ---")
        self.buffer = io.BytesIO()
        self.wave_file = wave.open(self.buffer, 'wb')
        self.wave_file.setnchannels(1)
        self.wave_file.setsampwidth(2)
        self.wave_file.setframerate(self.sample_rate)
        self.is_recording = True

    def stop(self):
        logger.info("--- Audio Recording Stopped ---")
        self.is_recording = False
        if self.wave_file:
            self.wave_file.close()
            data = self.buffer.getvalue()
            return data
        return None

    def add_frame(self, frame: av.AudioFrame):
        if self.is_recording:
            data = frame.to_ndarray()
            if data.ndim > 1:
                data = data.mean(axis=1)
            data = data.astype(np.int16)
            self.wave_file.writeframes(data.tobytes())

class VoiceConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.accept()
        logger.info("WebSocket: Connected")
        self.pc = RTCPeerConnection()
        self.receiver = AudioReceiver()
        self.is_processing = False

        @self.pc.on("track")
        def on_track(track):
            if track.kind == "audio":
                async def process_frames():
                    while True:
                        try:
                            frame = await track.recv()
                            self.receiver.add_frame(frame)
                        except:
                            break
                asyncio.ensure_future(process_frames())

    async def disconnect(self, close_code):
        logger.info("WebSocket: Disconnected")
        await self.pc.close()

    async def receive(self, text_data):
        data = json.loads(text_data)
        msg_type = data.get("type")

        if msg_type == "offer":
            await self.pc.setRemoteDescription(RTCSessionDescription(sdp=data["sdp"], type=data["type"]))
            answer = await self.pc.createAnswer()
            await self.pc.setLocalDescription(answer)
            await self.send(json.dumps({"type": "answer", "sdp": self.pc.localDescription.sdp}))
        
        elif msg_type == "start_speaking":
            self.receiver.start()
        
        elif msg_type == "stop_speaking":
            audio_data = self.receiver.stop()
            if audio_data and len(audio_data) > 2000:
                asyncio.create_task(self.run_pipeline(audio_data))

    async def run_pipeline(self, audio_bytes):
        if self.is_processing: return
        self.is_processing = True
        try:
            # 1. STT
            logger.info("Pipeline: STT...")
            audio_file = io.BytesIO(audio_bytes)
            audio_file.name = "input.wav"
            transcript = client.audio.transcriptions.create(model="whisper-1", file=audio_file)
            user_text = transcript.text
            if not user_text.strip(): return
            
            await self.send(json.dumps({"type": "transcript", "text": user_text}))

            # 2. LLM
            logger.info("Pipeline: LLM...")
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a helpful voice assistant. Keep responses very brief (1 sentence)."},
                    {"role": "user", "content": user_text}
                ]
            )
            ai_text = response.choices[0].message.content
            await self.send(json.dumps({"type": "response", "text": ai_text}))

            # 3. TTS
            logger.info("Pipeline: TTS...")
            speech_response = client.audio.speech.create(
                model="tts-1",
                voice="alloy",
                input=ai_text,
                response_format="mp3"
            )
            
            # 4. Send as Base64 via WebSocket
            audio_content = speech_response.read()
            audio_base64 = base64.b64encode(audio_content).decode('utf-8')
            
            logger.info("Pipeline: Sending audio response via WebSocket...")
            await self.send(json.dumps({
                "type": "audio",
                "data": audio_base64
            }))

        except Exception as e:
            logger.error(f"Pipeline Error: {e}")
        finally:
            self.is_processing = False
