const GALLERY_STORAGE_KEY = "creature-gallery-v1";
const SYNC_CHANNEL_NAME = "creature-sync-v1";

const gridEl = document.getElementById("gallery-grid");
const countEl = document.getElementById("gallery-count");
const clearBtn = document.getElementById("clear-wall");

function readEntries() {
  try {
    const raw = localStorage.getItem(GALLERY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatTime(ts) {
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function cardHtml(entry) {
  const setText = entry.setNumber ? `SET ${String(entry.setNumber).padStart(3, "0")} ${entry.setId || ""}` : "SET --";
  const media = entry.image
    ? `<img src="${entry.image}" alt="${entry.name || "Creature"}" loading="lazy" />`
    : `<div class="img-fallback" aria-label="No thumbnail available"></div>`;
  return `
    <article class="card">
      ${media}
      <div class="card-meta">
        <div class="card-name">${entry.name || "CREATURE"}</div>
        <div class="card-line">${entry.seed || "--------"}</div>
        <div class="card-line">${setText}</div>
        <div class="card-line">${formatTime(entry.at)}</div>
      </div>
    </article>
  `;
}

function render() {
  const entries = readEntries();
  countEl.textContent = `${entries.length} ENTRIES`;
  gridEl.innerHTML = entries.map(cardHtml).join("");
}

if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    localStorage.setItem(GALLERY_STORAGE_KEY, "[]");
    render();
  });
}

window.addEventListener("storage", (evt) => {
  if (evt.key === GALLERY_STORAGE_KEY) {
    render();
  }
});

const chan = "BroadcastChannel" in window ? new BroadcastChannel(SYNC_CHANNEL_NAME) : null;
if (chan) {
  chan.onmessage = (evt) => {
    if (evt?.data?.type === "submit") {
      render();
    }
  };
}

setInterval(render, 2000);
render();
