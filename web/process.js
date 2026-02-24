const MANIFEST_URL_CANDIDATES = [
  "./process_manifest.json",
  "/web/process_manifest.json",
  "../web/process_manifest.json",
  "../process_manifest.json",
];
const MANIFEST_TIMEOUT_MS = 4500;

const DEFAULT_INTERVALS_MS = {
  pages: 900,
  splits: 340,
  parts: 220,
};

const SPEED_STEP_MS = 70;
const DEFAULT_CONTROLS_TEXT = "SPACE Pause/Play All • 1/2/3 Toggle Lane • ←/→ Step All • Q/W Page Speed • A/S Split Speed • Z/X Part Speed • +/- Global Speed • R Shuffle";

const refs = {
  summary: document.getElementById("proc-summary"),
  controls: document.getElementById("proc-controls"),
  pages: {
    image: document.getElementById("pages-image"),
    counter: document.getElementById("pages-counter"),
    meta: document.getElementById("pages-meta"),
    title: "FULL PAGE DEBUGS",
  },
  splits: {
    image: document.getElementById("splits-image"),
    counter: document.getElementById("splits-counter"),
    meta: document.getElementById("splits-meta"),
    title: "SPLIT DEBUGS",
  },
  parts: {
    image: document.getElementById("parts-image"),
    counter: document.getElementById("parts-counter"),
    meta: document.getElementById("parts-meta"),
    title: "PARTS + SLICES",
  },
};

const state = {
  lanes: {
    pages: { items: [], idx: 0, ms: DEFAULT_INTERVALS_MS.pages, timer: null, playing: true, tryIdx: 0, currentCandidates: [] },
    splits: { items: [], idx: 0, ms: DEFAULT_INTERVALS_MS.splits, timer: null, playing: true, tryIdx: 0, currentCandidates: [] },
    parts: { items: [], idx: 0, ms: DEFAULT_INTERVALS_MS.parts, timer: null, playing: true, tryIdx: 0, currentCandidates: [] },
  },
  loadedManifestUrl: null,
};

function basename(path) {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function toItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((it) => it && typeof it.path === "string" && typeof it.group === "string");
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  values.forEach((value) => {
    const v = String(value || "").trim();
    if (!v || seen.has(v)) {
      return;
    }
    seen.add(v);
    out.push(v);
  });
  return out;
}

function buildPathCandidates(path) {
  const raw = String(path || "").trim();
  if (!raw) {
    return [];
  }

  const candidates = [raw];
  const trimmed = raw.replace(/^\.?\//, "");
  if (trimmed !== raw) {
    candidates.push(`./${trimmed}`);
    candidates.push(`/${trimmed}`);
  }
  if (raw.startsWith("../")) {
    const noParent = raw.slice(3);
    candidates.push(`/${noParent}`);
    candidates.push(`./${noParent}`);
  }

  const debugPrefix = "DEBUG_PAGES_DROP/";
  const partsPrefix = "PARTS_SMART_LATEST/";
  const rawDropPrefix = "processed_raw_drop_2_10_46/";

  if (raw.includes(debugPrefix)) {
    const tail = raw.split(debugPrefix)[1];
    candidates.push(`../DEBUG_PAGES_DROP/${tail}`);
    candidates.push(`/DEBUG_PAGES_DROP/${tail}`);
    candidates.push(`./DEBUG_PAGES_DROP/${tail}`);
    candidates.push(`../processed_raw_drop_2_10_46/debug_pages/${tail}`);
    candidates.push(`/processed_raw_drop_2_10_46/debug_pages/${tail}`);
  }

  if (raw.includes(partsPrefix)) {
    const tail = raw.split(partsPrefix)[1];
    candidates.push(`../PARTS_SMART_LATEST/${tail}`);
    candidates.push(`/PARTS_SMART_LATEST/${tail}`);
    candidates.push(`./PARTS_SMART_LATEST/${tail}`);
    candidates.push(`../processed_raw_drop_2_10_46/parts_smart/${tail}`);
    candidates.push(`/processed_raw_drop_2_10_46/parts_smart/${tail}`);
  }

  if (raw.includes(rawDropPrefix)) {
    const tail = raw.split(rawDropPrefix)[1];
    candidates.push(`../processed_raw_drop_2_10_46/${tail}`);
    candidates.push(`/processed_raw_drop_2_10_46/${tail}`);
  }

  return uniqueStrings(candidates);
}

function classifyLegacyItem(item) {
  const group = String(item.group || "").toLowerCase();
  const path = String(item.path || "").toLowerCase();

  if (group === "debug_pages" || path.includes("/debug_pages/")) {
    return "pages";
  }
  if (group === "debug_splits" || group === "rerun_debug" || path.includes("debug_splits") || path.includes("rerun_debug")) {
    return "splits";
  }
  if (["head", "torso", "legs", "feet"].includes(group) || path.includes("/head/") || path.includes("/torso/") || path.includes("/legs/") || path.includes("/feet/")) {
    return "parts";
  }
  return null;
}

function normalizeManifest(data) {
  const lanes = { pages: [], splits: [], parts: [] };
  const intervals = { ...DEFAULT_INTERVALS_MS };

  if (data && typeof data === "object" && data.intervalsMs && typeof data.intervalsMs === "object") {
    ["pages", "splits", "parts"].forEach((key) => {
      const v = Number(data.intervalsMs[key]);
      if (Number.isFinite(v) && v >= 80) {
        intervals[key] = Math.round(v);
      }
    });
  }

  if (data && typeof data === "object" && data.lanes && typeof data.lanes === "object") {
    lanes.pages = toItems(data.lanes.pages).map((item) => ({ ...item, candidates: buildPathCandidates(item.path) }));
    lanes.splits = toItems(data.lanes.splits).map((item) => ({ ...item, candidates: buildPathCandidates(item.path) }));
    lanes.parts = toItems(data.lanes.parts).map((item) => ({ ...item, candidates: buildPathCandidates(item.path) }));
    return { lanes, intervals };
  }

  if (data && typeof data === "object") {
    const legacy = toItems(data.sources);
    legacy.forEach((item) => {
      const lane = classifyLegacyItem(item);
      if (lane) {
        lanes[lane].push({ ...item, candidates: buildPathCandidates(item.path) });
      }
    });
  }

  return { lanes, intervals };
}

function renderLane(key) {
  const lane = state.lanes[key];
  const ref = refs[key];
  if (!lane || !ref) {
    return;
  }

  if (!lane.items.length) {
    ref.counter.textContent = "0/0";
    ref.meta.textContent = `${ref.title} • NO IMAGES`;
    ref.image.removeAttribute("src");
    return;
  }

  const item = lane.items[lane.idx];
  const itemCandidates = item.candidates && item.candidates.length ? item.candidates : buildPathCandidates(item.path);
  lane.currentCandidates = itemCandidates;
  lane.tryIdx = 0;
  ref.image.src = itemCandidates[0] || item.path;
  ref.counter.textContent = `${lane.idx + 1}/${lane.items.length}`;
  const status = lane.playing ? "PLAY" : "PAUSE";
  ref.meta.textContent = `${item.group.toUpperCase()} • ${basename(item.path)} • ${lane.ms}ms • ${status}`;
}

function updateSummary() {
  const p = state.lanes.pages;
  const s = state.lanes.splits;
  const t = state.lanes.parts;
  refs.summary.textContent = `PAGES ${p.items.length} @${p.ms}ms • SPLITS ${s.items.length} @${s.ms}ms • PARTS ${t.items.length} @${t.ms}ms`;
}

function scheduleLane(key) {
  const lane = state.lanes[key];
  if (!lane) {
    return;
  }

  if (lane.timer) {
    clearInterval(lane.timer);
    lane.timer = null;
  }

  if (!lane.playing || lane.items.length <= 1) {
    renderLane(key);
    updateSummary();
    return;
  }

  lane.timer = setInterval(() => {
    lane.idx = (lane.idx + 1) % lane.items.length;
    renderLane(key);
  }, lane.ms);

  renderLane(key);
  updateSummary();
}

function flashControls(text) {
  refs.controls.textContent = text;
  refs.controls.classList.add("flash");
  setTimeout(() => {
    const manifestSource = state.loadedManifestUrl ? ` • SRC ${state.loadedManifestUrl}` : "";
    refs.controls.textContent = `${DEFAULT_CONTROLS_TEXT}${manifestSource}`;
    refs.controls.classList.remove("flash");
  }, 800);
}

function stepLane(key, delta) {
  const lane = state.lanes[key];
  if (!lane || !lane.items.length) {
    return;
  }
  lane.idx = (lane.idx + delta + lane.items.length) % lane.items.length;
  renderLane(key);
}

function stepAll(delta) {
  ["pages", "splits", "parts"].forEach((key) => {
    stepLane(key, delta);
  });
}

function toggleLane(key) {
  const lane = state.lanes[key];
  if (!lane) {
    return;
  }
  lane.playing = !lane.playing;
  scheduleLane(key);
  flashControls(`${key.toUpperCase()} ${lane.playing ? "PLAY" : "PAUSE"}`);
}

function toggleAll() {
  const anyPlaying = ["pages", "splits", "parts"].some((key) => state.lanes[key].playing);
  ["pages", "splits", "parts"].forEach((key) => {
    state.lanes[key].playing = !anyPlaying;
    scheduleLane(key);
  });
  flashControls(anyPlaying ? "ALL PAUSE" : "ALL PLAY");
}

function adjustLaneSpeed(key, deltaMs) {
  const lane = state.lanes[key];
  if (!lane) {
    return;
  }
  lane.ms = Math.max(80, Math.min(5000, lane.ms + deltaMs));
  scheduleLane(key);
  flashControls(`${key.toUpperCase()} SPEED ${lane.ms}ms`);
}

function adjustAllSpeeds(deltaMs) {
  ["pages", "splits", "parts"].forEach((key) => {
    const lane = state.lanes[key];
    lane.ms = Math.max(80, Math.min(5000, lane.ms + deltaMs));
    scheduleLane(key);
  });
  flashControls(`GLOBAL SPEED SHIFT ${deltaMs > 0 ? "+" : ""}${deltaMs}ms`);
}

function shuffleLane(key) {
  const lane = state.lanes[key];
  if (!lane || lane.items.length <= 1) {
    return;
  }
  for (let i = lane.items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [lane.items[i], lane.items[j]] = [lane.items[j], lane.items[i]];
  }
  lane.idx = 0;
  renderLane(key);
}

function shuffleAll() {
  ["pages", "splits", "parts"].forEach((key) => {
    shuffleLane(key);
  });
  flashControls("ALL SHUFFLED");
}

function wireImageErrorFallbacks() {
  ["pages", "splits", "parts"].forEach((key) => {
    const ref = refs[key];
    ref.image.addEventListener("error", () => {
      const lane = state.lanes[key];
      if (lane && lane.currentCandidates && lane.tryIdx + 1 < lane.currentCandidates.length) {
        lane.tryIdx += 1;
        ref.image.src = lane.currentCandidates[lane.tryIdx];
        return;
      }
      stepLane(key, 1);
      flashControls(`${key.toUpperCase()} SKIP MISSING FRAME`);
    });
  });
}

function wireKeys() {
  window.addEventListener("keydown", (evt) => {
    const key = evt.key.toLowerCase();

    if (key === " ") {
      evt.preventDefault();
      toggleAll();
      return;
    }

    if (evt.key === "ArrowRight") {
      evt.preventDefault();
      stepAll(1);
      return;
    }

    if (evt.key === "ArrowLeft") {
      evt.preventDefault();
      stepAll(-1);
      return;
    }

    if (key === "1") {
      evt.preventDefault();
      toggleLane("pages");
      return;
    }

    if (key === "2") {
      evt.preventDefault();
      toggleLane("splits");
      return;
    }

    if (key === "3") {
      evt.preventDefault();
      toggleLane("parts");
      return;
    }

    if (key === "q") {
      evt.preventDefault();
      adjustLaneSpeed("pages", SPEED_STEP_MS);
      return;
    }

    if (key === "w") {
      evt.preventDefault();
      adjustLaneSpeed("pages", -SPEED_STEP_MS);
      return;
    }

    if (key === "a") {
      evt.preventDefault();
      adjustLaneSpeed("splits", SPEED_STEP_MS);
      return;
    }

    if (key === "s") {
      evt.preventDefault();
      adjustLaneSpeed("splits", -SPEED_STEP_MS);
      return;
    }

    if (key === "z") {
      evt.preventDefault();
      adjustLaneSpeed("parts", SPEED_STEP_MS);
      return;
    }

    if (key === "x") {
      evt.preventDefault();
      adjustLaneSpeed("parts", -SPEED_STEP_MS);
      return;
    }

    if (evt.key === "+" || evt.key === "=") {
      evt.preventDefault();
      adjustAllSpeeds(-SPEED_STEP_MS);
      return;
    }

    if (evt.key === "-" || evt.key === "_") {
      evt.preventDefault();
      adjustAllSpeeds(SPEED_STEP_MS);
      return;
    }

    if (key === "r") {
      evt.preventDefault();
      shuffleAll();
    }
  });
}

async function init() {
  refs.summary.textContent = "LOADING PROCESS MANIFEST…";

  try {
    let data = null;
    let lastErr = null;

    for (const url of MANIFEST_URL_CANDIDATES) {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, MANIFEST_TIMEOUT_MS);

      try {
        const res = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        data = await res.json();
        state.loadedManifestUrl = url;
        clearTimeout(timeout);
        break;
      } catch (err) {
        clearTimeout(timeout);
        lastErr = err;
      }
    }

    if (!data) {
      throw new Error(`Manifest load failed (${lastErr ? lastErr.message : "unknown error"})`);
    }

    const normalized = normalizeManifest(data);

    ["pages", "splits", "parts"].forEach((key) => {
      state.lanes[key].items = normalized.lanes[key];
      state.lanes[key].idx = 0;
      state.lanes[key].ms = normalized.intervals[key] || DEFAULT_INTERVALS_MS[key];
      state.lanes[key].playing = true;
      scheduleLane(key);
    });

    updateSummary();
    refs.controls.textContent = `${DEFAULT_CONTROLS_TEXT} • SRC ${state.loadedManifestUrl}`;

    const total = state.lanes.pages.items.length + state.lanes.splits.items.length + state.lanes.parts.items.length;
    if (total === 0) {
      throw new Error("No process images found for pages/splits/parts");
    }
  } catch (err) {
    refs.summary.textContent = `ERROR: ${err.message}`;
    refs.controls.textContent = `${DEFAULT_CONTROLS_TEXT} • MANIFEST ERROR`;
    ["pages", "splits", "parts"].forEach((key) => {
      refs[key].counter.textContent = "0/0";
      refs[key].meta.textContent = "NO DATA";
      refs[key].image.removeAttribute("src");
    });
  }
}

wireImageErrorFallbacks();
wireKeys();
init();
