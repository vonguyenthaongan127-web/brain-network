// Brain Network Extension — Popup Script
// Uses Firestore REST API (no SDK needed for MV3 service worker compatibility).

const PROJECT_ID = "brainnetwork";
const API_KEY    = "AIzaSyBHsTgMJGgYVCYW6m_COxvcRkqMAMh8xaY";
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ── Firestore REST helpers ─────────────────────────────────────────────────

function toFirestore(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) { fields[k] = { nullValue: null }; }
    else if (typeof v === "boolean")   { fields[k] = { booleanValue: v }; }
    else if (typeof v === "number" && Number.isInteger(v)) { fields[k] = { integerValue: String(v) }; }
    else if (typeof v === "number")    { fields[k] = { doubleValue: v }; }
    else if (typeof v === "string")    { fields[k] = { stringValue: v }; }
  }
  return fields;
}

async function fsGet(path) {
  const res = await fetch(`${FS_BASE}/${path}?key=${API_KEY}`);
  if (!res.ok) return null;
  return res.json();
}

async function fsPatch(path, fields) {
  const fieldMask = Object.keys(fields).join(",");
  const url = `${FS_BASE}/${path}?key=${API_KEY}&updateMask.fieldPaths=${encodeURIComponent(fieldMask)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestore(fields) }),
  });
  if (!res.ok) throw new Error(`Firestore PATCH error ${res.status}`);
  return res.json();
}

async function fsCreate(collectionPath, fields) {
  // POST to collection = auto-ID document
  const url = `${FS_BASE}/${collectionPath}?key=${API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestore(fields) }),
  });
  if (!res.ok) throw new Error(`Firestore POST error ${res.status}`);
  return res.json();
}

async function fsGetUserProfile(userId) {
  const doc = await fsGet(`users/${userId}`);
  if (!doc || !doc.fields) return null;
  const f = doc.fields;
  return {
    id:    userId,
    name:  f.name?.stringValue  || `User ${userId.replace("user","")}`,
    emoji: f.emoji?.stringValue || "🧠",
    color: f.color?.stringValue || "#a855f7",
  };
}

// ── Default user slots ─────────────────────────────────────────────────────

const DEFAULT_USERS = [
  { id:"user1", name:"User 1", emoji:"🧠", color:"#a855f7" },
  { id:"user2", name:"User 2", emoji:"⚡", color:"#3b82f6" },
  { id:"user3", name:"User 3", emoji:"🌱", color:"#22c55e" },
  { id:"user4", name:"User 4", emoji:"🔥", color:"#f97316" },
  { id:"user5", name:"User 5", emoji:"💡", color:"#eab308" },
  { id:"user6", name:"User 6", emoji:"🎯", color:"#ef4444" },
  { id:"user7", name:"User 7", emoji:"🌙", color:"#06b6d4" },
];

const BLOOM_DATA = [
  { level:1, name:"Remember",   icon:"🌱", color:"#94a3b8" },
  { level:2, name:"Understand", icon:"💡", color:"#eab308" },
  { level:3, name:"Apply",      icon:"🔧", color:"#3b82f6" },
  { level:4, name:"Analyze",    icon:"🔍", color:"#a855f7" },
  { level:5, name:"Evaluate",   icon:"⚡", color:"#f97316" },
  { level:6, name:"Create",     icon:"🚀", color:"#ef4444" },
];

// ── State ──────────────────────────────────────────────────────────────────

let currentUser  = null;
let pageTitle    = "";
let pageUrl      = "";
let selectedBloom = 1;

const content = document.getElementById("content");

// ── Render functions ───────────────────────────────────────────────────────

function renderUserSelect(users) {
  // Show first 8 (two rows of 4) to keep popup compact
  const slots = users.slice(0, 8);
  content.innerHTML = `
    <div class="section-label">WHO ARE YOU?</div>
    <div class="user-grid" id="user-grid"></div>
  `;
  const grid = document.getElementById("user-grid");
  slots.forEach(u => {
    const el = document.createElement("div");
    el.className = "user-slot";
    el.innerHTML = `<div class="user-slot-emoji">${u.emoji}</div><div class="user-slot-name">${u.name}</div>`;
    el.style.borderColor = u.color + "55";
    el.addEventListener("click", () => selectUser(u));
    grid.appendChild(el);
  });
}

function renderAddForm() {
  const u = currentUser;
  content.innerHTML = `
    <div class="current-user">
      <span style="font-size:16px">${u.emoji}</span>
      <span>${u.name}</span>
      <button class="change-user-btn" id="change-user-btn">Switch</button>
    </div>

    <div class="field">
      <div class="section-label">KNOWLEDGE / CONCEPT *</div>
      <input id="f-label" type="text" placeholder="e.g. Passive Voice, Growth Mindset…" value="${escHtml(pageTitle)}"/>
      <div class="url-preview" id="url-preview">${escHtml(pageUrl)}</div>
    </div>

    <div class="field">
      <div class="section-label">DESCRIPTION</div>
      <textarea id="f-desc" rows="2" placeholder="What does it mean? How does it work?"></textarea>
    </div>

    <div class="field">
      <div class="section-label">BLOOM LEVEL</div>
      <div class="bloom-grid" id="bloom-grid"></div>
    </div>

    <button class="btn-primary" id="save-btn">✨ Add to Brain</button>
    <div id="save-status"></div>
  `;

  document.getElementById("change-user-btn").addEventListener("click", () => {
    currentUser = null;
    chrome.storage.local.remove("selectedUser");
    loadUserSelect();
  });

  // Bloom selector
  const bloomGrid = document.getElementById("bloom-grid");
  BLOOM_DATA.forEach(b => {
    const btn = document.createElement("button");
    btn.className = "bloom-btn";
    btn.dataset.level = b.level;
    btn.innerHTML = `<div class="bloom-icon">${b.icon}</div>L${b.level} ${b.name}`;
    btn.style.borderColor   = selectedBloom === b.level ? b.color : "rgba(255,255,255,0.1)";
    btn.style.background    = selectedBloom === b.level ? b.color + "22" : "transparent";
    btn.style.color         = selectedBloom === b.level ? b.color : "rgba(232,220,255,0.4)";
    btn.addEventListener("click", () => {
      selectedBloom = b.level;
      document.querySelectorAll(".bloom-btn").forEach(el => {
        const lvl = parseInt(el.dataset.level);
        const bd  = BLOOM_DATA[lvl - 1];
        el.style.borderColor = selectedBloom === lvl ? bd.color : "rgba(255,255,255,0.1)";
        el.style.background  = selectedBloom === lvl ? bd.color + "22" : "transparent";
        el.style.color       = selectedBloom === lvl ? bd.color : "rgba(232,220,255,0.4)";
      });
    });
    bloomGrid.appendChild(btn);
  });

  document.getElementById("save-btn").addEventListener("click", saveNode);
}

function renderSuccess() {
  content.innerHTML = `<div class="status-success">✅ Added to Brain!</div>
    <button class="btn-secondary" id="add-another-btn">+ Add Another</button>`;
  document.getElementById("add-another-btn").addEventListener("click", () => {
    renderAddForm();
  });
  setTimeout(() => window.close(), 2500);
}

function renderError(msg) {
  const el = document.getElementById("save-status");
  if (el) el.innerHTML = `<div class="status-error">❌ ${escHtml(msg)}</div>`;
}

// ── Logic ──────────────────────────────────────────────────────────────────

async function selectUser(user) {
  // Fetch latest profile from Firestore in background (optional enrichment)
  currentUser = user;
  chrome.storage.local.set({ selectedUser: user });
  renderAddForm();
}

async function saveNode() {
  const label = document.getElementById("f-label")?.value?.trim();
  if (!label) { renderError("Please enter a concept name."); return; }

  const desc       = document.getElementById("f-desc")?.value?.trim() || "";
  const saveBtn    = document.getElementById("save-btn");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }

  // Place node near center of existing nodes (random offset)
  const x = 400 + Math.round((Math.random() - 0.5) * 300);
  const y = 300 + Math.round((Math.random() - 0.5) * 200);

  const nodeData = {
    label,
    description:  desc + (pageUrl ? `\n\nSource: ${pageUrl}` : ""),
    category:     "Other",
    bloomLevel:   selectedBloom,
    topicId:      "other",
    emotion:      "",
    hasMedia:     false,
    x,
    y,
  };

  try {
    await fsCreate(`users/${currentUser.id}/nodes`, nodeData);
    renderSuccess();
  } catch (err) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "✨ Add to Brain"; }
    renderError(err.message || "Save failed. Check your connection.");
  }
}

async function loadUserSelect() {
  content.innerHTML = `<div class="status">Loading users…</div>`;

  // Load user profiles from Firestore in parallel
  const profiles = await Promise.all(
    DEFAULT_USERS.map(u =>
      fsGetUserProfile(u.id)
        .then(p => p || u)
        .catch(() => u)
    )
  );

  renderUserSelect(profiles);
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  // Get saved user from chrome.storage.local
  const stored = await chrome.storage.local.get("selectedUser");
  if (stored.selectedUser) {
    currentUser = stored.selectedUser;
  }

  // Get page info from active tab's content script
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const info = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_INFO" }).catch(() => null);
      if (info) {
        pageTitle = info.title || "";
        pageUrl   = info.url   || "";
      }
    }
  } catch { /* content script may not be injected on some pages */ }

  if (currentUser) {
    renderAddForm();
  } else {
    await loadUserSelect();
  }
}

init();
