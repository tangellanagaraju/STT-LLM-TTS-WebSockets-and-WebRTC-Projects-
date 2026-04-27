# FastAPI WebRTC Implementation

This project demonstrates how to integrate WebRTC with a FastAPI backend. It includes examples of using STUN/TURN servers (CoTURN) for peer-to-peer connectivity across different networks.

## 🚀 Features

- **FastAPI Backend**: High-performance asynchronous API for signaling.
- **CoTURN Integration**: Configuration for TURN/STUN servers to handle NAT traversal.
- **Peer-to-Peer Communication**: Establishing direct media streams between clients.

## 📁 Project Structure

- `FastApi_WebRTC/`: Main FastAPI application for WebRTC signaling.
- `FastApi_WebRTC - stun/`: Implementation using basic STUN server configuration.
- `coturn/`: Configuration files and setup for CoTURN server.

## 🛠️ Setup

1. **Install Dependencies**:
   ```bash
   pip install fastapi uvicorn
   ```

2. **Run the Server**:
   ```bash
   uvicorn main:app --reload
   ```

3. **Configure TURN Server (Optional)**:
   If you are testing across different networks, configure the settings in the `coturn/` directory.

## 🔒 Environment Variables

Create a `.env` file in the respective project folder with the following if needed:
- `TURN_SERVER_URL`
- `TURN_SERVER_USER`
- `TURN_SERVER_PASS`
