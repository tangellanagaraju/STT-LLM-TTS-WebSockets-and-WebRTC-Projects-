# 🌐 STT-LLM-TTS-WebSockets-and-WebRTC-Projects

A professional collection of WebRTC and WebSocket implementations, featuring advanced AI-powered voice agents, real-time media streaming, and robust signaling systems. This repository serves as a comprehensive reference for building low-latency, real-time communication applications.

## 🚀 Key Features

- **AI Voice Assistants**: Integrated STT (Speech-to-Text), LLM (Large Language Model), and TTS (Text-to-Speech) pipelines.
- **WebRTC Signaling**: Various signaling methods including Firebase, Socket.io, and FastAPI/WebSockets.
- **Media Streaming**: Low-latency audio and video streaming with TURN/STUN server integration.
- **Voice Activity Detection (VAD)**: Accurate voice detection for seamless AI interactions.
- **Framework Support**: Implementations in FastAPI, Django, Express.js, and Vanilla JS.

## 📁 Repository Structure

| Project Folder | Description | Tech Stack |
| :--- | :--- | :--- |
| **[stt-agent-tts-webrtc-pro](./stt-agent-tts-webrtc-pro)** | **Latest** Professional AI Voice Agent with advanced VAD and high-fidelity streaming. | FastAPI, WebRTC, OpenAI |
| **[stt-agent-tts-webrtc-vad](./stt-agent-tts-webrtc-vad)** | AI Voice Assistant featuring browser-based Voice Activity Detection. | FastAPI, WebRTC, VAD.js |
| **[stt-agent-tts webrtc](./stt-agent-tts%20webrtc)** | Core WebRTC implementation for AI-driven voice conversations. | Django, WebRTC, OpenAI |
| **[stt-agent-tts websockets](./stt-agent-tts%20websockets)** | Voice Assistant implementation utilizing standard WebSockets. | FastAPI, WebSockets |
| **[django-stt-tts-minimal](./django-stt-tts-minimal)** | Lightweight, minimal setup for STT to TTS processing. | Django, Python |
| **[fastapi webRTC](./fastapi%20webRTC)** | Production-ready FastAPI integration with Coturn support. | FastAPI, Coturn |
| **[FirebaseRTC](./FirebaseRTC)** | Peer-to-peer WebRTC using Firebase as the signaling layer. | JavaScript, Firebase |
| **[WebRTC_Chat_Room-main](./WebRTC_Chat_Room-main)** | Multi-user real-time chat application. | Node.js, WebRTC |
| **[calling](./calling)** | Basic audio/video calling implementation. | Vanilla JS, WebRTC |
| **[vchatlive](./vchatlive)** | Live video chat demo with room management. | Node.js, Socket.io |
| **[webrtc starter express](./webrtc%20starter%20express)** | Starter template for Node.js/Express WebRTC applications. | Express, Socket.io |
| **[websockets](./websockets)** | Fundamental examples of bidirectional communication. | Node.js, WS |

## 🛠️ Setup & Installation

Each project contains its own `README.md` with specific installation instructions. Generally, you will need:

### Prerequisites
- **Node.js** (v16+)
- **Python** (3.10+)
- **OpenAI API Key** (for AI-powered projects)

### Quick Start
1. Clone the repository:
   ```bash
   git clone https://github.com/tangellanagaraju/STT-LLM-TTS-WebSockets-and-WebRTC-Projects-.git
   ```
2. Navigate to a project folder:
   ```bash
   cd stt-agent-tts-webrtc-pro
   ```
3. Follow the instructions in the project's local `README.md`.

## 🔒 Security Note

All sensitive credentials (API keys, secrets, `.env` files) have been removed for security. 
- Create a `.env` file in the relevant project directory.
- Add your keys: `OPENAI_API_KEY=your_key_here`
- Do **not** commit your `.env` files to version control.

## 📄 License

This repository is licensed under the MIT License. See individual folders for specific license details if applicable.

---
Created and maintained by [Tangella Nagaraju](https://github.com/tangellanagaraju).
