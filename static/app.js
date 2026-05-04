// ---------- State ----------
const state = {
  messages: [],
  focus: localStorage.getItem("wanderly:focus") || "Any city",
  places: new Map(),       // key -> place
  favourites: new Map(),   // key -> {id, place}
  imgCache: new Map(),     // key -> dataURL/url
};

const $ = (s) => document.querySelector(s);
const messagesEl = $("#messages");
const focusChip = $("#focusChip");
const focusSelect = $("#focusSelect");
const emptyTitle = $("#emptyTitle");
const emptySub = $("#emptySub");
const suggestionsEl = $("#suggestions");

// ---------- Focus city ----------
function setFocus(v) {
  state.focus = v;
  focusChip.textContent = v;
  localStorage.setItem("wanderly:focus", v);
  renderSuggestions();
  renderEmptyTitles();
}
focusSelect.value = "";
focusSelect.addEventListener("change", (e) => {
  if (e.target.value) setFocus(e.target.value);
  e.target.value = "";
});

function renderEmptyTitles() {
  if (state.focus === "Any city") {
    emptyTitle.textContent = "Where shall we wander today?";
    emptySub.textContent = "Pick a city above or just ask — landmarks, food, itineraries, hidden gems.";
  } else {
    emptyTitle.textContent = `Let's explore ${state.focus} ✨`;
    emptySub.textContent = `Ask about landmarks, food, itineraries, neighbourhoods or hidden gems in ${state.focus}.`;
  }
}

function renderSuggestions() {
  const isAny = state.focus === "Any city";
  const c = isAny ? "Kyoto" : state.focus;
  const items = [
    `Must-see spots in ${c}`,
    isAny ? "Best street food in Bangkok" : `Best local food in ${c}`,
    isAny ? "3-day itinerary for Lisbon" : `3-day itinerary for ${c}`,
    isAny ? "Hidden photo spots in Paris" : `Hidden photo spots in ${c}`,
  ];
  suggestionsEl.innerHTML = items.map(t => `<button class="suggest-btn">${t}</button>`).join("");
  suggestionsEl.querySelectorAll(".suggest-btn").forEach((b) => {
    b.addEventListener("click", () => sendMessage(b.textContent));
  });
}
renderEmptyTitles();
renderSuggestions();
setFocus(state.focus);

// ---------- Map ----------
const map = L.map("map", { worldCopyJump: true }).setView([20, 0], 2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap",
}).addTo(map);
const markerLayer = L.layerGroup().addTo(map);

function placeKey(p) {
  return `${p.name.toLowerCase()}|${p.lat.toFixed(3)}|${p.lng.toFixed(3)}`;
}

function refreshMap() {
  markerLayer.clearLayers();
  const places = [...state.places.values()];
  if (!places.length) return;
  places.forEach((p) => {
    const key = placeKey(p);
    const isFav = state.favourites.has(key);
    const img = state.imgCache.get(key);
    const m = L.marker([p.lat, p.lng]).addTo(markerLayer);
    const html = `
      <div style="min-width:180px">
        ${img ? `<img src="${img}" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:6px"/>` : ""}
        <div style="font-weight:600">${escapeHtml(p.name)}</div>
        ${p.city ? `<div style="font-size:12px;color:#666;margin-bottom:6px">${escapeHtml(p.city)}</div>` : ""}
        ${WANDERLY.loggedIn ? `<button data-fav style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid #ddd;cursor:pointer;background:${isFav?'#fee2e2':'#fff'}">${isFav?'♥ Saved':'♡ Save'}</button>` : ""}
      </div>`;
    const popup = L.popup().setContent(html);
    m.bindPopup(popup);
    m.on("popupopen", () => {
      const btn = popup.getElement()?.querySelector("[data-fav]");
      if (btn) btn.onclick = () => { toggleFavourite(p); m.closePopup(); };
    });
  });
  const bounds = L.latLngBounds(places.map((p) => [p.lat, p.lng]));
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
}

// ---------- Place extraction ----------
const PLACE_RE = /\[\[place:([^\]|]+)\|([^\]|]*)\|(-?\d+(?:\.\d+)?)\|(-?\d+(?:\.\d+)?)\]\]/g;
function extractPlaces(text) {
  const places = [];
  let cleaned = text.replace(PLACE_RE, (_, name, city, lat, lng) => {
    places.push({
      name: name.trim(),
      city: city.trim() || null,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
    });
    return name.trim();
  });
  return { text: cleaned, places };
}

// ---------- Image generation ----------
async function getPlaceImage(p) {
  const key = placeKey(p);
  if (state.imgCache.has(key)) return state.imgCache.get(key);
  const cached = localStorage.getItem("wanderly:img:" + key);
  if (cached) { state.imgCache.set(key, cached); return cached; }
  try {
    const r = await fetch("/api/place-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: p.name, city: p.city }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.image) {
      state.imgCache.set(key, j.image);
      try { localStorage.setItem("wanderly:img:" + key, j.image); } catch {}
      return j.image;
    }
  } catch {}
  return null;
}

// ---------- Render ----------
function renderEmpty() {
  const empty = state.messages.length === 0;
  $(".empty").style.display = empty ? "block" : "none";
}

function renderMessages() {
  // Wipe previous bubbles (not the empty block)
  [...messagesEl.querySelectorAll(".msg, .typing")].forEach((n) => n.remove());
  state.messages.forEach((m, i) => {
    const node = document.createElement("div");
    node.className = "msg " + m.role;
    if (m.role === "user") {
      node.innerHTML = `
        <div class="msg-avatar">You</div>
        <div class="bubble"></div>`;
      node.querySelector(".bubble").textContent = m.content;
    } else {
      const { text, places } = extractPlaces(m.content || "");
      node.innerHTML = `
        <div class="msg-avatar">✨</div>
        <div class="bubble">
          <div class="md"></div>
          ${places.length ? `<div class="places-grid"></div>` : ""}
        </div>`;
      node.querySelector(".md").innerHTML = marked.parse(text || "…");
      if (places.length) {
        const grid = node.querySelector(".places-grid");
        places.forEach((p) => {
          const k = placeKey(p);
          const isFav = state.favourites.has(k);
          const card = document.createElement("div");
          card.className = "place-card";
          card.innerHTML = `
            <div class="place-img loading"></div>
            ${WANDERLY.loggedIn ? `<button class="fav-btn ${isFav?'active':''}" title="Save">♥</button>` : ""}
            <div class="place-meta">
              <p class="place-name">${escapeHtml(p.name)}</p>
              ${p.city ? `<p class="place-city">📍 ${escapeHtml(p.city)}</p>` : ""}
            </div>`;
          grid.appendChild(card);
          getPlaceImage(p).then((url) => {
            const slot = card.querySelector(".place-img");
            if (url) {
              slot.classList.remove("loading");
              slot.innerHTML = `<img src="${url}" alt="${escapeHtml(p.name)}" style="width:100%;height:100%;object-fit:cover"/>`;
            } else {
              slot.classList.remove("loading");
              slot.textContent = "🖼";
            }
            refreshMap();
          });
          const favBtn = card.querySelector(".fav-btn");
          if (favBtn) favBtn.onclick = () => toggleFavourite(p);
        });
        // collect places into state
        places.forEach((p) => state.places.set(placeKey(p), p));
      }
    }
    messagesEl.appendChild(node);
  });
  renderEmpty();
  refreshMap();
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTyping(on) {
  const existing = messagesEl.querySelector(".typing");
  if (existing) existing.remove();
  if (!on) return;
  const t = document.createElement("div");
  t.className = "msg ai typing";
  t.innerHTML = `<div class="msg-avatar">✨</div><div class="bubble"><div class="dots"><span></span><span></span><span></span></div></div>`;
  messagesEl.appendChild(t);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------- Send / streaming ----------
async function sendMessage(text) {
  if (!text.trim()) return;
  state.messages.push({ role: "user", content: text });
  renderMessages();
  showTyping(true);

  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: state.messages, focus: state.focus }),
  });
  if (!r.ok || !r.body) {
    showTyping(false);
    state.messages.push({ role: "ai", content: "Sorry — something went wrong." });
    renderMessages();
    return;
  }
  showTyping(false);
  state.messages.push({ role: "ai", content: "" });

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", assistant = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") break;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) {
          assistant += delta;
          state.messages[state.messages.length - 1].content = assistant;
          renderMessages();
        }
      } catch {}
    }
  }
}

$("#chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const inp = $("#chatInput");
  const v = inp.value;
  inp.value = "";
  sendMessage(v);
});

// ---------- Favourites ----------
async function loadFavourites() {
  if (!WANDERLY.loggedIn) return;
  const r = await fetch("/api/favourites");
  if (!r.ok) return;
  const list = await r.json();
  state.favourites.clear();
  list.forEach((row) => {
    const p = { name: row.name, city: row.city, lat: row.latitude, lng: row.longitude };
    state.favourites.set(placeKey(p), { id: row.id, place: p });
    state.places.set(placeKey(p), p);
  });
  renderFavList();
  renderMessages();
}

async function toggleFavourite(p) {
  if (!WANDERLY.loggedIn) { window.location.href = "/auth"; return; }
  const k = placeKey(p);
  const existing = state.favourites.get(k);
  if (existing) {
    await fetch(`/api/favourites/${existing.id}`, { method: "DELETE" });
    state.favourites.delete(k);
  } else {
    await fetch("/api/favourites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: p.name, city: p.city, latitude: p.lat, longitude: p.lng }),
    });
    await loadFavourites();
    return;
  }
  renderFavList();
  renderMessages();
}

function renderFavList() {
  const wrap = $("#favList");
  $("#favCount").textContent = state.favourites.size;
  if (!WANDERLY.loggedIn) return;
  if (state.favourites.size === 0) {
    wrap.innerHTML = `<p class="muted">No favourites yet — tap ♥ on a place.</p>`;
    return;
  }
  wrap.innerHTML = "";
  for (const { id, place: p } of state.favourites.values()) {
    const k = placeKey(p);
    const img = state.imgCache.get(k) || localStorage.getItem("wanderly:img:" + k);
    const card = document.createElement("div");
    card.className = "place-card";
    card.innerHTML = `
      <div class="place-img">${img ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover"/>` : "🖼"}</div>
      <button class="fav-btn active" title="Remove">♥</button>
      <div class="place-meta">
        <p class="place-name">${escapeHtml(p.name)}</p>
        ${p.city ? `<p class="place-city">📍 ${escapeHtml(p.city)}</p>` : ""}
      </div>`;
    card.querySelector(".fav-btn").onclick = () => toggleFavourite(p);
    wrap.appendChild(card);
    if (!img) getPlaceImage(p).then(() => renderFavList());
  }
}

// ---------- Logout ----------
const logoutBtn = $("#logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.reload();
  });
}

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

loadFavourites();
