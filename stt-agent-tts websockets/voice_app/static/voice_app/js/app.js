document.addEventListener('DOMContentLoaded', () => {
    const micBtn = document.getElementById('mic-btn');
    const btnText = document.getElementById('btn-text');
    const messagesArea = document.getElementById('messages');
    const socketStatus = document.getElementById('socket-status');
    const webrtcStatus = document.getElementById('webrtc-status');

    let isRecording = false;
    let mediaRecorder = null;
    let socket = null;

    // We only need WebSockets for this architecture architecture.
    // STUN/TURN (WebRTC) is not needed when streaming audio blobs directly to the backend over WebSocket.
    if (webrtcStatus) {
        webrtcStatus.style.display = 'none'; // Hide WebRTC status
    }

    function initWebSocket() {
        // WSS is essential for mobile browsers (HTTPS requirement)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/voice/`;
        
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            socketStatus.textContent = 'WS: Connected';
            socketStatus.style.color = '#4ade80';
            console.log('✅ WebSocket Connected');
        };

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'info') {
                console.log('System:', data.message);
                addMessage(data.message, 'system');
            } else if (data.type === 'transcription') {
                addMessage(data.text, 'user');
            } else if (data.type === 'ai_response') {
                addMessage('🤖 ' + data.text, 'ai');
                speakText(data.text);
            } else if (data.type === 'error') {
                addMessage(`❌ Error: ${data.message}`, 'system');
                if (isRecording) stopRecording();
            }
        };

        socket.onclose = () => {
            socketStatus.textContent = 'WS: Disconnected';
            socketStatus.style.color = '#ef4444';
            console.log('WebSocket disconnected, retrying in 3s...');
            setTimeout(initWebSocket, 3000); // Auto-reconnect
        };
    }

    async function toggleRecording() {
        if (!isRecording) {
            await startRecording();
        } else {
            stopRecording();
        }
    }

    let currentMimeType = '';

    async function startRecording() {
        try {
            // Essential for mobile: navigator.mediaDevices must be available (requires HTTPS)
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                alert("Audio recording not supported in this browser. Are you using HTTPS or localhost?");
                return;
            }

            // Only request audio, with noise suppression for better STT
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    echoCancellation: true, 
                    noiseSuppression: true 
                } 
            });

            // Find best mime type for mobile compatibility
            currentMimeType = '';
            if (MediaRecorder.isTypeSupported('audio/webm')) {
                currentMimeType = 'audio/webm';
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                currentMimeType = 'audio/mp4'; // iOS Safari fallback
            } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
                currentMimeType = 'audio/ogg'; // Android Firefox fallback
            }

            mediaRecorder = new MediaRecorder(stream, currentMimeType ? { mimeType: currentMimeType } : {});

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0 && socket && socket.readyState === WebSocket.OPEN) {
                    // Start streaming binary audio chunk to the Django Consumer
                    socket.send(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                // Stop microphone access
                stream.getTracks().forEach(track => track.stop());
                
                // Instruct backend to transcribe and process the gathered audio blobs
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'process_audio', mimeType: currentMimeType }));
                }
            };

            mediaRecorder.start(250); // Capture chunks every 250ms

            
            isRecording = true;
            micBtn.classList.add('recording');
            btnText.textContent = 'Stop & Send';
            addMessage('Listening...', 'system');

        } catch (error) {
            console.error('Error accessing microphone:', error);
            addMessage('Microphone access denied. Please check permissions.', 'system');
        }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        isRecording = false;
        micBtn.classList.remove('recording');
        btnText.textContent = 'Start Speaking';
        
        // Remove 'Listening...' message
        removeSystemMessage('Listening...');
        addMessage('Processing audio...', 'system');
    }

    function addMessage(text, role) {
        removeSystemMessage('Processing audio...');

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}-message`;
        
        const bubble = document.createElement('span');
        bubble.className = 'bubble';
        bubble.textContent = text;
        
        msgDiv.appendChild(bubble);
        messagesArea.appendChild(msgDiv);
        
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    function removeSystemMessage(textFilter) {
        const msgs = document.querySelectorAll('.system-message');
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].textContent.includes(textFilter)) {
                msgs[i].remove();
                break;
            }
        }
    }

    function speakText(text) {
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.0;
            // Best effort voice
            window.speechSynthesis.speak(utterance);
        }
    }

    micBtn.addEventListener('click', toggleRecording);
    initWebSocket();
});
