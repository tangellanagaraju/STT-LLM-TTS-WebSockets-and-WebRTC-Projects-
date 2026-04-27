import json
import base64
import tempfile
import os
import logging
from channels.generic.websocket import AsyncWebsocketConsumer
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# Initialize AsyncOpenAI config
api_key = os.environ.get("OPENAI_API_KEY", "")
client = AsyncOpenAI(api_key=api_key) if api_key else None

class VoiceConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.audio_buffer = bytearray()
        self.message_history = [
            {"role": "system", "content": "You are a brief, helpful, and highly conversational AI voice assistant. Keep answers short and natural for speech."}
        ]
        await self.accept()
        
        if not api_key:
            await self.send(json.dumps({"type": "error", "message": "No OPENAI_API_KEY set on server."}))
        else:
            await self.send(json.dumps({"type": "info", "message": "Connected to Server (WebSockets active)."}))

    async def disconnect(self, close_code):
        self.audio_buffer = bytearray()

    async def receive(self, text_data=None, bytes_data=None):
        if bytes_data:
            # We received binary audio chunk
            self.audio_buffer.extend(bytes_data)
        
        if text_data:
            try:
                data = json.loads(text_data)
                
                # Signal to process the accumulated webm blob
                if data.get("type") == "process_audio":
                    mime_type = data.get("mimeType", "")
                    
                    if len(self.audio_buffer) == 0:
                        await self.send(json.dumps({"type": "error", "message": "No audio received."}))
                        return
                    
                    audio_data = self.audio_buffer
                    self.audio_buffer = bytearray() # Clear buffer for next utterance
                    
                    # Ensure API key
                    if not client:
                        await self.send(json.dumps({"type": "error", "message": "Missing OpenAI API Key."}))
                        return
                        
                    # Extract correct extension for OpenAI based on mobile overrides
                    ext = ".webm"
                    if "mp4" in mime_type:
                        ext = ".mp4"
                    elif "ogg" in mime_type:
                        ext = ".ogg"
                    elif "wav" in mime_type:
                        ext = ".wav"
                    
                    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
                        f.write(audio_data)
                        temp_filename = f.name
                        
                    try:
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
                        
                    except Exception as e:
                        logger.error(f"Error calling OpenAI API: {e}")
                        await self.send(json.dumps({"type": "error", "message": str(e)}))
                    finally:
                        if os.path.exists(temp_filename):
                            os.remove(temp_filename)
                            
            except json.JSONDecodeError:
                pass
