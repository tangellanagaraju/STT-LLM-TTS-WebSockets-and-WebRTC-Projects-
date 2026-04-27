# WebRTC Flow and Architecture

This application uses a FastAPI signaling server and native WebSockets to facilitate a Peer-to-Peer (P2P) WebRTC connection.

## Architecture

### 1. Signaling Server (FastAPI)
The signaling server (`main.py`) acts as a middleman for peers to discover each other. It doesn't handle the video/audio data itself, but exchanges the necessary metadata (Offers, Answers, and ICE Candidates).

- **WebSockets**: Used for real-time, bidirectional communication between the browser and the server.
- **Client Management**: The server tracks connected users by their auto-generated usernames.
- **Offer/Answer Store**: Keeps track of active call offers so new clients can see who is "calling".

### 2. Frontend (JavaScript/WebRTC)
The frontend (`scripts.js`) uses the browser's native WebRTC API (`RTCPeerConnection`).

## The WebRTC Handshake Flow

1.  **Identity**: Each user gets a random username and connects to the FastAPI WebSocket.
2.  **Call Initiation (The Offer)**:
    - User A (Offerer) clicks "Start Call".
    - User A captures their local camera/mic stream.
    - User A creates an `RTCPeerConnection` and a local "Offer" (SDP - Session Description Protocol).
    - User A sends this Offer to the Signaling Server via WebSocket.
3.  **Discovery**:
    - User B (Answerer) receives the "newOffer" message from the server.
    - The UI updates to show an "Answer" button.
4.  **Acceptance (The Answer)**:
    - User B clicks "Answer".
    - User B captures their local camera/mic stream.
    - User B creates their own `RTCPeerConnection`, sets User A's Offer as the "Remote Description", and creates an "Answer" (SDP).
    - User B sends this Answer back to the server, which forwards it to User A.
5.  **ICE Candidates (The Pathfinding)**:
    - While the SDP exchange happens, both peers start generating "ICE Candidates" (possible network paths to reach them).
    - These candidates are sent through the signaling server to the other peer.
    - Each peer adds these candidates to their `RTCPeerConnection`.
6.  **Connection Established**:
    - Once the peers find a compatible path, the connection goes "live".
    - The `onTrack` event fires in the browser, and the remote video stream is attached to the UI.

## How to Run

1.  **Install Dependencies**:
    ```bash
    pip install fastapi uvicorn
    ```
2.  **Start the Server**:
    ```bash
    python main.py
    ```
3.  **Access the App**:
    Open `http://localhost:8181` in two different browser windows or tabs.
