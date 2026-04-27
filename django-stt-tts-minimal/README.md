# Real-Time Voice AI Assistant (Django + WebRTC + VAD)

This is a professional-grade, real-time voice-to-voice conversation system built with **Django**, **Channels**, and **WebRTC**.

## Key Features
- **Django Backend**: Robust and scalable server using Django Channels for asynchronous communication.
- **WebRTC Audio**: Low-latency, full-duplex audio streaming between browser and server.
- **Integrated VAD**: Automatic **Voice Activity Detection** means the system listens when you speak and processes automatically—no more holding buttons.
- **OpenAI Powered**: Uses Whisper (STT), GPT-4o (LLM), and OpenAI TTS (Audio) for state-of-the-art responses.
- **Continuous Conversation**: The system remains active and listening until you click "Stop".

## Setup Instructions

1. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Run Migrations**:
   ```bash
   python manage.py migrate
   ```

3. **Start the Server**:
   ```bash
   python manage.py runserver
   ```

4. **Access the App**:
   Navigate to `http://127.0.0.1:8000`.

## How to Use
1. Click **"Start"** to begin. The system will ask for microphone permissions.
2. The blue indicator will **pulse** when you speak, showing that VAD is working.
3. Once you stop speaking, the AI will automatically process your input and reply.
4. The system will immediately return to "Listening" mode after it finishes speaking.
5. Click **"Stop"** to end the session.

## Tech Stack
- **Framework**: Django, Django Channels (Daphne)
- **WebRTC**: aiortc, Browser WebRTC API
- **VAD**: @ricky0123/vad-web (ONNX-powered)
- **AI**: OpenAI (Whisper-1, GPT-4o, TTS-1)
