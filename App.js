import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

 const firebaseConfig = {
    apiKey: "AIzaSyA3o-eFE8LKZQOwCxEduUy1L_1ENxDS4o0",
    authDomain: "chats-application-b1ae6.firebaseapp.com",
    databaseURL: "https://chats-application-b1ae6-default-rtdb.firebaseio.com",
    projectId: "chats-application-b1ae6",
    storageBucket: "chats-application-b1ae6.firebasestorage.app",
    messagingSenderId: "869628900172",
    appId: "1:869628900172:web:1f0ddfe2f12103730c95e9",
    measurementId: "G-TQ2QPBP0M5"
  };

const CLOUDINARY_CLOUD_NAME = "ockcg3is";
const CLOUDINARY_UPLOAD_PRESET = "chat_app";


const AI_ENDPOINT = "/api/chat";

let auth = null;
let db = null;
let currentUser = null;
let activeChatId = null;
let activeView = "chats";
let mediaRecorder = null;
let voiceChunks = [];
let recording = false;
let replyToId = null;
let cloudReady = false;
let state = loadState();

const $ = (id) => document.getElementById(id);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[c]));
const safeURL = (value = "") => {
  try {
    const url = new URL(value, location.href);
    return ["https:", "http:", "blob:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
};
const nowTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function loadState() {
  try {
    return JSON.parse(localStorage.getItem("vyra-state")) || {
      chats: [], statuses: [], communities: [], channels: [], calls: [],
      theme: "dark", profileName: "Habiba"
    };
  } catch {
    return { chats: [], statuses: [], communities: [], channels: [], calls: [], theme: "dark", profileName: "Habiba" };
  }
}

function normalizeState(data = {}) {
  return {
    chats: Array.isArray(data.chats) ? data.chats : [],
    statuses: Array.isArray(data.statuses) ? data.statuses : [],
    communities: Array.isArray(data.communities) ? data.communities : [],
    channels: Array.isArray(data.channels) ? data.channels : [],
    calls: Array.isArray(data.calls) ? data.calls : [],
    theme: ["dark", "light", "amoled"].includes(data.theme) ? data.theme : "dark",
    profileName: data.profileName || "Habiba"
  };
}

function saveState() {
  localStorage.setItem("vyra-state", JSON.stringify(state));
  renderHistory();
  $("chatCount").textContent = state.chats.length;
  if (currentUser && db && cloudReady) {
    setDoc(doc(db, "users", currentUser.uid, "backups", "main"), {
      state, updatedAt: Date.now()
    }).catch(error => console.warn("Cloud backup failed:", error.message));
  }
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  $("toastContainer").appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

function openModal(title, html, onSubmit) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = html;
  $("modalBackdrop").classList.add("show");
  const form = $("modalBody").querySelector("form");
  if (form) {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      await onSubmit(new FormData(form), form);
    });
  }
}
function closeModal() { $("modalBackdrop").classList.remove("show"); }

function createChat(name = "New conversation") {
  const chat = {
    id: uid(), name, createdAt: Date.now(), updatedAt: Date.now(),
    messages: [], pinned: false
  };
  state.chats.unshift(chat);
  activeChatId = chat.id;
  saveState();
  openChat(chat.id);
  $("welcomeBanner").style.display = "none";
  $("composerWrap").style.display = "block";
  $("messageInput").focus();
  return chat;
}
function activeChat() { return state.chats.find(c => c.id === activeChatId); }

function renderHistory() {
  const query = $("searchChats").value.toLowerCase().trim();
  const list = state.chats.filter(c =>
    c.name.toLowerCase().includes(query) ||
    (c.messages || []).some(m => (m.text || "").toLowerCase().includes(query))
  );
  $("chatHistory").innerHTML = list.map(chat => {
    const last = chat.messages?.at(-1);
    return `<button class="history-item ${chat.id === activeChatId ? "selected" : ""}" data-chat="${escapeHTML(chat.id)}">
      <div class="history-avatar">${escapeHTML(chat.name.charAt(0).toUpperCase())}</div>
      <div class="history-meta"><strong>${escapeHTML(chat.name)}</strong><small>${escapeHTML(last?.text || (last?.type === "voice" ? "🎙 Voice message" : "Start a conversation"))}</small></div>
      <span class="history-time">${last ? escapeHTML(last.time || "") : ""}</span>
    </button>`;
  }).join("") || `<div class="muted-empty">No conversations found.</div>`;
}

function openChat(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) return;
  activeChatId = id;
  activeView = "chats";
  switchView("chats");
  $("topTitle").textContent = chat.name;
  $("topSubtitle").innerHTML = `<span class="status-dot"></span> Conversation saved on this device`;
  $("topAvatar").textContent = chat.name.charAt(0).toUpperCase();
  $("welcomeBanner").style.display = "none";
  $("composerWrap").style.display = "block";
  $("emptyState").style.display = "none";
  renderMessages();
  renderHistory();
}

function renderMessages() {
  const chat = activeChat();
  if (!chat) {
    $("messages").innerHTML = "";
    $("emptyState").style.display = "flex";
    return;
  }
  $("emptyState").style.display = "none";
  $("messages").innerHTML = (chat.messages || []).map(m => {
    const mine = m.sender === "me";
    const content = m.type === "voice"
      ? `<audio controls preload="metadata" src="${safeURL(m.media || "")}"></audio>`
      : escapeHTML(m.text || "");
    const image = m.type === "image" && safeURL(m.media)
      ? `<img class="message-image" src="${safeURL(m.media)}" alt="Shared image" loading="lazy">` : "";
    const file = m.type === "file" && safeURL(m.media)
      ? `<a href="${safeURL(m.media)}" target="_blank" rel="noopener">Open attachment</a>` : "";
    return `<div class="message-row ${mine ? "mine" : ""}" data-message="${escapeHTML(m.id)}">
      ${mine ? "" : `<div class="message-avatar">V</div>`}
      <div class="message-content">
        ${mine ? "" : `<div class="message-sender">${escapeHTML(chat.name)}</div>`}
        <div class="message-bubble">${m.replyText ? `<small>↳ ${escapeHTML(m.replyText)}</small><br>` : ""}${content}${image}${file}</div>
        <div class="message-meta"><span>${escapeHTML(m.time || "")}</span>${m.edited ? "<span>edited</span>" : ""}${mine ? "<span>✓</span>" : ""}
          <span class="message-tools">
            <button data-action="reply" title="Reply">↩</button>
            <button data-action="react" title="React">♡</button>
            <button data-action="copy" title="Copy">⧉</button>
            ${mine && m.type === "text" ? '<button data-action="edit" title="Edit">✎</button>' : ""}
            <button data-action="delete" title="Delete">×</button>
          </span>
        </div>
        ${m.reaction ? `<span class="message-reaction" data-action="react">${escapeHTML(m.reaction)}</span>` : ""}
      </div>${mine ? "" : `<div class="message-avatar">V</div>`}
    </div>`;
  }).join("");
  $("messageArea").scrollTop = $("messageArea").scrollHeight;
}

function addMessage(text, extra = {}) {
  let chat = activeChat();
  if (!chat) chat = createChat();
  const message = {
    id: uid(), sender: "me", text: text || "", time: nowTime(),
    createdAt: Date.now(), type: "text",
    ...(replyToId ? { replyTo: replyToId, replyText: chat.messages.find(m => m.id === replyToId)?.text || "" } : {}),
    ...extra
  };
  replyToId = null;
  $("composerHint").textContent = "A kind message can change someone's day.";
  chat.messages.push(message);
  chat.updatedAt = Date.now();
  if (chat.name === "New conversation" && text) chat.name = text.slice(0, 28);
  saveState();
  renderMessages();
  return message;
}

function addIncoming(text, extra = {}) {
  const chat = activeChat();
  if (!chat) return;
  chat.messages.push({ id: uid(), sender: "other", text, time: nowTime(), createdAt: Date.now(), type: "text", ...extra });
  chat.updatedAt = Date.now();
  saveState();
  renderMessages();
}

function sendMessage() {
  const input = $("messageInput");
  const text = input.value.trim();
  if (!text) return;
  if (!activeChat()) createChat();
  addMessage(text);
  input.value = "";
  input.style.height = "auto";
}

function switchView(view) {
  activeView = view;
  document.querySelectorAll(".view-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  const panel = $("view-" + view);
  if (panel) panel.classList.add("active");

  const titles = {
    chats: ["Your private space", "Your conversations, your world"],
    status: ["Status & Stories", "Little moments, shared"],
    communities: ["Communities", "Find your people"],
    channels: ["Channels", "Announcements and updates"],
    calls: ["Calls", "Stay close"],
    ai: ["AI Assistant", "Your creative companion"]
  };
  $("topTitle").textContent = titles[view]?.[0] || "VYRA";
  $("topSubtitle").textContent = titles[view]?.[1] || "";
  $("sidebar").classList.remove("open");

  if (view === "chats") {
    if (activeChat()) openChat(activeChatId);
    else {
      $("welcomeBanner").style.display = "block";
      $("composerWrap").style.display = "block";
      $("messages").innerHTML = "";
      $("emptyState").style.display = "flex";
    }
  }
  if (view === "status") renderStatuses();
  if (view === "communities") renderCommunities();
  if (view === "channels") renderChannels();
  if (view === "calls") renderCalls();
}

function deleteMessage(messageId) {
  const chat = activeChat();
  if (!chat) return;
  const msg = chat.messages.find(m => m.id === messageId);
  if (!msg) return;
  openModal("Delete message", `<p>Delete this message from your saved chat?</p><button class="primary-btn" id="confirmDelete" type="button">Delete message</button>`, () => {});
  $("modalBody").querySelector("#confirmDelete").onclick = () => {
    chat.messages = chat.messages.filter(m => m.id !== messageId);
    saveState(); renderMessages(); closeModal(); toast("Message deleted from this device.");
  };
}

function editMessage(messageId) {
  const chat = activeChat();
  const msg = chat?.messages.find(m => m.id === messageId);
  if (!msg) return;
  openModal("Edit message", `<form><label>Message</label><textarea name="text" required>${escapeHTML(msg.text)}</textarea><button class="primary-btn">Save changes</button></form>`, form => {
    msg.text = form.get("text").trim();
    msg.edited = true;
    saveState(); renderMessages(); closeModal(); toast("Message updated.");
  });
}

function handleMessageAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const row = button.closest("[data-message]");
  if (!row) return;
  const id = row.dataset.message;
  const msg = activeChat()?.messages.find(m => m.id === id);
  if (!msg) return;
  switch (button.dataset.action) {
    case "delete": deleteMessage(id); break;
    case "edit": editMessage(id); break;
    case "reply":
      replyToId = id;
      $("composerHint").textContent = "Replying to: " + (msg.text || "attachment").slice(0, 55);
      $("messageInput").focus();
      break;
    case "copy":
      navigator.clipboard?.writeText(msg.text || msg.media || "").then(() => toast("Copied to clipboard.")).catch(() => toast("Copy is not available in this browser."));
      break;
    case "react":
      msg.reaction = msg.reaction ? "" : "💜";
      saveState(); renderMessages(); break;
  }
}

/* ---------- Voice recording ---------- */
async function toggleVoice() {
  if (recording && mediaRecorder) {
    mediaRecorder.stop();
    recording = false;
    $("voiceBtn").innerHTML = '<i class="fa-solid fa-microphone"></i>';
    toast("Finishing voice recording…");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast("Voice recording needs a supported browser and HTTPS or localhost.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = event => { if (event.data.size) voiceChunks.push(event.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(voiceChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const url = URL.createObjectURL(blob);
      if (!activeChat()) createChat();
      addMessage("", { type: "voice", media: url });
      stream.getTracks().forEach(track => track.stop());
      toast("Voice message added to this chat.");
    };
    mediaRecorder.start();
    recording = true;
    $("voiceBtn").innerHTML = '<i class="fa-solid fa-stop"></i>';
    toast("Recording… tap the microphone again to stop.");
  } catch {
    toast("Microphone permission was denied or unavailable.");
  }
}

/* ---------- Cloudinary image upload ---------- */
async function uploadImage(file) {
  if (!file || !file.type.startsWith("image/")) return toast("Please select an image.");
  if (file.size > 10 * 1024 * 1024) return toast("Image must be under 10 MB.");
  if (CLOUDINARY_CLOUD_NAME.startsWith("YOUR_") || CLOUDINARY_UPLOAD_PRESET.startsWith("YOUR_")) {
    const localUrl = URL.createObjectURL(file);
    if (!activeChat()) createChat();
    addMessage(file.name, { type: "image", media: localUrl });
    toast("Local preview added. Configure Cloudinary for persistent image URLs.");
    return;
  }
  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  try {
    toast("Uploading image…");
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}/image/upload`, {
      method: "POST", body
    });
    if (!response.ok) throw new Error("Upload failed");
    const result = await response.json();
    if (!activeChat()) createChat();
    addMessage(file.name, { type: "image", media: result.secure_url });
    toast("Image uploaded successfully.");
  } catch {
    toast("Image upload failed. Check Cloudinary settings.");
  }
}

/* ---------- Translation ---------- */
async function translateLastMessage() {
  const chat = activeChat();
  const msg = chat?.messages.slice().reverse().find(m => m.text);
  if (!msg) return toast("No text message to translate.");
  openModal("Translate message", `<form><label>Translate to</label><select name="lang"><option value="ur">Urdu</option><option value="en">English</option><option value="ar">Arabic</option><option value="hi">Hindi</option><option value="fr">French</option><option value="es">Spanish</option><option value="tr">Turkish</option><option value="de">German</option></select><label>Original message</label><textarea readonly>${escapeHTML(msg.text)}</textarea><button class="primary-btn">Translate</button><div id="translationResult"></div></form>`, async form => {
    const target = form.get("lang");
    const resultBox = $("modalBody").querySelector("#translationResult");
    resultBox.textContent = "Translating…";
    try {
      const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(msg.text.slice(0, 450)) + "&langpair=en|" + encodeURIComponent(target);
      const response = await fetch(url);
      const data = await response.json();
      const translated = data?.responseData?.translatedText;
      if (!translated) throw new Error("No translation");
      resultBox.textContent = translated;
      const saveBtn = document.createElement("button");
      saveBtn.className = "secondary-btn";
      saveBtn.type = "button";
      saveBtn.textContent = "Copy translation";
      saveBtn.onclick = () => navigator.clipboard?.writeText(translated);
      resultBox.appendChild(document.createElement("br"));
      resultBox.appendChild(saveBtn);
    } catch {
      resultBox.textContent = "Translation service unavailable. Try again later.";
    }
  });
}

/* ---------- AI: needs your own secure backend ---------- */
async function askAI(prompt) {
  const text = (prompt || $("aiInput").value).trim();
  if (!text) return toast("Write a prompt first.");
  $("aiInput").value = "";
  switchView("ai");
  const answer = $("modalBody");
  try {
    if (AI_ENDPOINT === "/api/chat") {
      const response = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text })
      });
      if (!response.ok) throw new Error("AI backend is not configured.");
      const data = await response.json();
      toast(data.reply || data.message || "AI response received.");
    } else {
      toast("Connect your secure AI endpoint in script.js.");
    }
  } catch {
    openModal("AI assistant setup", `<p>VYRA's interface is ready, but real AI needs a backend endpoint at <code>/api/chat</code>.</p><p>Keep your AI provider API key on the server, never in this JavaScript file.</p><button class="primary-btn" id="aiSetupClose">Got it</button>`);
    $("aiSetupClose").onclick = closeModal;
  }
}

/* ---------- Status ---------- */
function addStatus(text, media = "") {
  state.statuses.unshift({ id: uid(), text, media, createdAt: Date.now(), expiresAt: Date.now() + 86400000 });
  saveState(); renderStatuses(); toast("Status posted.");
}
function renderStatuses() {
  state.statuses = state.statuses.filter(s => s.expiresAt > Date.now());
  $("statusGrid").innerHTML = state.statuses.map(s => `<div class="status-card card"><div class="status-emoji">✨</div>${s.media && safeURL(s.media) ? `<img src="${safeURL(s.media)}" alt="Status image">` : ""}<p>${escapeHTML(s.text)}</p><small>${new Date(s.createdAt).toLocaleString()}</small><div class="card-actions"><button data-status-delete="${s.id}">Delete status</button></div></div>`).join("") || `<div class="card status-card"><div class="status-emoji">🌙</div><strong>No status yet</strong><p>Be the first to share a moment.</p></div>`;
}
function showStatusForm() {
  openModal("Create status", `<form><label>Your status</label><textarea name="text" placeholder="What's on your mind?" maxlength="500"></textarea><button class="primary-btn">Share status</button></form>`, form => {
    const text = form.get("text").trim();
    if (!text) return toast("Write something for your status.");
    addStatus(text); closeModal();
  });
}

/* ---------- Communities ---------- */
function renderCommunities() {
  $("communityGrid").innerHTML = state.communities.map(c => `<div class="feature-card card"><div class="feature-icon"><i class="fa-solid fa-people-group"></i></div><h3>${escapeHTML(c.name)}</h3><p>${escapeHTML(c.description || "A place to connect.")}</p><small>${c.members || 1} members · ${c.private ? "Private" : "Public"}</small><div class="card-actions"><button data-community-open="${c.id}">Open community</button><button data-community-delete="${c.id}">Delete</button></div></div>`).join("") || `<div class="feature-card card"><div class="feature-icon"><i class="fa-solid fa-users"></i></div><h3>Your people, together.</h3><p>Create a community for friends, study groups or shared interests.</p></div>`;
}
function createCommunity() {
  openModal("Create community", `<form><label>Community name</label><input name="name" required maxlength="50" placeholder="e.g. Creative Circle"><label>Description</label><textarea name="description" placeholder="What brings members together?"></textarea><label>Privacy</label><select name="private"><option value="false">Public</option><option value="true">Private</option></select><button class="primary-btn">Create community</button></form>`, form => {
    state.communities.unshift({ id: uid(), name: form.get("name").trim(), description: form.get("description").trim(), private: form.get("private") === "true", members: 1, createdAt: Date.now() });
    saveState(); renderCommunities(); closeModal(); toast("Community created on this device.");
  });
}

/* ---------- Channels and announcements ---------- */
function renderChannels() {
  $("channelGrid").innerHTML = state.channels.map(c => `<div class="feature-card card"><div class="feature-icon"><i class="fa-solid fa-tower-broadcast"></i></div><h3>${escapeHTML(c.name)}</h3><p>${escapeHTML(c.description || "Channel updates")}</p><small>${c.posts.length} announcements · ${c.following ? "Following" : "Not following"}</small><div class="card-actions"><button data-channel-follow="${c.id}">${c.following ? "Unfollow" : "Follow"}</button><button data-channel-post="${c.id}">Announcement</button><button data-channel-delete="${c.id}">Delete</button></div>${c.posts.slice(0, 2).map(p => `<p>📣 ${escapeHTML(p.text)}</p><small>${new Date(p.createdAt).toLocaleString()}</small>`).join("")}</div>`).join("") || `<div class="feature-card card"><div class="feature-icon"><i class="fa-solid fa-bullhorn"></i></div><h3>Broadcast your news.</h3><p>Create a channel and publish announcements for followers.</p></div>`;
}
function createChannel() {
  openModal("Create channel", `<form><label>Channel name</label><input name="name" required maxlength="50" placeholder="e.g. VYRA Updates"><label>Description</label><textarea name="description" placeholder="What will you share?"></textarea><button class="primary-btn">Create channel</button></form>`, form => {
    state.channels.unshift({ id: uid(), name: form.get("name").trim(), description: form.get("description").trim(), following: true, posts: [], createdAt: Date.now() });
    saveState(); renderChannels(); closeModal(); toast("Channel created.");
  });
}
function postAnnouncement(id) {
  const channel = state.channels.find(c => c.id === id);
  if (!channel) return;
  openModal("Publish announcement", `<form><label>Announcement</label><textarea name="text" required maxlength="1500" placeholder="Share an update with followers..."></textarea><button class="primary-btn">Publish announcement</button></form>`, form => {
    channel.posts.unshift({ id: uid(), text: form.get("text").trim(), createdAt: Date.now() });
    saveState(); renderChannels(); closeModal(); toast("Announcement published.");
  });
}

/* ---------- Calls: interface and local history ---------- */
function startCall() {
  const name = activeChat()?.name || "Your contact";
  $("callName").textContent = name;
  $("callStatus").textContent = "Demo interface — no peer connected";
  $("callOverlay").classList.add("show");
  state.calls.unshift({ id: uid(), name, type: "voice", time: new Date().toLocaleString(), result: "Demo call" });
  saveState(); renderCalls();
}
function renderCalls() {
  $("callHistory").innerHTML = state.calls.map(c => `<div class="call-entry"><div class="history-avatar">${escapeHTML(c.name.charAt(0))}</div><div><strong>${escapeHTML(c.name)}</strong><small>${escapeHTML(c.time)} · ${escapeHTML(c.result)}</small></div><i class="fa-solid fa-phone call-type"></i></div>`).join("") || `<div class="call-entry"><div><strong>No calls yet</strong><small>Your call history will appear here.</small></div></div>`;
}

/* ---------- Themes ---------- */
function applyTheme() {
  document.body.classList.remove("light-mode", "amoled-mode");
  if (state.theme === "light") document.body.classList.add("light-mode");
  if (state.theme === "amoled") document.body.classList.add("amoled-mode");
}
function cycleTheme() {
  state.theme = state.theme === "dark" ? "light" : state.theme === "light" ? "amoled" : "dark";
  applyTheme(); saveState();
  toast("Theme: " + state.theme.toUpperCase());
}

/* ---------- Firebase sign-in and cloud backup ---------- */
async function setupFirebase() {
  if (FIREBASE_CONFIG.apiKey.startsWith("YOUR_")) {
    $("authStatus").textContent = "Local profile";
    return;
  }
  try {
    const app = initializeApp(FIREBASE_CONFIG);
    auth = getAuth(app);
    db = getFirestore(app);
    cloudReady = true;
    onAuthStateChanged(auth, async user => {
      currentUser = user;
      if (!user) {
        $("authStatus").textContent = "Local profile";
        $("authBtn").innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>';
        return;
      }
      $("profileName").textContent = user.displayName || "Habiba";
      $("authStatus").textContent = "Signed in · cloud backup";
      $("authBtn").innerHTML = '<i class="fa-solid fa-cloud"></i>';
      try {
        const ref = doc(db, "users", user.uid, "backups", "main");
        const snapshot = await getDoc(ref);
        if (snapshot.exists()) {
          const remote = snapshot.data().state;
          // Restore cloud data only when the local workspace is empty.
          if (!state.chats.length && !state.statuses.length && remote) {
            state = normalizeState(remote);
            localStorage.setItem("vyra-state", JSON.stringify(state));
            applyTheme(); renderHistory(); renderStatuses(); renderCommunities(); renderChannels(); renderCalls();
            toast("Your cloud backup was restored.");
          }
        } else {
          await setDoc(ref, { state, updatedAt: Date.now() });
        }
      } catch (error) {
        console.error(error);
        toast("Firebase connected, but backup could not be loaded. Check Firestore rules.");
      }
    });
  } catch (error) {
    console.error(error);
    toast("Firebase setup needs valid project configuration.");
  }
}

async function toggleAuth() {
  if (!auth) return toast("Add your Firebase config in script.js first.");
  try {
    if (currentUser) {
      await signOut(auth);
      toast("Signed out.");
    } else {
      await signInWithPopup(auth, new GoogleAuthProvider());
    }
  } catch (error) {
    toast(error.code === "auth/popup-closed-by-user" ? "Sign-in window closed." : "Sign-in failed. Check Firebase Auth settings.");
  }
}

/* ---------- Export / settings ---------- */
function showSettings() {
  openModal("Workspace settings", `<form><label>Display name</label><input name="name" value="${escapeHTML(state.profileName)}" required maxlength="40"><label>Theme</label><select name="theme"><option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark plum</option><option value="light" ${state.theme === "light" ? "selected" : ""}>Soft light</option><option value="amoled" ${state.theme === "amoled" ? "selected" : ""}>AMOLED black</option></select><button class="primary-btn">Save settings</button></form><button class="secondary-btn" id="exportData" style="width:100%;margin-top:10px">Export workspace JSON</button><button class="secondary-btn" id="deleteAll" style="width:100%;margin-top:10px">Delete all local data</button>`, form => {
    state.profileName = form.get("name").trim();
    state.theme = form.get("theme");
    $("profileName").textContent = state.profileName;
    applyTheme(); saveState(); closeModal(); toast("Settings saved.");
  });
  $("exportData").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "vyra-backup.json"; a.click();
    URL.revokeObjectURL(a.href);
  };
  $("deleteAll").onclick = () => {
    if (!confirm("Delete all chats, statuses, communities and channels from this device?")) return;
    state = { chats: [], statuses: [], communities: [], channels: [], calls: [], theme: "dark", profileName: "Habiba" };
    activeChatId = null; saveState(); applyTheme(); closeModal(); switchView("chats"); renderMessages();
    toast("Local workspace cleared.");
  };
}

/* ---------- Event listeners ---------- */
$("newChat").onclick = () => {
  openModal("New conversation", `<form><label>Contact or chat name</label><input name="name" required maxlength="50" placeholder="e.g. Ayesha"><button class="primary-btn">Create chat</button></form>`, form => {
    createChat(form.get("name").trim()); closeModal();
  });
};
$("startChat").onclick = () => $("newChat").click();
$("sendBtn").onclick = sendMessage;
$("messageInput").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); }
});
$("messageInput").addEventListener("input", event => {
  event.target.style.height = "auto";
  event.target.style.height = Math.min(event.target.scrollHeight, 130) + "px";
});
$("messages").addEventListener("click", handleMessageAction);
$("chatHistory").addEventListener("click", event => {
  const item = event.target.closest("[data-chat]");
  if (item) openChat(item.dataset.chat);
});
$("searchChats").addEventListener("input", renderHistory);
$("clearSearch").onclick = () => { $("searchChats").value = ""; renderHistory(); };
$("themeBtn").onclick = cycleTheme;
$("translateBtn").onclick = translateLastMessage;
$("callBtn").onclick = startCall;
$("startCall").onclick = startCall;
$("endCall").onclick = () => { $("callOverlay").classList.remove("show"); toast("Call interface closed."); };
$("muteCall").onclick = event => { event.currentTarget.classList.toggle("muted"); toast("Mute control toggled (demo)."); };
$("videoCall").onclick = () => toast("Video calling requires WebRTC and camera signaling setup.");
$("voiceBtn").onclick = toggleVoice;
$("attachBtn").onclick = () => $("fileInput").click();
$("fileInput").addEventListener("change", event => {
  uploadImage(event.target.files[0]);
  event.target.value = "";
});
$("emojiBtn").onclick = () => {
  const emojis = [" 💜", " 😊", " 😂", " ✨", " ❤️", " 🎉", " 👋", " 🔥", " 🥹", " 🌸"];
  openModal("Choose an emoji", `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">${emojis.map(e => `<button type="button" class="secondary-btn emoji-choice" style="font-size:23px;padding:12px">${e.trim()}</button>`).join("")}</div>`);
  $("modalBody").querySelectorAll(".emoji-choice").forEach(btn => btn.onclick = () => {
    $("messageInput").value += btn.textContent;
    closeModal(); $("messageInput").focus();
  });
};
$("aiPromptBtn").onclick = () => switchView("ai");
$("askAi").onclick = () => askAI();
$("aiInput").addEventListener("keydown", event => { if (event.key === "Enter") askAI(); });
document.querySelectorAll("[data-prompt]").forEach(btn => btn.onclick = () => {
  $("aiInput").value = btn.dataset.prompt;
  $("aiInput").focus();
});
$("addStatus").onclick = showStatusForm;
$("addStatus2").onclick = showStatusForm;
$("createCommunity").onclick = createCommunity;
$("createChannel").onclick = createChannel;
$("statusGrid").addEventListener("click", event => {
  const btn = event.target.closest("[data-status-delete]");
  if (btn) {
    state.statuses = state.statuses.filter(s => s.id !== btn.dataset.statusDelete);
    saveState(); renderStatuses(); toast("Status deleted.");
  }
});
$("communityGrid").addEventListener("click", event => {
  const del = event.target.closest("[data-community-delete]");
  const open = event.target.closest("[data-community-open]");
  if (del) {
    state.communities = state.communities.filter(c => c.id !== del.dataset.communityDelete);
    saveState(); renderCommunities(); toast("Community deleted.");
  }
  if (open) {
    const c = state.communities.find(x => x.id === open.dataset.communityOpen);
    if (c) openModal(c.name, `<p>${escapeHTML(c.description)}</p><p>Members: ${c.members}</p><p>Community details are saved locally in this demo. Multi-user community chat requires a server or Firestore live subscriptions.</p>`);
  }
});
$("channelGrid").addEventListener("click", event => {
  const follow = event.target.closest("[data-channel-follow]");
  const post = event.target.closest("[data-channel-post]");
  const del = event.target.closest("[data-channel-delete]");
  if (follow) {
    const c = state.channels.find(x => x.id === follow.dataset.channelFollow);
    if (c) c.following = !c.following;
    saveState(); renderChannels();
  }
  if (post) postAnnouncement(post.dataset.channelPost);
  if (del) {
    state.channels = state.channels.filter(c => c.id !== del.dataset.channelDelete);
    saveState(); renderChannels(); toast("Channel deleted.");
  }
});
$("authBtn").onclick = toggleAuth;
$("settingsBtn").onclick = showSettings;
$("modalClose").onclick = closeModal;
$("modalBackdrop").addEventListener("click", event => { if (event.target === $("modalBackdrop")) closeModal(); });
$("moreBtn").onclick = () => openModal("Conversation options", `<button class="secondary-btn" id="renameChat" style="width:100%;margin-bottom:8px">Rename conversation</button><button class="secondary-btn" id="pinChat" style="width:100%;margin-bottom:8px">Pin / unpin conversation</button><button class="secondary-btn" id="deleteChat" style="width:100%">Delete conversation</button>`);
$("moreBtn").addEventListener("click", () => {
  $("renameChat")?.addEventListener("click", () => {
    const chat = activeChat();
    if (!chat) return toast("Open a conversation first.");
    openModal("Rename chat", `<form><label>Chat name</label><input name="name" value="${escapeHTML(chat.name)}" required><button class="primary-btn">Save</button></form>`, form => {
      chat.name = form.get("name").trim(); saveState(); openChat(chat.id); closeModal();
    });
  });
  $("pinChat")?.addEventListener("click", () => {
    const chat = activeChat();
    if (!chat) return toast("Open a conversation first.");
    chat.pinned = !chat.pinned; state.chats.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    saveState(); renderHistory(); closeModal(); toast(chat.pinned ? "Chat pinned." : "Chat unpinned.");
  });
  $("deleteChat")?.addEventListener("click", () => {
    if (!activeChat()) return toast("Open a conversation first.");
    if (!confirm("Delete this conversation from this device?")) return;
    state.chats = state.chats.filter(c => c.id !== activeChatId);
    activeChatId = null; saveState(); closeModal(); switchView("chats"); renderMessages(); toast("Conversation deleted.");
  });
});
$("openSidebar").onclick = () => $("sidebar").classList.add("open");
$("closeSidebar").onclick = () => $("sidebar").classList.remove("open");
document.querySelectorAll("[data-view]").forEach(button => button.onclick = () => switchView(button.dataset.view));

/* ---------- Initialize ---------- */
document.querySelectorAll(".view-panel").forEach(p => p.classList.remove("active"));
$("view-chats").classList.add("active");
$("profileName").textContent = state.profileName;
applyTheme();
renderHistory();
renderStatuses();
renderCommunities();
renderChannels();
renderCalls();
if (state.chats.length) {
  activeChatId = state.chats[0].id;
  openChat(activeChatId);
} else {
  $("welcomeBanner").style.display = "block";
  $("composerWrap").style.display = "block";
  $("emptyState").style.display = "flex";
}
setupFirebase();