# WebRTC Video Calling App: Architecture & Workflow

This document explains the core technical workflow and outlines the crucial code components of the Video Calling Application powered by **Django Channels** and **WebRTC**.

## 1. High-Level Architecture
WebRTC allows browsers to exchange video and audio directly in a **Peer-to-Peer (P2P)** manner. However, before a direct connection can be established, the two browsers must locate each other and agree on communication parameters.

This requires a **Signaling Server**. We use **Django Channels** (WebSockets) as our signaling server to negotiate the connection.

## 2. Core Topics & Data Flow

### A. The Signaling Process (Django Backend)
When a user connects, they open a WebSocket connection handled by `call/consumers.py`. Django channels places the user in a channel "group" named after their username.

**Key file:** `call/consumers.py`
```python
def receive(self, text_data):
    # Parses all incoming websocket data
    text_data_json = json.loads(text_data)
    eventType = text_data_json['type']

    if eventType == 'call':
        name = text_data_json['data']['name']
        # Sends 'call_received' signal to the callee's room
        async_to_sync(self.channel_layer.group_send)(
            name,
            {
                'type': 'call_received',
                'data': {
                    'caller': self.my_name,
                    'rtcMessage': text_data_json['data']['rtcMessage']
                }
            }
        )
```
* **Event Types:** The server blindly routes `login`, `call`, `answer_call`, and `ICEcandidate` events to the necessary recipients.

### B. Network Traversal (STUN & TURN)
Browsers often hide behind NATs and Firewalls, obstructing direct P2P connections. 
- **STUN** tells a browser its *public IP address*.
- **TURN** acts as an active relay connecting two browsers if strict firewalls block P2P routing.

**Key Data:** `pcConfig` (Found in `templates/index.html`)
```javascript
let pcConfig = {
    "iceServers":  [
        { "urls":  "stun:stun.relay.metered.ca:80" },
        {
            "urls":  "turn:standard.relay.metered.ca:80",
            "username":  "1cde89d531344d6fa4589774",
            "credential":  "YpIV2p/YRsl7/7Wd"
        }
        // ... (includes other TCP/TLS arrays)
    ]
};
```
Whenever an `RTCPeerConnection` is created on the frontend, this config is passed in so the browser knows how to negotiate its external IP configuration.

### C. The WebRTC Workflow (Frontend Javascript)
The standard definition of the workflow takes place in **four main steps**:

1. **Accessing Media Devices**
   `getUserMedia()` prompts the user for camera and microphone access.
   ```javascript
   navigator.mediaDevices.getUserMedia({ audio: true, video: true })
   ```

2. **The "Offer"**
   The calling user maps their video track to the `RTCPeerConnection` and generates a **Session Description Protocol (SDP) Offer**.
   ```javascript
   peerConnection.createOffer((sessionDescription) => {
       peerConnection.setLocalDescription(sessionDescription);
       // Sends this SDP across the WebSocket (sendCall function)
   });
   ```

3. **The "Answer"**
   The receiving user accepts the call, taking the caller's SDP and saving it using `setRemoteDescription()`. They then generate a reciprocal **SDP Answer** and send it back over the WebSocket.
   ```javascript
   peerConnection.createAnswer((sessionDescription) => {
       peerConnection.setLocalDescription(sessionDescription);
       // Sends this Answer back across the WebSocket (answerCall function)
   });
   ```

4. **Exchanging ICE Candidates**
   In the background, as the `RTCPeerConnection` probes the STUN/TURN servers, it emits **ICE Candidates** (networking pathways). These candidates are funneled through the WebSocket and added to the peer using `peerConnection.addIceCandidate()`.

Once the Offer, Answer, and a valid ICE trickling path are combined, the `onaddstream` event natively fires, pushing the video feed to your HTML `<video id="remoteVideo">` element!
