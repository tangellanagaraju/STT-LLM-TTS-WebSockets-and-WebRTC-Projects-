const userName = "User-" + Math.floor(Math.random() * 100000);
document.querySelector('#user-name').innerHTML = userName;

// WebSocket setup
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}/ws/${userName}`;
const socket = new WebSocket(wsUrl);

const localVideoEl = document.querySelector('#local-video');
const remoteVideoEl = document.querySelector('#remote-video');
const answerEl = document.querySelector('#answer');
const callBtn = document.querySelector('#call');
const hangupBtn = document.querySelector('#hangup');
const waitingEl = document.querySelector('#waiting');

let localStream;
let remoteStream;
let peerConnection;
let didIOffer = false;

const peerConfiguration = {
    iceServers: [
        {
            urls: [
                'stun:stun.l.google.com:19302',
                'stun:stun1.l.google.com:19302'
            ]
        }
    ]
};

// --- WebSocket Event Listeners ---

socket.onopen = () => {
    console.log("Connected to signaling server");
};

socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const { type, data } = message;

    switch (type) {
        case 'availableOffers':
            console.log("Available offers:", data);
            createOfferEls(data);
            break;
        case 'newOfferAwaiting':
            console.log("New offer awaiting:", data);
            createOfferEls(data);
            break;
        case 'answerResponse':
            console.log("Answer response:", data);
            addAnswer(data);
            break;
        case 'receivedIceCandidateFromServer':
            console.log("Received ICE candidate:", data);
            addNewIceCandidate(data);
            break;
        case 'answerAck':
            // This emulates the socket.io ack for newAnswer
            console.log("Received answer ack (initial ICE candidates):", data);
            data.forEach(c => {
                peerConnection.addIceCandidate(c);
                console.log("Added ICE Candidate from Ack");
            });
            break;
    }
};

// --- WebRTC Logic ---

const fetchUserMedia = () => {
    return new Promise(async (resolve, reject) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
            });
            localVideoEl.srcObject = stream;
            localStream = stream;
            resolve();
        } catch (err) {
            console.error("Error fetching media:", err);
            reject(err);
        }
    });
};

const createPeerConnection = (offerObj) => {
    return new Promise(async (resolve, reject) => {
        peerConnection = new RTCPeerConnection(peerConfiguration);
        remoteStream = new MediaStream();
        remoteVideoEl.srcObject = remoteStream;

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        peerConnection.addEventListener('icecandidate', e => {
            if (e.candidate) {
                socket.send(JSON.stringify({
                    type: 'sendIceCandidateToSignalingServer',
                    data: {
                        iceCandidate: e.candidate,
                        didIOffer: didIOffer
                    }
                }));
            }
        });

        peerConnection.addEventListener('track', e => {
            e.streams[0].getTracks().forEach(track => {
                remoteStream.addTrack(track, remoteStream);
            });
        });

        if (offerObj) {
            await peerConnection.setRemoteDescription(offerObj.offer);
        }
        resolve();
    });
};

const call = async () => {
    try {
        await fetchUserMedia();
        await createPeerConnection();
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        didIOffer = true;
        
        socket.send(JSON.stringify({
            type: 'newOffer',
            data: offer
        }));
        
        waitingEl.style.display = 'block';
        callBtn.style.display = 'none';
        hangupBtn.style.display = 'flex';
    } catch (err) {
        console.error("Call error:", err);
    }
};

const answerOffer = async (offerObj) => {
    try {
        await fetchUserMedia();
        await createPeerConnection(offerObj);
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        offerObj.answer = answer;
        
        socket.send(JSON.stringify({
            type: 'newAnswer',
            data: offerObj
        }));
        
        callBtn.style.display = 'none';
        hangupBtn.style.display = 'flex';
        answerEl.innerHTML = ''; // Clear offers after answering
    } catch (err) {
        console.error("Answer error:", err);
    }
};

const addAnswer = async (offerObj) => {
    await peerConnection.setRemoteDescription(offerObj.answer);
    waitingEl.style.display = 'none';
};

const addNewIceCandidate = iceCandidate => {
    if (peerConnection) {
        peerConnection.addIceCandidate(iceCandidate);
    }
};

function createOfferEls(offers) {
    offers.forEach(o => {
        if (o.offererUserName === userName) return; // Don't show our own offer
        
        const exists = document.querySelector(`[data-offerer="${o.offererUserName}"]`);
        if (exists) return;

        const btn = document.createElement('button');
        btn.className = 'btn btn-success';
        btn.dataset.offerer = o.offererUserName;
        btn.innerHTML = `Answer ${o.offererUserName}`;
        btn.onclick = () => answerOffer(o);
        answerEl.appendChild(btn);
    });
}

const hangup = () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    localVideoEl.srcObject = null;
    remoteVideoEl.srcObject = null;
    
    callBtn.style.display = 'flex';
    hangupBtn.style.display = 'none';
    waitingEl.style.display = 'none';
    
    // Refresh to clear state (simple way to reset signaling)
    window.location.reload();
};

callBtn.addEventListener('click', call);
hangupBtn.addEventListener('click', hangup);