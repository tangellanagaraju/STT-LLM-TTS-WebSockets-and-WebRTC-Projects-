const startBtn = document.getElementById('startBtn');
const status = document.getElementById('status');
const bars = document.querySelectorAll('.bar');

let pc = null;
let ws = null;
let isSpeaking = false;

async function start() {
    startBtn.disabled = true;
    status.innerText = "Connecting...";

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = async () => {
        status.innerText = "WebRTC Ready.";
        await setupWebRTC();
        startBtn.disabled = false;
        startBtn.innerText = "Hold to Speak";
    };

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
        } else if (data.type === 'offer') {
            // Handle renegotiation (when server adds TTS track)
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({
                type: answer.type,
                sdp: answer.sdp
            }));
        } else if (data.type === 'transcript') {
            status.innerText = "You: " + data.text;
        } else if (data.type === 'response') {
            status.innerText = "AI: " + data.text;
        }
    };

    ws.onclose = () => {
        status.innerText = "Connection closed.";
        startBtn.disabled = false;
        startBtn.innerText = "Start Conversation";
    };
}

async function setupWebRTC() {
    pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.ontrack = (event) => {
        console.log("Incoming track:", event.track.kind);
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
    };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    // Offer to start the connection
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({
        type: offer.type,
        sdp: offer.sdp
    }));

    // Visualizer
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    source.connect(analyser);
    analyser.fftSize = 64;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function updateVisualizer() {
        analyser.getByteFrequencyData(dataArray);
        bars.forEach((bar, i) => {
            const height = (dataArray[i] / 255) * 60 + 20;
            bar.style.height = `${height}px`;
        });
        requestAnimationFrame(updateVisualizer);
    }
    updateVisualizer();
}

// Interaction logic: Hold to Speak
startBtn.onmousedown = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    isSpeaking = true;
    startBtn.style.background = "#ef4444";
    status.innerText = "Listening...";
    ws.send(JSON.stringify({ type: 'start_speaking' }));
};

startBtn.onmouseup = () => {
    if (!isSpeaking) return;
    isSpeaking = false;
    startBtn.style.background = "#3b82f6";
    status.innerText = "Processing...";
    ws.send(JSON.stringify({ type: 'stop_speaking' }));
};

// For mobile touch
startBtn.ontouchstart = startBtn.onmousedown;
startBtn.ontouchend = startBtn.onmouseup;

startBtn.onclick = () => {
    if (startBtn.innerText === "Start Conversation") {
        start();
    }
};
