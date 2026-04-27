let localStream;
let remoteStream;
let peerConnection;
let ws;
let currentRoom = null;
let clientId = generateClientId();
let remotePeerId = null;
let videoEnabled = true;
let audioEnabled = true;
let iceCandidateBuffer = [];   // Buffer candidates before remoteDescription is set
let iceConfig = null;          // Loaded from server

// Fetch ICE config from the server (includes STUN + optional TURN)
async function loadIceConfig() {
    try {
        const resp = await fetch('/ice-config');
        if (resp.ok) {
            iceConfig = await resp.json();
            console.log('✅ Loaded ICE config from server:');
            console.table(iceConfig.iceServers);
            return;
        }
    } catch (e) {
        console.warn('Could not fetch ICE config from server, using defaults', e);
    }
    iceConfig = {
        iceServers: []
    };
}

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusText = document.getElementById('statusText');
const clientIdDisplay = document.getElementById('clientId');
const currentRoomDisplay = document.getElementById('currentRoom');
const peersList = document.getElementById('peersList');
const localStatus = document.getElementById('localStatus');
const remoteStatus = document.getElementById('remoteStatus');
const remoteOverlay = document.getElementById('remoteOverlay');

clientIdDisplay.textContent = clientId;
console.log('Client ID:', clientId);

function generateClientId() {
    return 'client_' + Math.random().toString(36).substring(2, 11);
}

async function initLocalStream() {
    try {
        localStatus.textContent = 'Requesting...';
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: { echoCancellation: true, noiseSuppression: true }
        });

        localVideo.srcObject = localStream;
        localStatus.textContent = 'Active';
        updateStatus('✅ Camera ready');
        console.log('✅ Local stream initialized');
    } catch (error) {
        console.error('Error:', error);
        localStatus.textContent = 'Error';
        updateStatus('❌ Camera access denied');
        alert('Please allow camera and microphone access');
    }
}

function createPeerConnection(targetId) {
    if (peerConnection) {
        console.log('Closing existing peer connection before creating new one');
        closeConnection();
    }
    
    console.log('Creating peer connection for', targetId, 'with ICE config:', iceConfig);
    iceCandidateBuffer = [];
    peerConnection = new RTCPeerConnection(iceConfig);
    peerConnection.targetId = targetId; // Store targetId on the object

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        console.log('✅ Received remote track:', event.track.kind);
        if (!remoteStream) {
            remoteStream = new MediaStream();
            remoteVideo.srcObject = remoteStream;
        }
        remoteStream.addTrack(event.track);
        remoteStatus.textContent = 'Connected';
        remoteOverlay.style.display = 'none';
        updateStatus('✅ Connected');
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            const target = peerConnection.targetId || remotePeerId;
            console.log(`📡 Sending ICE Candidate (${event.candidate.type || 'relay'}) to ${target}`);
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                target_id: target,
                candidate: event.candidate
            }));
        } else {
            console.log('✅ ICE gathering complete');
        }
    };

    peerConnection.onicecandidateerror = (event) => {
        console.error('❌ ICE Candidate Error:', event.errorCode, event.errorText, event.url);
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
    };

    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        console.log('Connection state:', state);
        updateStatus(`Connection: ${state}`);
        if (state === 'connected') {
            remoteStatus.textContent = 'Connected';
            remoteOverlay.style.display = 'none';
            monitorIceConnection();
        } else if (state === 'failed') {
            updateStatus('❌ Connection failed — check your network/TURN config');
        }
    };
}

async function monitorIceConnection() {
    if (!peerConnection) return;

    const intervalId = setInterval(async () => {
        if (!peerConnection || peerConnection.connectionState === 'closed') {
            clearInterval(intervalId);
            return;
        }

        try {
            const stats = await peerConnection.getStats();
            let selectedPair = null;

            stats.forEach(report => {
                if (report.type === 'transport') {
                    const pairId = report.selectedCandidatePairId;
                    if (pairId) {
                        selectedPair = stats.get(pairId);
                    }
                }
            });

            if (selectedPair) {
                const localCandidateId = selectedPair.localCandidateId;
                const localCandidate = stats.get(localCandidateId);

                if (localCandidate) {
                    const type = localCandidate.candidateType || localCandidate.type;
                    let serverInfo = 'Unknown';

                    if (type === 'srflx') {
                        serverInfo = 'Google STUN';
                    } else if (type === 'relay') {
                        const url = localCandidate.url || '';
                        if (url.includes('metered.ca')) {
                            serverInfo = `Metered Fallback (${url})`;
                        } else {
                            serverInfo = `Local Coturn (${url})`;
                        }
                    } else if (type === 'host') {
                        serverInfo = 'Direct Peer-to-Peer';
                    }

                    // Only log if the type has changed or it's the first time
                    if (!monitorIceConnection.lastType || monitorIceConnection.lastType !== type) {
                        console.log(`%c🌐 ICE Connection Established via ${serverInfo}`, 'color: #00ff00; font-weight: bold;');
                        monitorIceConnection.lastType = type;
                    }
                }
            }
        } catch (e) {
            console.error('Error getting stats:', e);
        }
    }, 2000);
}

async function joinRoom() {
    const roomInput = document.getElementById('roomInput');
    const room = roomInput.value.trim();

    if (!room) {
        alert('Please enter a room name');
        return;
    }

    if (!localStream) {
        await initLocalStream();
    }

    // Load ICE config (STUN/TURN) from server before connecting
    if (!iceConfig) {
        await loadIceConfig();
    }

    currentRoom = room;
    currentRoomDisplay.textContent = room;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${room}/${clientId}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected');
        updateStatus(`Connected to room: ${room}`);
        document.getElementById('joinBtn').disabled = true;
        document.getElementById('leaveBtn').disabled = false;
        roomInput.disabled = true;
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('Received:', message.type);

        switch (message.type) {
            case 'room-clients':
                updatePeersList(message.clients.filter(id => id !== clientId));
                const otherClients = message.clients.filter(id => id !== clientId);
                if (otherClients.length > 0) {
                    remotePeerId = otherClients[0];
                    await createOffer(remotePeerId);
                }
                break;

            case 'user-joined':
                updatePeersList(message.clients.filter(id => id !== clientId));
                break;

            case 'user-left':
                if (message.client_id === remotePeerId) {
                    closeConnection();
                }
                updatePeersList(message.clients?.filter(id => id !== clientId) || []);
                break;

            case 'offer':
                remotePeerId = message.sender_id;
                await handleOffer(message.offer);
                break;

            case 'answer':
                await handleAnswer(message.answer);
                break;

            case 'ice-candidate':
                await handleIceCandidate(message.candidate);
                break;
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus('Connection error');
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        updateStatus('Disconnected');
    };
}

async function createOffer(targetId) {
    createPeerConnection(targetId);
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        ws.send(JSON.stringify({
            type: 'offer',
            target_id: targetId,
            offer: offer
        }));
        console.log('✅ Offer sent to', targetId);
    } catch (error) {
        console.error('Error creating offer:', error);
    }
}

async function handleOffer(offer) {
    createPeerConnection(remotePeerId);
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        // Drain any buffered ICE candidates
        await drainIceCandidateBuffer();
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        ws.send(JSON.stringify({
            type: 'answer',
            target_id: remotePeerId,
            answer: answer
        }));
        console.log('✅ Answer sent to', remotePeerId);
    } catch (error) {
        console.error('Error handling offer:', error);
    }
}

async function handleAnswer(answer) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        // Drain any buffered ICE candidates
        await drainIceCandidateBuffer();
        console.log('✅ Answer applied, remote description set');
    } catch (error) {
        console.error('Error handling answer:', error);
    }
}

async function drainIceCandidateBuffer() {
    console.log(`Draining ${iceCandidateBuffer.length} buffered ICE candidate(s)`);
    while (iceCandidateBuffer.length > 0) {
        const candidate = iceCandidateBuffer.shift();
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.warn('Error adding buffered ICE candidate:', e);
        }
    }
}

async function handleIceCandidate(candidate) {
    if (!candidate) return;
    // If remoteDescription is not yet set, buffer the candidate
    if (!peerConnection || !peerConnection.remoteDescription || !peerConnection.remoteDescription.type) {
        console.log('Buffering ICE candidate (remoteDescription not set yet)');
        iceCandidateBuffer.push(candidate);
        return;
    }
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('ICE candidate added');
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

function leaveRoom() {
    if (ws) {
        ws.close();
    }
    closeConnection();

    currentRoom = null;
    currentRoomDisplay.textContent = 'None';
    document.getElementById('joinBtn').disabled = false;
    document.getElementById('leaveBtn').disabled = true;
    document.getElementById('roomInput').disabled = false;
    updateStatus('Left the room');
    updatePeersList([]);
}

function closeConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
        remoteStream = null;
        remoteVideo.srcObject = null;
    }
    remotePeerId = null;
    remoteStatus.textContent = 'Waiting...';
    remoteOverlay.style.display = 'block';
}

function toggleVideo() {
    if (localStream) {
        videoEnabled = !videoEnabled;
        localStream.getVideoTracks()[0].enabled = videoEnabled;
        const btn = document.getElementById('toggleVideo');
        btn.textContent = videoEnabled ? '📹 Video On' : '📹 Video Off';
        btn.classList.toggle('off');
    }
}

function toggleAudio() {
    if (localStream) {
        audioEnabled = !audioEnabled;
        localStream.getAudioTracks()[0].enabled = audioEnabled;
        const btn = document.getElementById('toggleAudio');
        btn.textContent = audioEnabled ? '🎤 Audio On' : '🎤 Audio Off';
        btn.classList.toggle('off');
    }
}

function updateStatus(message) {
    statusText.textContent = message;
}

function updatePeersList(peers) {
    peersList.innerHTML = '';
    if (peers.length === 0) {
        peersList.innerHTML = '<li class="no-peers">No participants yet</li>';
    } else {
        peers.forEach(peerId => {
            const li = document.createElement('li');
            li.textContent = `User: ${peerId}`;
            peersList.appendChild(li);
        });
    }
}

// Pre-load ICE config and camera simultaneously
Promise.all([loadIceConfig(), initLocalStream()]);