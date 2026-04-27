# Real-time WebRTC/WebSocket STT Agent

This project provides a minimal full-stack architecture for a real-time conversational AI system.

## Setup Instructions

1. **Set your OpenAI API Key:**
   Create a `.env` file at the root of the project and add your OpenAI Key:
   ```env
   OPENAI_API_KEY="your_api_key_here"
   ```


2. **Run the Server:**
   A virtual environment with all required dependencies `(Django, channels, daphne, openai)` has been configured.
   Open a terminal in the project directory, activate the environment, and start the development server:
   ```powershell
   .\venv\Scripts\Activate.ps1
   python manage.py runserver
   ```

3. **Use the Application:**
   Navigate your browser to: `http://127.0.0.1:8000/`
   Allow microphone access. Click the big "Start Speaking" button to capture queries over a WebSocket in `webm` format. When you click "Stop & Send", your audio is transcribed via Whisper-1 and sent to OpenAI's GPT models, yielding an immediate conversational text answer.

## Core Features
1. **Dynamic Web UI:** A frosted-glass modern interface. Synthesizes voice back to you via the Web Speech API!
2. **WebRTC dummy Gathering + MediaRecorder Blob Streaming:** Records WebM media and streams over Django WebSockets.
3. **Consumer Logic:** Efficiently spools binary WebSocket fragments to an IO buffer, flushes to a temp file, and pings OpenAI Whisper -> GPT.
