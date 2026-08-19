const screenFrame = document.querySelector("#screenFrame");
const streamGrid = document.querySelector("#streamGrid");
const emptyState = document.querySelector("#emptyState");
const liveBadge = document.querySelector("#liveBadge");
const connectionStatus = document.querySelector("#connectionStatus");
const startShareHero = document.querySelector("#startShareHero");
const toggleShare = document.querySelector("#toggleShare");
const toggleMic = document.querySelector("#toggleMic");
const toggleCamera = document.querySelector("#toggleCamera");
const leaveButton = document.querySelector("#leaveButton");
const drawerToggle = document.querySelector("#drawerToggle");
const drawerClose = document.querySelector("#drawerClose");
const drawerBackdrop = document.querySelector("#drawerBackdrop");
const sidebar = document.querySelector("#sidebar");
const copyRoomLinkButton = document.querySelector("#copyRoomLinkButton");
const createRoomForm = document.querySelector("#createRoomForm");
const newRoomName = document.querySelector("#newRoomName");
const newRoomLimit = document.querySelector("#newRoomLimit");
const profileForm = document.querySelector("#profileForm");
const profileName = document.querySelector("#profileName");
const profilePhoto = document.querySelector("#profilePhoto");
const profilePreview = document.querySelector("#profilePreview");
const photoEditor = document.querySelector("#photoEditor");
const cropArea = document.querySelector("#cropArea");
const cropImage = document.querySelector("#cropImage");
const cropZoom = document.querySelector("#cropZoom");
const cropX = document.querySelector("#cropX");
const cropY = document.querySelector("#cropY");
const savePhotoEdit = document.querySelector("#savePhotoEdit");
const cancelPhotoEdit = document.querySelector("#cancelPhotoEdit");
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
const streamCards = new Map();
const localSenders = new Map();
const roomState = {
  id: roomId,
  name: `Sala ${roomId.replace("sala-", "")}`,
  limit: 8,
  count: 1,
};

let screenStream = null;
let eventSource = null;
let toastTimer = 0;
let focusedStreamId = null;
let cropSource = null;

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

function setDrawerOpen(isOpen) {
  sidebar.classList.toggle("is-open", isOpen);
  drawerToggle.setAttribute("aria-expanded", String(isOpen));
  sidebar.setAttribute("aria-hidden", String(!isOpen));

  if (isOpen) {
    drawerBackdrop.hidden = false;
    requestAnimationFrame(() => drawerBackdrop.classList.add("is-open"));
    return;
  }

  drawerBackdrop.classList.remove("is-open");
  window.setTimeout(() => {
    drawerBackdrop.hidden = true;
  }, 180);
}

function setPhotoEditorOpen(isOpen) {
  photoEditor.hidden = !isOpen;
}

function resetCropControls() {
  cropZoom.value = "1";
  cropX.value = "0";
  cropY.value = "0";
}

function updateCropPreview() {
  const zoom = Number(cropZoom.value);
  const x = Number(cropX.value);
  const y = Number(cropY.value);
  const naturalRatio = cropImage.naturalWidth / cropImage.naturalHeight;
  const boxSize = cropArea.clientWidth;

  if (naturalRatio >= 1) {
    cropImage.style.height = `${boxSize * zoom}px`;
    cropImage.style.width = "auto";
  } else {
    cropImage.style.width = `${boxSize * zoom}px`;
    cropImage.style.height = "auto";
  }

  cropImage.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}

function openPhotoEditor(source) {
  cropSource = source;
  resetCropControls();
  cropImage.src = source;
  cropImage.onload = updateCropPreview;
  setPhotoEditorOpen(true);
}

function closePhotoEditor() {
  setPhotoEditorOpen(false);
  cropSource = null;
  cropImage.removeAttribute("src");
  profilePhoto.value = "";
}

function createCroppedPhoto() {
  const outputSize = 256;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const zoom = Number(cropZoom.value);
  const offsetX = Number(cropX.value) * (outputSize / cropArea.clientWidth);
  const offsetY = Number(cropY.value) * (outputSize / cropArea.clientHeight);
  const fitScale = Math.min(outputSize / cropImage.naturalWidth, outputSize / cropImage.naturalHeight);
  const drawWidth = cropImage.naturalWidth * fitScale * zoom;
  const drawHeight = cropImage.naturalHeight * fitScale * zoom;
  const drawX = (outputSize - drawWidth) / 2 + offsetX;
  const drawY = (outputSize - drawHeight) / 2 + offsetY;

  canvas.width = outputSize;
  canvas.height = outputSize;
  context.fillStyle = "#101114";
  context.fillRect(0, 0, outputSize, outputSize);
  context.drawImage(cropImage, drawX, drawY, drawWidth, drawHeight);

  return canvas.toDataURL("image/jpeg", 0.84);
}

function setStatus(text, live = false) {
  connectionStatus.innerHTML = `<span class="dot"></span>${text}`;
  connectionStatus.querySelector(".dot").style.background = live ? "var(--danger)" : "var(--accent)";
}

function setVideoState(isLive, mode = "ready") {
  const hasStreams = streamCards.size > 0;
  screenFrame.classList.toggle("is-live", hasStreams);
  emptyState.hidden = hasStreams;
  liveBadge.hidden = !screenStream;
  liveBadge.style.display = screenStream ? "inline-flex" : "none";
  toggleShare.setAttribute("aria-pressed", String(Boolean(screenStream)));

  if (mode === "broadcast") {
    setStatus("Transmitindo", true);
    return;
  }

  if (mode === "watching") {
    setStatus("Assistindo", true);
    return;
  }

  setStatus(eventSource ? (hasStreams ? "Assistindo" : "Conectado") : "Pronto", false);
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
  element.innerHTML = "";
  element.classList.toggle("has-photo", Boolean(profile.photo));
  element.classList.toggle("host", isLocal);

  if (profile.photo) {
    const image = document.createElement("img");
    image.src = profile.photo;
    image.alt = "";
    element.append(image);
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

async function captureDisplayMedia(preset, captureAudio) {
  const advancedConstraints = {
    video: {
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: preset.frameRate },
      displaySurface: "browser",
    },
    audio: captureAudio
      ? {
          echoCancellation: true,
          noiseSuppression: true,
          suppressLocalAudioPlayback: true,
        }
      : false,
    preferCurrentTab: true,
    selfBrowserSurface: "exclude",
    systemAudio: "exclude",
    windowAudio: "exclude",
  };

  try {
    return await navigator.mediaDevices.getDisplayMedia(advancedConstraints);
  } catch (error) {
    if (error.name !== "TypeError") {
      throw error;
    }

    return navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate },
      },
      audio: captureAudio,
    });
  }
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
    removeStreamCard(from);
    participants.delete(from);
    updateParticipants();
    return;
  }

  if (type === "profile-updated") {
    participants.set(from, profile || payload || participants.get(from));
    updateStreamTitle(from);
    updateParticipants();
    return;
  }

  if (type === "stream-stopped") {
    removeStreamCard(from);
    setVideoState(streamCards.size > 0);
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
  peer.__makingOffer = false;
  peer.__ignoreOffer = false;
  peer.__polite = peerId > remotePeerId;

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
    const [stream] = event.streams;
    addStreamCard(remotePeerId, stream, false);
    setVideoState(true, "watching");
  };

  peer.onnegotiationneeded = async () => {
    try {
      peer.__makingOffer = true;
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendSignal({ type: "offer", to: remotePeerId, payload: peer.localDescription });
    } catch (error) {
      console.error(error);
    } finally {
      peer.__makingOffer = false;
    }
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

  addLocalTracksToPeer(remotePeerId, peer);

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await sendSignal({ type: "offer", to: remotePeerId, payload: peer.localDescription });
}

async function receiveOffer(remotePeerId, offer) {
  const peer = createPeerConnection(remotePeerId);
  const offerCollision = peer.__makingOffer || peer.signalingState !== "stable";

  peer.__ignoreOffer = !peer.__polite && offerCollision;

  if (peer.__ignoreOffer) {
    return;
  }

  await peer.setRemoteDescription(offer);
  await flushPendingCandidates(remotePeerId, peer);

  if (screenStream) {
    addLocalTracksToPeer(remotePeerId, peer);
  }

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

  if (peer?.__ignoreOffer) {
    return;
  }

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
  localSenders.delete(remotePeerId);
}

function addLocalTracksToPeer(remotePeerId, peer) {
  if (!screenStream) return;

  const senders = localSenders.get(remotePeerId) || [];

  screenStream.getTracks().forEach((track) => {
    if (!senders.some((sender) => sender.track?.id === track.id)) {
      senders.push(peer.addTrack(track, screenStream));
    }
  });

  localSenders.set(remotePeerId, senders);
}

function addStreamCard(ownerId, stream, isLocal) {
  const existing = streamCards.get(ownerId);
  const profile = participants.get(ownerId) || localProfile;

  if (existing) {
    existing.video.srcObject = stream;
    existing.stream = stream;
    updateStreamTitle(ownerId);
    return existing;
  }

  const card = document.createElement("article");
  card.className = "stream-card";
  card.dataset.streamId = ownerId;
  card.innerHTML = `
    <video autoplay playsinline></video>
    <div class="stream-toolbar">
      <strong></strong>
      <div class="stream-actions">
        <div class="volume-control">
          <button type="button" class="speaker-button" title="Volume" aria-label="Abrir controle de volume" aria-expanded="false">🔊</button>
          <input class="volume-slider" type="range" min="0" max="100" value="${isLocal ? "0" : "80"}" aria-label="Volume da transmissao" />
        </div>
        <button type="button" class="focus-button" title="Tela cheia" aria-label="Tela cheia">⛶</button>
      </div>
    </div>
    <button type="button" class="back-button" title="Voltar para todas as telas">Voltar</button>
  `;

  const video = card.querySelector("video");
  const title = card.querySelector("strong");
  const volumeControl = card.querySelector(".volume-control");
  const speakerButton = card.querySelector(".speaker-button");
  const slider = card.querySelector(".volume-slider");
  const focusButton = card.querySelector(".focus-button");
  const backButton = card.querySelector(".back-button");

  video.srcObject = stream;
  video.muted = Number(slider.value) === 0;
  video.volume = Number(slider.value) / 100;
  title.textContent = isLocal ? `${profile.name} (voce)` : profile.name;

  stream.getTracks().forEach((track) => {
    track.addEventListener("ended", () => {
      if (!stream.getTracks().some((item) => item.readyState === "live")) {
        removeStreamCard(ownerId);
        setVideoState(streamCards.size > 0);
      }
    });
  });

  function updateVolumeState() {
    video.volume = Number(slider.value) / 100;
    video.muted = Number(slider.value) === 0;
    speakerButton.textContent = Number(slider.value) === 0 ? "🔇" : "🔊";
  }

  slider.addEventListener("input", updateVolumeState);
  updateVolumeState();

  speakerButton.addEventListener("click", () => {
    const isOpen = volumeControl.classList.toggle("is-open");
    speakerButton.setAttribute("aria-expanded", String(isOpen));
  });

  focusButton.addEventListener("click", () => toggleFocusStream(ownerId));
  backButton.addEventListener("click", clearFocusedStream);
  card.addEventListener("dblclick", () => toggleFocusStream(ownerId));

  streamGrid.append(card);
  streamCards.set(ownerId, { card, video, stream, title });
  setVideoState(true, isLocal ? "broadcast" : "watching");
  return streamCards.get(ownerId);
}

function updateFocusButtons() {
  streamCards.forEach(({ card }, id) => {
    const button = card.querySelector(".focus-button");
    const isFocused = focusedStreamId === id;

    button.textContent = isFocused ? "↙" : "⛶";
    button.title = isFocused ? "Voltar para todas as telas" : "Tela cheia";
    button.setAttribute("aria-label", button.title);
  });
}

function updateStreamTitle(ownerId) {
  const item = streamCards.get(ownerId);
  const profile = participants.get(ownerId) || localProfile;

  if (item) {
    item.title.textContent = ownerId === peerId ? `${profile.name} (voce)` : profile.name;
  }
}

function removeStreamCard(ownerId) {
  const item = streamCards.get(ownerId);

  if (!item) return;

  item.card.remove();
  streamCards.delete(ownerId);

  if (focusedStreamId === ownerId) {
    clearFocusedStream();
  }
}

function focusStream(ownerId) {
  if (!streamCards.has(ownerId)) return;

  focusedStreamId = ownerId;
  screenFrame.classList.add("focus-mode");
  streamCards.forEach(({ card }, id) => {
    card.classList.toggle("is-focused", id === ownerId);
  });
  updateFocusButtons();
}

function toggleFocusStream(ownerId) {
  if (focusedStreamId === ownerId) {
    clearFocusedStream();
    return;
  }

  focusStream(ownerId);
}

function clearFocusedStream() {
  focusedStreamId = null;
  screenFrame.classList.remove("focus-mode");
  streamCards.forEach(({ card }) => card.classList.remove("is-focused"));
  updateFocusButtons();
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
    screenStream = await captureDisplayMedia(preset, captureAudio);

    addStreamCard(peerId, screenStream, true);
    setVideoState(true, "broadcast");
    showToast("Transmissao iniciada. Para evitar Discord, prefira compartilhar uma aba.");

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

  localSenders.forEach((senders, remotePeerId) => {
    const peer = peers.get(remotePeerId);
    if (!peer) return;
    senders.forEach((sender) => peer.removeTrack(sender));
  });
  localSenders.clear();
  removeStreamCard(peerId);
  setVideoState(streamCards.size > 0);
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

drawerToggle.addEventListener("click", () => setDrawerOpen(true));
drawerClose.addEventListener("click", () => setDrawerOpen(false));
drawerBackdrop.addEventListener("click", () => setDrawerOpen(false));

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!photoEditor.hidden) {
      closePhotoEditor();
      return;
    }

    setDrawerOpen(false);
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
  window.location.hash = room.id;
  window.location.reload();
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  localProfile.name = profileName.value.trim().slice(0, 32) || "Convidado";
  saveLocalProfile(localProfile);
  participants.set(peerId, localProfile);
  setProfileUi();
  updateParticipants();
  updateStreamTitle(peerId);
  await sendSignal({ type: "profile-updated", to: "all", profile: localProfile });
  showToast("Perfil atualizado.");
});

profilePhoto.addEventListener("change", () => {
  const [file] = profilePhoto.files;

  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    showToast("Escolha um arquivo de imagem.");
    profilePhoto.value = "";
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    openPhotoEditor(reader.result);
  });
  reader.readAsDataURL(file);
});

[cropZoom, cropX, cropY].forEach((input) => {
  input.addEventListener("input", updateCropPreview);
});

cancelPhotoEdit.addEventListener("click", closePhotoEditor);

savePhotoEdit.addEventListener("click", () => {
  if (!cropSource) return;

  localProfile.photo = createCroppedPhoto();
  saveLocalProfile(localProfile);
  participants.set(peerId, localProfile);
  setProfileUi();
  updateParticipants();
  updateStreamTitle(peerId);
  sendSignal({ type: "profile-updated", to: "all", profile: localProfile });
  closePhotoEditor();
  showToast("Foto atualizada.");
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
