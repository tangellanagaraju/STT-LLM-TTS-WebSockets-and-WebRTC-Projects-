document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const micBtn = document.getElementById('mic-btn');
    const btnText = document.getElementById('btn-text');
    const messagesFeed = document.getElementById('messages');
    const socketStatusEl = document.getElementById('socket-status');
    const rtcStatusEl = document.getElementById('webrtc-status');
    const statusPill = document.getElementById('vad-indicator');

    // State
    let isSessionActive = false;
    let socket = null;
    let pc = null;
    let stream = null;
    let myVad = null;
    let sessionId = localStorage.getItem('voice_session_id');

    // Initialize Connection on Load
    initWebSocket();

    function initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/voice/`;
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            updateSocketUI(true);
            socket.send(JSON.stringify({ type: 'init_session', session_id: sessionId }));
        };

        socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'session_created':
                    sessionId = data.session_id;
                    localStorage.setItem('voice_session_id', sessionId);
                    break;
                case 'info':
                    addMessage(data.message, 'system');
                    break;
                case 'ready':
                    updateStatus('Ready', 'rgba(255,255,255,0.05)');
                    break;
                case 'answer':
                    if (pc) {
                        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
                        updateRTCUI(true);
                    }
                    break;
                case 'transcription':
                    addMessage(data.text, 'user');
                    updateStatus('Thinking...', 'rgba(192, 132, 252, 0.2)');
                    break;
                case 'ai_response':
                    addMessage(data.text, 'ai');
                    if (data.audio) playAudio(data.audio);
                    else socket.send(JSON.stringify({ type: 'tts_end' }));
                    break;
                case 'error':
                    addMessage(`⚠️ ${data.message}`, 'system');
                    updateStatus('Error', 'rgba(244, 63, 94, 0.2)');
                    break;
            }
        };

        socket.onclose = () => {
            updateSocketUI(false);
            setTimeout(initWebSocket, 2000); // Auto-reconnect
        };
    }

    async function toggleSession() {
        if (!isSessionActive) await startSession();
        else stopSession();
    }

    async function startSession() {
        try {
            updateStatus('Starting...', 'rgba(255, 255, 255, 0.1)');
            
            // 1. Get Microphone
            stream = await navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true } 
            });

            // 2. Establish WebRTC Link
            pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            stream.getTracks().forEach(track => pc.addTrack(track, stream));
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));

            // 3. Initialize VAD (Voice Activity Detection)
            myVad = await vad.MicVAD.new({
                stream: stream,
                onSpeechStart: () => {
                    socket.send(JSON.stringify({ type: 'speech_start' }));
                    updateStatus('Listening...', 'rgba(45, 212, 191, 0.2)');
                },
                onSpeechEnd: () => {
                    socket.send(JSON.stringify({ type: 'speech_end' }));
                    updateStatus('Processing...', 'rgba(250, 204, 21, 0.2)');
                },
                positiveSpeechThreshold: 0.8
            });

            myVad.start();
            isSessionActive = true;
            micBtn.classList.add('recording');
            btnText.textContent = 'Stop Session';

        } catch (error) {
            console.error('Session Fail:', error);
            stopSession();
        }
    }

    function stopSession() {
        if (myVad) { myVad.pause(); myVad = null; }
        if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
        if (pc) { pc.close(); pc = null; }
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop_session' }));
        
        isSessionActive = false;
        micBtn.classList.remove('recording');
        btnText.textContent = 'Start Session';
        updateRTCUI(false);
        updateStatus('Ready', 'rgba(255,255,255,0.05)');
    }

    function playAudio(base64Data) {
        const blob = new Blob([Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))], { type: 'audio/mpeg' });
        const audio = new Audio(URL.createObjectURL(blob));
        audio.onplay = () => socket.send(JSON.stringify({ type: 'tts_start' }));
        audio.onended = () => socket.send(JSON.stringify({ type: 'tts_end' }));
        audio.play();
    }

    // UI Helpers
    function updateStatus(text, bg) {
        statusPill.textContent = text;
        statusPill.style.background = bg;
    }

    function updateSocketUI(online) {
        socketStatusEl.textContent = online ? 'WS: ONLINE' : 'WS: OFFLINE';
        socketStatusEl.style.color = online ? '#2dd4bf' : '#f43f5e';
    }

    function updateRTCUI(stable) {
        rtcStatusEl.textContent = stable ? 'RTC: STABLE' : 'RTC: IDLE';
        rtcStatusEl.style.color = stable ? '#2dd4bf' : 'inherit';
    }

    function addMessage(text, role) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}`;
        msgDiv.innerHTML = `<div class="bubble">${text}</div>`;
        messagesFeed.appendChild(msgDiv);
        setTimeout(() => { messagesFeed.scrollTop = messagesFeed.scrollHeight; }, 50);
    }

    micBtn.addEventListener('click', toggleSession);
});
