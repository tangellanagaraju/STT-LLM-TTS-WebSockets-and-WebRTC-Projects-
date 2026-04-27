document.addEventListener('DOMContentLoaded', () => {
    const micBtn = document.getElementById('mic-btn');
    const btnText = document.getElementById('btn-text');
    const messagesArea = document.getElementById('messages');
    const socketStatus = document.getElementById('socket-status');
    const webrtcStatus = document.getElementById('webrtc-status');

    let sessionActive = false;
    let isSpeaking = false;
    let isTtsSpeaking = false;  // true while the agent TTS is playing
    let silenceTimer = null;
    let audioContext = null;
    let analyser = null;
    let sourceNode = null;
    let stream = null;
    let socket = null;
    let pc = null;
    let vadAnimationId = null;

    const VAD_THRESHOLD = 0.02; // Volume threshold for speech detection
    const SILENCE_DURATION = 1500; // ms of consecutive silence to trigger processing

    if (webrtcStatus) {
        webrtcStatus.style.display = 'inline-block';
        webrtcStatus.textContent = 'WebRTC: Inactive';
    }

    function initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/voice/`;
        
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            socketStatus.textContent = 'WS: Connected';
            socketStatus.style.color = '#4ade80';
            console.log('✅ WebSocket Connected');
        };

        socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'info') {
                console.log('System:', data.message);
                addMessage(data.message, 'system');
            } else if (data.type === 'answer') {
                if (pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription({
                        type: 'answer',
                        sdp: data.sdp
                    }));
                    if (webrtcStatus) {
                        webrtcStatus.textContent = 'WebRTC: Active';
                        webrtcStatus.style.color = '#4ade80';
                    }
                }
            } else if (data.type === 'transcription') {
                addMessage(data.text, 'user');
            } else if (data.type === 'ai_response') {
                removeSystemMessage('Processing...');
                addMessage('🤖 ' + data.text, 'ai');
                speakText(data.text);
            } else if (data.type === 'error') {
                removeSystemMessage('Processing...');
                addMessage(`❌ Error: ${data.message}`, 'system');
            }
        };

        socket.onclose = () => {
            socketStatus.textContent = 'WS: Disconnected';
            socketStatus.style.color = '#ef4444';
            console.log('WebSocket disconnected, retrying in 3s...');
            setTimeout(initWebSocket, 3000); // Auto-reconnect
        };
    }

    async function toggleSession() {
        if (!sessionActive) {
            await startSession();
        } else {
            stopSession();
        }
    }

    async function startSession() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                alert("Audio recording not supported in this browser. Are you using HTTPS or localhost?");
                return;
            }

            stream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    echoCancellation: true, 
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });

            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 512;
            sourceNode = audioContext.createMediaStreamSource(stream);
            sourceNode.connect(analyser);

            sessionActive = true;
            isSpeaking = false;
            micBtn.classList.add('recording');
            btnText.textContent = 'Stop Session';
            
            removeSystemMessage('Session ended');
            addMessage('Session started. Listening...', 'system');

            await startWebRTC();
            monitorVAD();

        } catch (error) {
            console.error('Error starting session:', error);
            addMessage('Microphone access denied or error starting WebRTC.', 'system');
        }
    }

    async function startWebRTC() {
        if (pc) {
            pc.close();
            pc = null;
        }

        pc = new RTCPeerConnection();
        
        if (stream) {
            stream.getTracks().forEach(track => {
                pc.addTrack(track, stream);
            });
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'offer',
                sdp: offer.sdp
            }));
        }
    }

    function monitorVAD() {
        if (!sessionActive) return;
        
        vadAnimationId = requestAnimationFrame(monitorVAD);

        if (!analyser) return;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Float32Array(bufferLength);
        analyser.getFloatTimeDomainData(dataArray);

        let sumSquares = 0.0;
        for (let i = 0; i < bufferLength; i++) {
            sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / bufferLength);

        if (rms > VAD_THRESHOLD) {
            // If TTS is playing and the user starts speaking, treat it as an interrupt.
            // If TTS is NOT playing, it's genuine user speech — start capturing.
            if (!isSpeaking && !isTtsSpeaking) {
                isSpeaking = true;
                console.log('🗣️ User speech detected');

                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'interrupt' }));
                }

                removeSystemMessage('Listening...');
                removeSystemMessage('Processing...');
                addMessage('Listening...', 'system');

            } else if (!isSpeaking && isTtsSpeaking) {
                // User spoke while TTS was playing — interrupt TTS and start capturing.
                isSpeaking = true;
                isTtsSpeaking = false;
                console.log('🗣️ User interrupted TTS');

                if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                }
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'interrupt' }));
                }

                removeSystemMessage('Listening...');
                removeSystemMessage('Processing...');
                addMessage('Listening...', 'system');
            }
            if (silenceTimer) {
                clearTimeout(silenceTimer);
                silenceTimer = null;
            }
        } else {
            if (isSpeaking && !silenceTimer) {
                silenceTimer = setTimeout(() => {
                    isSpeaking = false;
                    console.log('🔇 Silence detected, processing');
                    
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ type: 'process_audio' }));
                    }

                    removeSystemMessage('Listening...');
                    addMessage('Processing...', 'system');
                    
                    // Immediately prepare a new WebRTC session via backend so the next
                    // spoken words are cleanly recorded.
                    startWebRTC();

                }, SILENCE_DURATION);
            }
        }
    }

    function stopSession() {
        sessionActive = false;
        isSpeaking = false;
        
        if (vadAnimationId) cancelAnimationFrame(vadAnimationId);
        if (silenceTimer) clearTimeout(silenceTimer);
        
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        
        if (pc) {
            pc.close();
            pc = null;
        }
        
        micBtn.classList.remove('recording');
        btnText.textContent = 'Start Session';
        if (webrtcStatus) {
            webrtcStatus.textContent = 'WebRTC: Inactive';
            webrtcStatus.style.color = 'inherit';
        }
        
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }

        removeSystemMessage('Listening...');
        removeSystemMessage('Processing...');
        addMessage('Session ended.', 'system');
    }

    function addMessage(text, role) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}-message`;
        if (role === 'system') {
            msgDiv.classList.add('system-message');
        }
        
        const bubble = document.createElement('span');
        bubble.className = 'bubble';
        bubble.textContent = text;
        
        msgDiv.appendChild(bubble);
        messagesArea.appendChild(msgDiv);
        
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    function removeSystemMessage(textFilter) {
        const msgs = document.querySelectorAll('.system-message, .system-message .bubble');
        for (let i = msgs.length - 1; i >= 0; i--) {
            // Find the closest parent with system-message
            const parentMsg = msgs[i].closest('.system-message');
            if (parentMsg && parentMsg.textContent.includes(textFilter)) {
                parentMsg.remove();
                // continue loop to remove any others just in case
            }
        }
    }

    function speakText(text) {
        if (!('speechSynthesis' in window)) return;

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;

        utterance.onstart = () => {
            isTtsSpeaking = true;
            console.log('🔊 TTS started');
        };

        utterance.onend = () => {
            isTtsSpeaking = false;
            console.log('🔇 TTS ended — returning to listen mode');

            if (sessionActive) {
                removeSystemMessage('Processing...');
                addMessage('Listening...', 'system');
                // Ensure a fresh WebRTC recording slot is ready for the next utterance.
                startWebRTC();
            }
        };

        utterance.onerror = () => {
            isTtsSpeaking = false;
            if (sessionActive) {
                removeSystemMessage('Processing...');
                addMessage('Listening...', 'system');
                startWebRTC();
            }
        };

        window.speechSynthesis.speak(utterance);
    }

    micBtn.addEventListener('click', toggleSession);
    initWebSocket();
});
