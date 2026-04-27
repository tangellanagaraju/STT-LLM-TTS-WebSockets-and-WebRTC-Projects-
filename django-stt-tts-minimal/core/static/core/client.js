const toggleBtn = document.getElementById('toggleBtn');
const status = document.getElementById('status');
const indicator = document.getElementById('indicator');
const transcriptDiv = document.getElementById('transcript');

let pc = null;
let ws = null;
let isActive = false;
let isAiSpeaking = false;

// --- SIMPLE VAD LOGIC ---
let audioContext = null;
let analyser = null;
let micStream = null;
let speechDetectionInterval = null;
let silenceStart = null;
let isSpeaking = false;

const THRESHOLD = 0.05;
const SILENCE_DURATION = 1500;

function startSimpleVAD(stream) {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);

    speechDetectionInterval = setInterval(() => {
        if (isAiSpeaking || !isActive) return;

        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const volume = Math.sqrt(sum / bufferLength);

        if (volume > THRESHOLD) {
            if (!isSpeaking) {
                isSpeaking = true;
                indicator.classList.add('speaking');
                status.innerText = "Listening...";
                sendMsg({ type: 'start_speaking' });
            }
            silenceStart = null;
        } else if (isSpeaking) {
            if (!silenceStart) silenceStart = Date.now();
            
            if (Date.now() - silenceStart > SILENCE_DURATION) {
                isSpeaking = false;
                indicator.classList.remove('speaking');
                status.innerText = "Thinking...";
                sendMsg({ type: 'stop_speaking' });
                silenceStart = null;
            }
        }
    }, 100);
}

// --- SESSION LOGIC ---

async function startSession() {
    try {
        isActive = true;
        toggleBtn.classList.add('active');
        indicator.classList.add('active');
        status.innerText = "Connecting...";

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws/voice/`);

        ws.onopen = async () => {
            console.log("WebSocket connected");
            await setupWebRTC();
            status.innerText = "Active. Speak naturally.";
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data));
            } else if (data.type === 'transcript') {
                transcriptDiv.innerHTML = `<div class="user-text">You: ${data.text}</div>` + transcriptDiv.innerHTML;
            } else if (data.type === 'response') {
                transcriptDiv.innerHTML = `<div class="ai-text">AI: ${data.text}</div>` + transcriptDiv.innerHTML;
            } else if (data.type === 'audio') {
                playBase64Audio(data.data);
            }
        };

        ws.onclose = () => stopSession();

    } catch (e) {
        console.error("Session Start Error:", e);
        status.innerText = "Error: Mic access denied";
        stopSession();
    }
}

async function playBase64Audio(base64Data) {
    console.log("Playing AI Audio...");
    const audioBlob = b64toBlob(base64Data, 'audio/mp3');
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    
    isAiSpeaking = true;
    status.innerText = "AI is speaking...";
    indicator.classList.add('speaking');
    
    audio.play();
    audio.onended = () => {
        isAiSpeaking = false;
        indicator.classList.remove('speaking');
        status.innerText = "Listening...";
        URL.revokeObjectURL(audioUrl);
    };
}

function b64toBlob(b64Data, contentType = '', sliceSize = 512) {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        const slice = byteCharacters.slice(offset, offset + sliceSize);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
}

async function setupWebRTC() {
    pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getTracks().forEach(track => pc.addTrack(track, micStream));

    startSimpleVAD(micStream);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendMsg({ type: offer.type, sdp: offer.sdp });
}

function stopSession() {
    isActive = false;
    toggleBtn.classList.remove('active');
    indicator.classList.remove('active', 'speaking');
    status.innerText = "Stopped";
    
    if (speechDetectionInterval) clearInterval(speechDetectionInterval);
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    if (ws) ws.close();
    if (pc) pc.close();
    
    ws = null;
    pc = null;
}

function sendMsg(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

toggleBtn.onclick = () => {
    if (isActive) stopSession();
    else startSession();
};
