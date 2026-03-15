const GALLERY_STORAGE_KEY = "creature-gallery-v1";
const SYNC_CHANNEL_NAME = "creature-sync-v1";
const LIVE_SUBMISSIONS_ENDPOINT = "/api/submissions";

const gridEl = document.getElementById("gallery-grid");
const countEl = document.getElementById("gallery-count");
const clearBtn = document.getElementById("clear-wall");

let usingLiveWall = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readEntries() {
  try {
    const raw = localStorage.getItem(GALLERY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchLiveEntries(limit = 240) {
  const res = await fetch(`${LIVE_SUBMISSIONS_ENDPOINT}?limit=${limit}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Live gallery fetch failed: ${res.status}`);
  }

  const data = await res.json();
  return {
    entries: Array.isArray(data?.submissions) ? data.submissions : [],
    total: Number(data?.total) || 0,
  };
}

function formatTime(ts) {
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function cardHtml(entry) {
  const name = escapeHtml(String(entry?.name || "CREATURE").toUpperCase());
  const category = escapeHtml(String(entry?.category || "Hybrids").toUpperCase());
  const seed = escapeHtml(String(entry?.seed || "--------"));
  const setLabel = escapeHtml(String(entry?.setLabel || "--"));
  const imageSrc = entry?.imageUrl || entry?.image || "";
  const media = imageSrc
    ? `<img src="${escapeHtml(imageSrc)}" alt="${name}" loading="lazy" />`
    : `<div class="img-fallback" aria-label="No thumbnail available"></div>`;

  return `
    <article class="card">
      <div class="card-title">${name}</div>
      <div class="card-frame">
        ${media}
      </div>
      <div class="card-data">
        <span>${category}</span>
        <span>SEED ${seed}</span>
        <span>SET ${setLabel}</span>
        <span>${escapeHtml(formatTime(entry?.at))}</span>
      </div>
    </article>
  `;
}

function setButtonMode() {
  if (!clearBtn) {
    return;
  }
  clearBtn.textContent = usingLiveWall ? "REFRESH WALL" : "CLEAR LOCAL";
}

function render(entries, total) {
  const list = Array.isArray(entries) ? entries : [];
  const count = Number.isFinite(total) && total > 0 ? total : list.length;
  countEl.textContent = `${count} SAVED CREATURES`;
  gridEl.innerHTML = list.map(cardHtml).join("");
}

async function refreshGallery() {
  try {
    const live = await fetchLiveEntries();
    usingLiveWall = true;
    setButtonMode();
    render(live.entries, live.total);
    return;
  } catch {
    usingLiveWall = false;
    setButtonMode();
    const localEntries = readEntries();
    render(localEntries, localEntries.length);
  }
}

if (clearBtn) {
  clearBtn.addEventListener("click", async () => {
    if (usingLiveWall) {
      await refreshGallery();
      return;
    }

    localStorage.setItem(GALLERY_STORAGE_KEY, "[]");
    await refreshGallery();
  });
}

window.addEventListener("storage", (evt) => {
  if (evt.key === GALLERY_STORAGE_KEY) {
    refreshGallery();
  }
});

const chan = "BroadcastChannel" in window ? new BroadcastChannel(SYNC_CHANNEL_NAME) : null;
if (chan) {
  chan.onmessage = (evt) => {
    if (evt?.data?.type === "submit") {
      refreshGallery();
    }
  };
}

setInterval(() => {
  refreshGallery();
}, 8000);

setButtonMode();
refreshGallery();
