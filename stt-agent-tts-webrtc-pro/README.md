# STT Agent TTS WebRTC Pro

The most advanced implementation in this collection, featuring a professional-grade AI Voice Assistant pipeline with optimized WebRTC handling and robust state management.

## 🚀 Key Improvements
- **Optimized Signaling**: Improved WebSocket/WebRTC handshake for faster connection times.
- **Advanced State Machine**: Handles complex turn-taking and interruptions gracefully.
- **High-Fidelity Audio**: Configured for high-quality voice capture and playback.
- **Clean Architecture**: Modular code structure for easy extensibility.

## 📁 Project Structure
- `/app`: Backend logic and API routes.
- `/frontend`: Modern UI built with Vanilla JS and advanced CSS.
- `requirements.txt`: Python package requirements.
- `server.py`: Entry point for the FastAPI application.

## 🛠️ Installation & Usage
1. **Environment Setup**:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```
2. **Configuration**:
   Create a `.env` file:
   ```env
   OPENAI_API_KEY=your_openai_api_key
   ```
3. **Run Application**:
   ```bash
   python server.py
   ```

## 📄 Documentation
This project demonstrates the full end-to-end integration of WebRTC, STT, LLM, and TTS for a seamless conversational AI experience.
