const screenPreview = document.querySelector("#screenPreview");
const screenFrame = document.querySelector("#screenFrame");
const liveBadge = document.querySelector("#liveBadge");
const connectionStatus = document.querySelector("#connectionStatus");
const startShareHero = document.querySelector("#startShareHero");
const toggleShare = document.querySelector("#toggleShare");
const toggleMic = document.querySelector("#toggleMic");
const toggleCamera = document.querySelector("#toggleCamera");
const leaveButton = document.querySelector("#leaveButton");
const copyLinkButton = document.querySelector("#copyLinkButton");
const copyRoomLinkButton = document.querySelector("#copyRoomLinkButton");
const createRoomForm = document.querySelector("#createRoomForm");
const newRoomName = document.querySelector("#newRoomName");
const newRoomLimit = document.querySelector("#newRoomLimit");
const profileForm = document.querySelector("#profileForm");
const profileName = document.querySelector("#profileName");
const profilePhoto = document.querySelector("#profilePhoto");
const profilePreview = document.querySelector("#profilePreview");
const roomCode = document.querySelector("#roomCode");
const roomLink = document.querySelector("#roomLink");
const roomMeta = document.querySelector("#roomMeta");
const participantCount = document.querySelector("#participantCount");
const participantsList = document.querySelector("#participantsList");
const qualityLabel = document.querySelector("#qualityLabel");
const toast = document.querySelector("#toast");

const roomId = getRoomId();
const peerId = getPeerId();
const localProfile = getLocalProfile();
const peers = new Map();
const participants = new Map([[peerId, localProfile]]);
const pendingCandidates = new Map();
const remoteStream = new MediaStream();
const roomState = {
  id: roomId,
  name: `Sala ${roomId.replace("sala-", "")}`,
  limit: 8,
  count: 1,
};

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

function getLocalProfile() {
  const savedProfile = JSON.parse(localStorage.getItem("streamroom-profile") || "{}");
  const name = String(savedProfile.name || "").trim() || "Convidado";

  return {
    name: name.slice(0, 32),
    photo: String(savedProfile.photo || ""),
  };
}

function saveLocalProfile(profile) {
  localStorage.setItem("streamroom-profile", JSON.stringify(profile));
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function setRoomUi() {
  document.querySelector(".eyebrow").textContent = roomState.name;
  roomCode.textContent = roomId;
  roomLink.value = getInviteLink();
  roomMeta.textContent = `${roomState.count}/${roomState.limit} pessoas`;
  newRoomName.value = roomState.name;
}

function setProfileUi() {
  profileName.value = localProfile.name;
  renderAvatar(profilePreview, localProfile, true);
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
  roomState.count = participants.size;
  roomMeta.textContent = `${roomState.count}/${roomState.limit} pessoas`;
  participantsList.innerHTML = "";

  [...participants.entries()].forEach(([id, profile]) => {
    const item = document.createElement("li");
    const isLocal = id === peerId;

    item.innerHTML = `
      <span class="avatar ${isLocal ? "host" : ""}" aria-hidden="true"></span>
      <div>
        <strong></strong>
        <small></small>
      </div>
      <span class="mini-indicator active" title="Online"></span>
    `;
    renderAvatar(item.querySelector(".avatar"), profile, isLocal);
    item.querySelector("strong").textContent = profile.name || getShortId(id);
    item.querySelector("small").textContent = isLocal ? "Este dispositivo" : "Conectado";
    participantsList.append(item);
  });
}

function renderAvatar(element, profile, isLocal = false) {
  element.textContent = "";
  element.style.backgroundImage = "";
  element.classList.toggle("has-photo", Boolean(profile.photo));
  element.classList.toggle("host", isLocal);

  if (profile.photo) {
    element.style.backgroundImage = `url("${profile.photo}")`;
    return;
  }

  element.textContent = getInitials(profile.name);
}

function getInitials(name) {
  return String(name || "Convidado")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
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

async function loadRoom() {
  try {
    const response = await fetch(`/room?room=${encodeURIComponent(roomId)}`);
    const room = await response.json();
    Object.assign(roomState, room);
  } catch {
    Object.assign(roomState, {
      id: roomId,
      name: `Sala ${roomId.replace("sala-", "")}`,
      limit: 8,
      count: participants.size,
    });
  }
}

function connectSignaling() {
  const params = new URLSearchParams({
    room: roomId,
    peer: peerId,
    name: localProfile.name,
  });
  eventSource = new EventSource(`/events?${params}`);

  eventSource.onopen = () => {
    setVideoState(Boolean(screenStream || remoteStream.getTracks().length));
    sendSignal({ type: "viewer-ready", to: "all" });
    sendSignal({ type: "profile-updated", to: "all", profile: localProfile });
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
  const { type, from, payload, profile } = message;

  if (from) {
    participants.set(from, profile || participants.get(from) || { name: getShortId(from), photo: "" });
    updateParticipants();
  }

  if (type === "room-full") {
    showToast(`A sala ${message.room.name} ja atingiu o limite de ${message.room.limit} pessoas.`);
    eventSource?.close();
    setStatus("Sala cheia");
    return;
  }

  if (type === "connected") {
    Object.assign(roomState, message.room || {});
    message.peers?.forEach((peer) => participants.set(peer.id, peer.profile || { name: getShortId(peer.id), photo: "" }));
    setRoomUi();
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

  if (type === "profile-updated") {
    participants.set(from, profile || payload || participants.get(from));
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
    await Promise.all([...participants.keys()].filter((id) => id !== peerId).map((id) => createOffer(id)));
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

createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const response = await fetch("/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: newRoomName.value,
      limit: newRoomLimit.value,
    }),
  });
  const room = await response.json();
  window.location.assign(`${window.location.origin}${window.location.pathname}#${room.id}`);
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  localProfile.name = profileName.value.trim().slice(0, 32) || "Convidado";
  saveLocalProfile(localProfile);
  participants.set(peerId, localProfile);
  setProfileUi();
  updateParticipants();
  await sendSignal({ type: "profile-updated", to: "all", profile: localProfile });
  showToast("Perfil atualizado.");
});

profilePhoto.addEventListener("change", () => {
  const [file] = profilePhoto.files;

  if (!file) {
    return;
  }

  if (file.size > 180000) {
    showToast("Use uma imagem menor que 180 KB.");
    profilePhoto.value = "";
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    localProfile.photo = reader.result;
    saveLocalProfile(localProfile);
    participants.set(peerId, localProfile);
    setProfileUi();
    updateParticipants();
    sendSignal({ type: "profile-updated", to: "all", profile: localProfile });
  });
  reader.readAsDataURL(file);
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

window.addEventListener("beforeunload", () => {
  eventSource?.close();
  peers.forEach((peer) => peer.close());
  screenStream?.getTracks().forEach((track) => track.stop());
});

setProfileUi();
updateParticipants();
setVideoState(false);
Promise.all([loadRoom(), loadRtcConfig()]).then(() => {
  setRoomUi();
  connectSignaling();
});
