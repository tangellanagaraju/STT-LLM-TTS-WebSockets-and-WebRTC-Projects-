# Video Calling App

A simple Python-based video calling application using WebRTC and a signaling server.

## 🚀 Features

- **Asynchronous Signaling**: Built with Python's `asyncio` and `websockets`.
- **Frontend**: Clean HTML/JS interface for media stream handling.
- **Peer-to-Peer**: Direct video and audio communication.

## 📁 Structure

- `server.py`: The signaling server that coordinates the WebRTC connection.
- `frontend/`: Contains the client-side code (HTML, CSS, JS).

## 🛠️ Setup

1. **Install Requirements**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Run Signaling Server**:
   ```bash
   python server.py
   ```

3. **Open Frontend**:
   Open `frontend/index.html` in your browser.
