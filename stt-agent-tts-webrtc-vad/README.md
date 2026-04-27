# STT Agent TTS WebRTC with VAD

This project implements a real-time AI Voice Assistant using WebRTC for low-latency audio streaming and browser-based Voice Activity Detection (VAD).

## 🚀 Features
- **Low Latency**: Uses WebRTC for near-instant audio transmission.
- **Voice Activity Detection**: Uses `@ricky0123/vad-web` to detect when the user starts and stops speaking.
- **AI Integration**: Connects to OpenAI for Speech-to-Text, LLM processing, and Text-to-Speech.
- **Responsive UI**: Visual indicators for "Listening", "Thinking", and "Speaking" states.

## 📁 Structure
- `/static`: Frontend files (HTML, CSS, JS).
- `main.py`: FastAPI server handling signaling and AI processing.
- `requirements.txt`: Python dependencies.

## 🛠️ Setup
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Set up environment variables:
   ```bash
   # .env
   OPENAI_API_KEY=your_key_here
   ```
3. Run the server:
   ```bash
   python main.py
   ```
4. Open `http://localhost:8000` in your browser.

## 🔒 Security
Ensure your `.env` file is never pushed to public repositories.
