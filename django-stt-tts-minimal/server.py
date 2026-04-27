import asyncio
import json
import logging
import os
import io
import wave
import uuid
import numpy as np
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
from aiortc.contrib.media import MediaPlayer
from openai import OpenAI
import av

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- CONFIGURATION ---
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "your_openai_api_key_here")
client = OpenAI(api_key=OPENAI_API_KEY)

app = FastAPI()

class AudioPipeline:
    def __init__(self, pc, websocket):
        self.pc = pc
        self.websocket = websocket
        self.is_processing = False

    async def run_pipeline(self, audio_bytes: bytes):
        if self.is_processing: return
        self.is_processing = True
        try:
            # 1. STT (Whisper)
            logger.info("Transcribing...")
            audio_file = io.BytesIO(audio_bytes)
            audio_file.name = "input.wav"
            transcript = client.audio.transcriptions.create(model="whisper-1", file=audio_file)
            user_text = transcript.text
            await self.websocket.send_text(json.dumps({"type": "transcript", "text": user_text}))

            # 2. LLM (GPT-4o)
            logger.info(f"User said: {user_text}")
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a helpful voice assistant. Keep responses very brief and conversational."},
                    {"role": "user", "content": user_text}
                ]
            )
            ai_text = response.choices[0].message.content
            await self.websocket.send_text(json.dumps({"type": "response", "text": ai_text}))

            # 3. TTS (OpenAI TTS)
            logger.info(f"AI response: {ai_text}")
            speech_response = client.audio.speech.create(model="tts-1", voice="alloy", input=ai_text)
            
            temp_filename = f"response_{uuid.uuid4()}.mp3"
            speech_response.stream_to_file(temp_filename)
            
            # 4. Return Audio via WebRTC Track
            player = MediaPlayer(temp_filename)
            self.pc.addTrack(player.audio)
            
            # Renegotiate to send the new audio track to the client
            offer = await self.pc.createOffer()
            await self.pc.setLocalDescription(offer)
            await self.websocket.send_text(json.dumps({"type": "offer", "sdp": self.pc.localDescription.sdp}))

            # Cleanup file after a delay
            asyncio.create_task(self.cleanup(temp_filename))

        except Exception as e:
            logger.error(f"Pipeline Error: {e}")
            await self.websocket.send_text(json.dumps({"type": "response", "text": "Sorry, error occurred."}))
        finally:
            self.is_processing = False

    async def cleanup(self, filename):
        await asyncio.sleep(30)
        if os.path.exists(filename):
            os.remove(filename)

class AudioReceiver:
    def __init__(self):
        self.buffer = io.BytesIO()
        self.wave_file = None
        self.is_recording = False

    def start(self):
        self.buffer = io.BytesIO()
        self.wave_file = wave.open(self.buffer, 'wb')
        self.wave_file.setnchannels(1)
        self.wave_file.setsampwidth(2) # 16-bit
        self.wave_file.setframerate(48000) # aiortc default
        self.is_recording = True

    def stop(self):
        self.is_recording = False
        if self.wave_file:
            self.wave_file.close()
            return self.buffer.getvalue()
        return None

    def add_frame(self, frame: av.AudioFrame):
        if self.is_recording:
            # Convert to mono if necessary and write
            data = frame.to_ndarray()
            if data.ndim > 1:
                data = data.mean(axis=0).astype(np.int16)
            self.wave_file.writeframes(data.tobytes())

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    pc = RTCPeerConnection()
    pipeline = AudioPipeline(pc, websocket)
    receiver = AudioReceiver()

    @pc.on("track")
    def on_track(track):
        if track.kind == "audio":
            async def process_frames():
                while True:
                    try:
                        frame = await track.recv()
                        receiver.add_frame(frame)
                    except:
                        break
            asyncio.ensure_future(process_frames())

    try:
        while True:
            msg = await websocket.receive_text()
            data = json.loads(msg)

            if data["type"] == "offer":
                await pc.setRemoteDescription(RTCSessionDescription(sdp=data["sdp"], type=data["type"]))
                answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                await websocket.send_text(json.dumps({"type": "answer", "sdp": pc.localDescription.sdp}))
            
            elif data["type"] == "answer":
                await pc.setRemoteDescription(RTCSessionDescription(sdp=data["sdp"], type=data["type"]))

            elif data["type"] == "start_speaking":
                receiver.start()
            
            elif data["type"] == "stop_speaking":
                audio_data = receiver.stop()
                if audio_data:
                    asyncio.create_task(pipeline.run_pipeline(audio_data))

    except WebSocketDisconnect:
        await pc.close()

@app.get("/")
async def get():
    return HTMLResponse(open("index.html").read())

@app.get("/client.js")
async def get_js():
    return HTMLResponse(open("client.js").read(), media_type="application/javascript")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
