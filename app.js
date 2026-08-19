const screenPreview = document.querySelector("#screenPreview");
const screenFrame = document.querySelector("#screenFrame");
const liveBadge = document.querySelector("#liveBadge");
const connectionStatus = document.querySelector("#connectionStatus");
const startShareHero = document.querySelector("#startShareHero");
const toggleShare = document.querySelector("#toggleShare");
const toggleMic = document.querySelector("#toggleMic");
const toggleCamera = document.querySelector("#toggleCamera");
const toggleChat = document.querySelector("#toggleChat");
const leaveButton = document.querySelector("#leaveButton");
const copyLinkButton = document.querySelector("#copyLinkButton");
const copyRoomLinkButton = document.querySelector("#copyRoomLinkButton");
const createRoomButton = document.querySelector("#createRoomButton");
const roomCode = document.querySelector("#roomCode");
const roomLink = document.querySelector("#roomLink");
const chatPanel = document.querySelector("#chatPanel");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const messages = document.querySelector("#messages");
const messageCount = document.querySelector("#messageCount");
const participantCount = document.querySelector("#participantCount");
const participantsList = document.querySelector("#participantsList");
const qualityLabel = document.querySelector("#qualityLabel");
const toast = document.querySelector("#toast");

const roomId = getRoomId();
const peerId = getPeerId();
const peers = new Map();
const participants = new Set([peerId]);
const pendingCandidates = new Map();
const remoteStream = new MediaStream();

let screenStream = null;
let eventSource = null;
let toastTimer = 0;

const rtcConfig = { iceServers: [] };

const qualityPresets = {
  "720p": { width: 1280, height: 720, frameRate: 30 },
  "1080p": { width: 1920, height: 1080, frameRate: 60 },
  "1440p": { width: 2560, height: 1440, frameRate: 60 },
};

function getRoomId() {
  const hashRoom = window.location.hash.replace("#", "").trim();

  if (hashRoom) {
    return hashRoom;
  }

  const generatedRoom = `sala-${crypto.randomUUID().slice(0, 8)}`;
  window.history.replaceState(null, "", `#${generatedRoom}`);
  return generatedRoom;
}

function getInviteLink() {
  return `${window.location.origin}${window.location.pathname}#${roomId}`;
}

function getPeerId() {
  const storedPeerId = sessionStorage.getItem("streamroom-peer-id");

  if (storedPeerId) {
    return storedPeerId;
  }

  const generatedPeerId = crypto.randomUUID();
  sessionStorage.setItem("streamroom-peer-id", generatedPeerId);
  return generatedPeerId;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function setRoomUi() {
  document.querySelector(".eyebrow").textContent = `Sala ${roomId}`;
  roomCode.textContent = roomId;
  roomLink.value = getInviteLink();
}

function setStatus(text, live = false) {
  connectionStatus.innerHTML = `<span class="dot"></span>${text}`;
  connectionStatus.querySelector(".dot").style.background = live ? "var(--danger)" : "var(--accent)";
}

function setVideoState(isLive, mode = "ready") {
  screenFrame.classList.toggle("is-live", isLive);
  liveBadge.hidden = !isLive;
  liveBadge.style.display = isLive ? "inline-flex" : "none";
  toggleShare.setAttribute("aria-pressed", String(Boolean(screenStream)));

  if (mode === "broadcast") {
    setStatus("Transmitindo", true);
    return;
  }

  if (mode === "watching") {
    setStatus("Assistindo", true);
    return;
  }

  setStatus(eventSource ? "Conectado" : "Pronto", false);
}

function updateParticipants() {
  participantCount.textContent = String(participants.size);
  participantsList.innerHTML = "";

  [...participants].forEach((id) => {
    const item = document.createElement("li");
    const isLocal = id === peerId;
    const label = getShortId(id);

    item.innerHTML = `
      <span class="avatar ${isLocal ? "host" : ""}"></span>
      <div>
        <strong></strong>
        <small></small>
      </div>
      <span class="mini-indicator active" title="Online"></span>
    `;
    item.querySelector(".avatar").textContent = isLocal ? "VO" : label.slice(0, 2);
    item.querySelector("strong").textContent = label;
    item.querySelector("small").textContent = isLocal ? "Este dispositivo" : "Conectado";
    participantsList.append(item);
  });
}

function getShortId(id) {
  return id === peerId ? "Voce" : id.slice(0, 4).toUpperCase();
}

function getSelectedQuality() {
  return document.querySelector(".segmented .selected")?.dataset.quality || "1080p";
}

async function sendSignal(message) {
  await fetch("/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      room: roomId,
      from: peerId,
      ...message,
    }),
  });
}

async function loadRtcConfig() {
  try {
    const response = await fetch("/config");
    const config = await response.json();
    rtcConfig.iceServers = config.iceServers?.length ? config.iceServers : [{ urls: "stun:stun.l.google.com:19302" }];
  } catch {
    rtcConfig.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

function connectSignaling() {
  eventSource = new EventSource(`/events?room=${encodeURIComponent(roomId)}&peer=${encodeURIComponent(peerId)}`);

  eventSource.onopen = () => {
    setVideoState(Boolean(screenStream || remoteStream.getTracks().length));
    sendSignal({ type: "viewer-ready", to: "all" });
  };

  eventSource.onerror = () => {
    setStatus("Reconectando");
  };

  eventSource.onmessage = async (event) => {
    const message = JSON.parse(event.data);

    if (message.from === peerId) {
      return;
    }

    await handleSignal(message);
  };
}

async function handleSignal(message) {
  const { type, from, payload } = message;

  if (from) {
    participants.add(from);
    updateParticipants();
  }

  if (type === "connected") {
    message.peers?.forEach((id) => participants.add(id));
    updateParticipants();
    return;
  }

  if (type === "peer-joined") {
    if (screenStream) {
      await createOffer(from);
    }
    return;
  }

  if (type === "peer-left") {
    closePeer(from);
    participants.delete(from);
    updateParticipants();
    return;
  }

  if (type === "stream-stopped") {
    closePeer(from);
    remoteStream.getTracks().forEach((track) => remoteStream.removeTrack(track));

    if (!screenStream) {
      screenPreview.srcObject = null;
      setVideoState(false);
    }
    return;
  }

  if (type === "viewer-ready" && screenStream) {
    await createOffer(from);
    return;
  }

  if (type === "broadcaster-ready" && !screenStream) {
    await sendSignal({ type: "viewer-ready", to: from });
    return;
  }

  if (type === "offer") {
    await receiveOffer(from, payload);
    return;
  }

  if (type === "answer") {
    await receiveAnswer(from, payload);
    return;
  }

  if (type === "ice-candidate") {
    await receiveCandidate(from, payload);
    return;
  }

  if (type === "chat") {
    renderMessage(getShortId(from), payload.text);
  }
}

function createPeerConnection(remotePeerId) {
  if (peers.has(remotePeerId)) {
    return peers.get(remotePeerId);
  }

  const peer = new RTCPeerConnection(rtcConfig);

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({
        type: "ice-candidate",
        to: remotePeerId,
        payload: event.candidate,
      });
    }
  };

  peer.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      if (!remoteStream.getTracks().some((item) => item.id === track.id)) {
        remoteStream.addTrack(track);
      }
    });

    screenPreview.muted = false;
    screenPreview.srcObject = remoteStream;
    setVideoState(true, "watching");
  };

  peer.onconnectionstatechange = () => {
    if (["closed", "disconnected", "failed"].includes(peer.connectionState)) {
      closePeer(remotePeerId);
    }
  };

  peers.set(remotePeerId, peer);
  return peer;
}

async function createOffer(remotePeerId) {
  const peer = createPeerConnection(remotePeerId);

  screenStream.getTracks().forEach((track) => {
    if (!peer.getSenders().some((sender) => sender.track?.id === track.id)) {
      peer.addTrack(track, screenStream);
    }
  });

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await sendSignal({ type: "offer", to: remotePeerId, payload: peer.localDescription });
}

async function receiveOffer(remotePeerId, offer) {
  const peer = createPeerConnection(remotePeerId);
  await peer.setRemoteDescription(offer);
  await flushPendingCandidates(remotePeerId, peer);

  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  await sendSignal({ type: "answer", to: remotePeerId, payload: peer.localDescription });
}

async function receiveAnswer(remotePeerId, answer) {
  const peer = peers.get(remotePeerId);

  if (!peer) {
    return;
  }

  await peer.setRemoteDescription(answer);
  await flushPendingCandidates(remotePeerId, peer);
}

async function receiveCandidate(remotePeerId, candidate) {
  const peer = peers.get(remotePeerId);

  if (!peer?.remoteDescription) {
    const queue = pendingCandidates.get(remotePeerId) || [];
    queue.push(candidate);
    pendingCandidates.set(remotePeerId, queue);
    return;
  }

  await peer.addIceCandidate(candidate);
}

async function flushPendingCandidates(remotePeerId, peer) {
  const queue = pendingCandidates.get(remotePeerId) || [];

  for (const candidate of queue) {
    await peer.addIceCandidate(candidate);
  }

  pendingCandidates.delete(remotePeerId);
}

function closePeer(remotePeerId) {
  peers.get(remotePeerId)?.close();
  peers.delete(remotePeerId);
  pendingCandidates.delete(remotePeerId);
}

async function startScreenShare() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast("Este navegador nao liberou captura de tela.");
    return;
  }

  if (!window.isSecureContext) {
    showToast("Para transmitir pela internet, abra o site em HTTPS.");
    return;
  }

  const preset = qualityPresets[getSelectedQuality()];
  const captureAudio = document.querySelector("#tabAudio").checked;

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate },
      },
      audio: captureAudio,
    });

    screenPreview.muted = true;
    screenPreview.srcObject = screenStream;
    setVideoState(true, "broadcast");
    showToast("Transmissao iniciada. Envie o convite para outro dispositivo.");

    const [track] = screenStream.getVideoTracks();
    track.addEventListener("ended", stopScreenShare, { once: true });

    await sendSignal({ type: "broadcaster-ready", to: "all" });
    await Promise.all([...participants].filter((id) => id !== peerId).map((id) => createOffer(id)));
  } catch (error) {
    if (error.name === "NotAllowedError") {
      showToast("Permissao de captura cancelada.");
      return;
    }

    showToast("Nao foi possivel iniciar a transmissao.");
    console.error(error);
  }
}

async function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }

  peers.forEach((peer) => peer.close());
  peers.clear();
  screenPreview.srcObject = null;
  remoteStream.getTracks().forEach((track) => remoteStream.removeTrack(track));
  setVideoState(false);
  await sendSignal({ type: "stream-stopped", to: "all" });
  showToast("Transmissao encerrada.");
}

function togglePressed(button) {
  const nextState = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(nextState));
  return nextState;
}

function renderMessage(author, text) {
  const article = document.createElement("article");
  article.innerHTML = `<strong></strong><p></p>`;
  article.querySelector("strong").textContent = author;
  article.querySelector("p").textContent = text;
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
  messageCount.textContent = String(messages.children.length);
}

startShareHero.addEventListener("click", startScreenShare);

toggleShare.addEventListener("click", () => {
  if (screenStream) {
    stopScreenShare();
  } else {
    startScreenShare();
  }
});

toggleMic.addEventListener("click", () => {
  const enabled = togglePressed(toggleMic);
  showToast(enabled ? "Microfone ligado." : "Microfone mutado.");
});

toggleCamera.addEventListener("click", () => {
  const enabled = togglePressed(toggleCamera);
  showToast(enabled ? "Camera ligada." : "Camera desligada.");
});

toggleChat.addEventListener("click", () => {
  const visible = togglePressed(toggleChat);
  chatPanel.style.display = visible ? "grid" : "none";
});

leaveButton.addEventListener("click", () => {
  stopScreenShare();
  eventSource?.close();
  setStatus("Desconectado");
});

copyLinkButton.addEventListener("click", async () => {
  const invite = getInviteLink();

  try {
    await navigator.clipboard.writeText(invite);
    showToast("Convite copiado.");
  } catch {
    showToast(invite);
  }
});

copyRoomLinkButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(getInviteLink());
    showToast("Convite copiado.");
  } catch {
    showToast(getInviteLink());
  }
});

createRoomButton.addEventListener("click", () => {
  const nextRoom = `sala-${crypto.randomUUID().slice(0, 8)}`;
  window.location.assign(`${window.location.origin}${window.location.pathname}#${nextRoom}`);
});

document.querySelectorAll("[data-quality]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-quality]").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    qualityLabel.textContent = button.dataset.quality;

    if (screenStream) {
      showToast("Reinicie a transmissao para aplicar a qualidade.");
    }
  });
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = messageInput.value.trim();

  if (!value) return;

  renderMessage("Voce", value);
  sendSignal({ type: "chat", to: "all", payload: { text: value } });
  messageInput.value = "";
});

window.addEventListener("beforeunload", () => {
  eventSource?.close();
  peers.forEach((peer) => peer.close());
  screenStream?.getTracks().forEach((track) => track.stop());
});

setRoomUi();
updateParticipants();
setVideoState(false);
loadRtcConfig().then(connectSignaling);
