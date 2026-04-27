/**
 * Stellaris AI - Voice Application Logic
 * 
 * This file manages the frontend interaction:
 * 1. WebSocket communication for signaling.
 * 2. WebRTC for real-time audio streaming to the server.
 * 3. Voice Activity Detection (VAD) to detect when the user starts and stops speaking.
 * 4. UI updates and audio playback.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- UI Element Selectors ---
    const micBtn = document.getElementById('mic-btn');
    const btnText = document.getElementById('btn-text');
    const messagesFeed = document.getElementById('messages');
    const socketStatusEl = document.getElementById('socket-status');
    const rtcStatusEl = document.getElementById('webrtc-status');
    const statusPill = document.getElementById('vad-indicator');

    // --- Application State ---
    let isSessionActive = false; // Tracks if the user has started the session
    let socket = null;          // WebSocket connecting us to the Django backend
    let pc = null;              // RTCPeerConnection for streaming audio
    let stream = null;          // Local microphone media stream
    let myVad = null;           // VAD instance to monitor the microphone
    let sessionId = localStorage.getItem('voice_session_id'); // Persistence for conversation history

    // Initialize the WebSocket connection as soon as the page loads
    initWebSocket();

    /**
     * Sets up the WebSocket connection for real-time signaling.
     * Signaling is used to exchange WebRTC configuration and state changes.
     */
    function initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/voice/`;

        console.log(`Connecting to WebSocket: ${wsUrl}`);
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('WebSocket Connected');
            updateSocketUI(true);
            // Inform the server of our session ID to regain conversation history
            socket.send(JSON.stringify({ type: 'init_session', session_id: sessionId }));
        };

        socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            console.log('Received Message:', data.type, data);

            switch (data.type) {
                case 'session_created':
                    // Store the new session ID provided by the server
                    sessionId = data.session_id;
                    localStorage.setItem('voice_session_id', sessionId);
                    break;

                case 'info':
                    addMessage(data.message, 'system');
                    break;

                case 'ready':
                    // Server is ready for new input
                    updateStatus('Ready', 'rgba(255,255,255,0.05)');
                    if (myVad && isSessionActive) myVad.start();
                    break;

                case 'answer':
                    // Server responded with its WebRTC answer
                    if (pc) {
                        try {
                            await pc.setRemoteDescription(new RTCSessionDescription({
                                type: 'answer',
                                sdp: data.sdp
                            }));
                            
                            
                            (true);
                            console.log('WebRTC Connection Established');
                        } catch (err) {
                            console.error('Error setting remote description:', err);
                        }
                    }
                    break;

                case 'transcription':
                    // Display what the AI heard
                    addMessage(data.text, 'user');
                    updateStatus('Thinking...', 'rgba(192, 132, 252, 0.2)');
                    break;

                case 'ai_response':
                    // Display AI's text response and play its audio
                    addMessage(data.text, 'ai');
                    if (data.audio) {
                        playAudio(data.audio);
                    } else {
                        // If no audio (e.g., error), reset state
                        socket.send(JSON.stringify({ type: 'tts_end' }));
                        if (myVad && isSessionActive) myVad.start();
                    }
                    break;

                case 'error':
                    addMessage(`⚠️ ${data.message}`, 'system');
                    updateStatus('Error', 'rgba(244, 63, 94, 0.2)');
                    if (myVad && isSessionActive) myVad.start();
                    break;
            }
        };

        socket.onclose = () => {
            console.log('WebSocket Disconnected');
            updateSocketUI(false);
            // Attempt to reconnect every 2 seconds if the connection is lost
            setTimeout(initWebSocket, 2000);
        };
    }

    /**
     * Toggles the voice session on or off.
     */
    async function toggleSession() {
        if (!isSessionActive) {
            await startSession();
        } else {
            stopSession();
        }
    }

    /**
     * Starts the voice session:
     * 1. Requests microphone access.
     * 2. Sets up the WebRTC connection.
     * 3. Initializes Voice Activity Detection (VAD).
     */
    async function startSession() {
        try {
            updateStatus('Starting...', 'rgba(255, 255, 255, 0.1)');

            // --- 1. Get Microphone Access ---
            // We request high-quality audio with noise suppression
            stream = await navigator.mediaDevices.getUserMedia({
                audio:true
                // audio: {
                //     echoCancellation: true,
                //     noiseSuppression: true,
                //     autoGainControl: true
                // }
            });

            // --- 2. Establish WebRTC Link ---
            // We use a STUN server to help bypass firewalls
            pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });

            // Add our audio tracks to the peer connection
            stream.getTracks().forEach(track => pc.addTrack(track, stream));

            // Create an 'offer' to start the WebRTC handshake
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            // Send our offer to the server via WebSocket
            socket.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));

            // --- 3. Initialize VAD (Voice Activity Detection) ---
            // This detects when someone is speaking vs. silence
            myVad = await vad.MicVAD.new({
                stream: stream,
                onSpeechStart: () => {
                    // Logic triggered when speaking is detected
                    if (isSessionActive) {
                        console.log('Speech Started');
                        socket.send(JSON.stringify({ type: 'speech_start' }));
                        updateStatus('Listening...', 'rgba(45, 212, 191, 0.2)');
                    }
                },
                onSpeechEnd: () => {
                    // Logic triggered when the speaker stops
                    if (isSessionActive) {
                        console.log('Speech Ended');
                        // Immediately pause VAD so we don't capture background noise while thinking
                        myVad.pause();
                        socket.send(JSON.stringify({ type: 'speech_end' }));
                        updateStatus('Processing...', 'rgba(250, 204, 21, 0.2)');
                    }
                },
                positiveSpeechThreshold: 0.6, // Sensitivity to speech
                negativeSpeechThreshold: 0.4, // Sensitivity to silence
                minSpeechFrames: 3,           // Minimum duration to count as speech
                redemptionFrames: 8           // Buffer to prevent cutting off short pauses
            });

            // Start everything
            myVad.start();
            isSessionActive = true;
            micBtn.classList.add('recording');
            btnText.textContent = 'Stop Session';

        } catch (error) {
            console.error('Failed to start session:', error);
            stopSession();
        }
    }

    /**
     * Cleans up the session and releases resources.
     */
    function stopSession() {
        // Stop VAD monitoring
        if (myVad) {
            try { myVad.pause(); } catch (e) { }
            myVad = null;
        }

        // Release microphone access
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }

        // Close WebRTC connection
        if (pc) {
            pc.close();
            pc = null;
        }

        // Inform the server the session is over
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'stop_session' }));
        }

        isSessionActive = false;
        micBtn.classList.remove('recording');
        btnText.textContent = 'Start Session';
        updateRTCUI(false);
        updateStatus('Ready', 'rgba(255,255,255,0.05)');
    }

    /**
     * Plays the AI's response audio.
     * @param {string} base64Data - The audio data in base64 format.
     */
    function playAudio(base64Data) {
        // Ensure VAD is paused so it doesn't try to record the AI's voice
        if (myVad) myVad.pause();

        // Convert base64 string back to binary data
        const binaryData = atob(base64Data);
        const arrayBuffer = new Uint8Array(binaryData.length);
        for (let i = 0; i < binaryData.length; i++) {
            arrayBuffer[i] = binaryData.charCodeAt(i);
        }

        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);

        audio.onplay = () => {
            // Inform the server AI has started speaking
            socket.send(JSON.stringify({ type: 'tts_start' }));
            updateStatus('Speaking...', 'rgba(129, 140, 248, 0.2)');
        };

        audio.onended = () => {
            // Signal server that speech is finished
            socket.send(JSON.stringify({ type: 'tts_end' }));
            updateStatus('Ready', 'rgba(255,255,255,0.05)');

            // Resume VAD only after audio playback is done, ready for next user input
            if (myVad && isSessionActive) {
                myVad.start();
            }
        };

        audio.play().catch(e => {
            console.error("Audio playback failed:", e);
            // On failure, still attempt to recover and resume
            if (myVad && isSessionActive) myVad.start();
            socket.send(JSON.stringify({ type: 'tts_end' }));
        });
    }

    // --- UI Helper Functions ---

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

        // Use a small timeout to ensure DOM update before scrolling
        setTimeout(() => {
            messagesFeed.scrollTop = messagesFeed.scrollHeight;
        }, 50);
    }

    micBtn.addEventListener('click', toggleSession);
});
