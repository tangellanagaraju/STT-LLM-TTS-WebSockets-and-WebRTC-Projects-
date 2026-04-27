# AI Voice Assistant Workflow & Architecture

This document outlines the workflow, core code structure, and the main topics behind the Real-Time Conversational AI Voice Assistant in this workspace.

## 1. High-Level Workflow Overview

The application relies heavily on **WebSockets** for real-time bi-directional streaming instead of establishing a full WebRTC Peer-to-Peer connection (meaning no STUN/TURN servers are actually required for media streaming here, the app simply relies on the browser's Media API and WebSocket transport). 

The general workflow is as follows:

1. **User Starts Recording**: User hits the microphone button on the frontend.
2. **Audio Capture**: The browser requests microphone access (`getUserMedia`) and uses `MediaRecorder` to capture audio.
3. **Audio Streaming**: `MediaRecorder` outputs audio chunks every 250ms. These binary blobs are streamed directly to the Django backend over a WebSocket connection.
4. **Backend Buffer**: The Django Channels backend receives these binary packets and accumulates them in an `audio_buffer` byte array in memory.
5. **Stop & Process Signal**: When the user stops speaking, the frontend sends a JSON message (`{"type": "process_audio", ...}`) over the WebSocket.
6. **Speech-To-Text (Whisper)**: The backend saves the buffered binary audio to a temporary file (`.webm`, `.wav`, etc.) and sends it to the **OpenAI Whisper API** for transcription.
7. **LLM Generation (GPT-4o-mini)**: The transcribed text is sent to the **OpenAI Chat Completions API** along with conversation history to generate an AI response.
8. **Frontend Update & Text-To-Speech (TTS)**: The AI's response text is sent back via WebSocket. The frontend displays the text in the browser chat and uses the native `window.speechSynthesis` API to speak it out loud.

---

## 2. Core Code Mechanics & Connections

### A. The WebSocket Router (`voice_app/routing.py`)
This file intercepts WebSocket connections to `/ws/voice/` and directs them to the backend consumer.
```python
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/voice/$', consumers.VoiceConsumer.as_asgi()),
]
```

### B. The Frontend (`voice_app/static/voice_app/js/app.js`)
Handles microphone access, WebSocket connection, and streaming chunks.

**Connecting and Handing WebSocket Events:**
```javascript
const wsUrl = `${protocol}//${window.location.host}/ws/voice/`;
socket = new WebSocket(wsUrl);

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'ai_response') {
        addMessage('🤖 ' + data.text, 'ai');
        speakText(data.text); // Trigger Speech Synthesis
    }
};
```

**Recording & Sending Chunks:**
```javascript
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
mediaRecorder = new MediaRecorder(stream, { mimeType: currentMimeType });

mediaRecorder.ondataavailable = (event) => {
    // Stream binary audio blobs through WebSocket
    if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
        socket.send(event.data);
    }
};

// Send JSON process signal on stop
mediaRecorder.onstop = () => {
    socket.send(JSON.stringify({ type: 'process_audio', mimeType: currentMimeType }));
};
mediaRecorder.start(250); // Emit chunk every 250ms
```

### C. The Backend Consumer (`voice_app/consumers.py`)
This is the workhorse of the application. It runs asynchronously via Django Channels (`AsyncWebsocketConsumer`).

**Accumulating Binary Data:**
```python
async def receive(self, text_data=None, bytes_data=None):
    if bytes_data:
        # Puts the streaming audio chunks straight into memory
        self.audio_buffer.extend(bytes_data)
```

**Processing Audio (When `text_data` containing `process_audio` is received):**
```python
if data.get("type") == "process_audio":
    # 1. Save buffer to temporary file
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
        f.write(self.audio_buffer)

    # 2. Whisper Speech to Text
    with open(temp_filename, "rb") as audio_file:
        transcript_response = await client.audio.transcriptions.create(
            model="whisper-1", file=audio_file
        )

    # 3. Get AI Response via LLM
    self.message_history.append({"role": "user", "content": user_text})
    chat_response = await client.chat.completions.create(
        model="gpt-4o-mini", messages=self.message_history
    )
    
    # 4. Stream response back to frontend
    ai_text = chat_response.choices[0].message.content
    await self.send(json.dumps({"type": "ai_response", "text": ai_text}))
```

---

## 3. Important Topics & Data Entities

* **`MediaRecorder` API**: An HTML5 API used in `app.js` to capture audio from the user's local microphone and split it up into chunked Byte streams.
* **WebSocket Streaming (`bytes_data`)**: Instead of waiting for a file to finish recording and making an HTTP POST request, sending `event.data` (which is binary data) directly into a WebSocket enables far lower latency handling.
* **Django Channels Consumer (`AsyncWebsocketConsumer`)**: An event-driven responder. It handles `connect`, `receive`, and `disconnect` events natively. 
* **Statefulness (`self.message_history` & `self.audio_buffer`)**: The connection is stateful. The Chat completion history stays loaded in memory (`self.message_history`) across multiple messages inside the open Consumer socket, ensuring context retention. The audio pieces are appended natively to `self.audio_buffer`.
* **Browser TTS (`speechSynthesis`)**: Instead of relying on a powerful backend component like `openai TTS` to stream audio bytes *back* to the frontend (consuming more server time and bandwidth), the application ingeniously uses browser-native textual speech reading (`window.speechSynthesis.speak()`) to play back the final LLM text output quickly.
