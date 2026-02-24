const PARTS = ["head", "torso", "legs", "feet"];
const PART_ABBR = { head: "H", torso: "T", legs: "L", feet: "F" };

const KEYMAP = {
  q: ["head", -1],
  w: ["head", 1],
  a: ["torso", -1],
  s: ["torso", 1],
  z: ["legs", -1],
  x: ["legs", 1],
  o: ["feet", -1],
  p: ["feet", 1],
};

const TRIM_PX = 2;
const INK_THRESHOLD = 244;
const SOURCE_WINDOW_RATIO = 0.96;
const CANVAS_TOP_PADDING_RATIO = 0.06;
const CANVAS_BOTTOM_PADDING_RATIO = 0.01;
const SMALL_POOL_LIMIT = 30;
const POOL_ENTRY_SEP = "::";
const SOURCE_TAG = { smart: "S", curated: "C" };
const HISTORY_LIMIT = 300;
const SYNC_CHANNEL_NAME = "creature-sync-v1";
const SYNC_LAST_KEY = "creature-sync-last-v1";
const GALLERY_STORAGE_KEY = "creature-gallery-v1";
const GALLERY_LIMIT = 120;
const SUBMISSION_LOG_KEY = "creature-submissions-v1";
const SUBMISSION_LIMIT = 1500;
const VARIATION_LOG_KEY = "creature-variation-log-v1";
const VARIATION_LIMIT = 1800;

const state = {
  config: null,
  manifests: { large: null, small: null },
  poolFiles: {
    large: { head: [], torso: [], legs: [], feet: [] },
    small: { head: [], torso: [], legs: [], feet: [] },
  },
  poolSources: { large: "../PARTS_SMART_LATEST", small: "../CURATED PARTS" },
  files: { head: [], torso: [], legs: [], feet: [] },
  indices: { head: 0, torso: 0, legs: 0, feet: 0 },
  images: { head: new Map(), torso: new Map(), legs: new Map(), feet: new Map() },
  metrics: { head: new Map(), torso: new Map(), legs: new Map(), feet: new Map() },
  missing: { head: new Set(), torso: new Set(), legs: new Set(), feet: new Set() },
  basePath: "../PARTS_SMART_LATEST",
  poolMode: null,
  seen: new Set(),
  seenCounts: new Map(),
  partPickCounts: { head: new Map(), torso: new Map(), legs: new Map(), feet: new Map() },
  generationCount: 0,
  lastCommittedSignature: null,
  lastCommittedIndices: null,
  lastDistancePercent: 0,
  partLocks: { head: false, torso: false, legs: false, feet: false },
  cohesiveSets: [],
  cohesiveSetCursor: -1,
  currentSetNumber: null,
  currentSetId: null,
  anchorIndices: null,
  historyUndo: [],
  historyRedo: [],
  locked: false,
  autoRandomizedSinceLastInput: false,
  timers: {
    lockTransition: null,
    lockFinal: null,
    cursorHide: null,
    autoRandomize: null,
  },
};

const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const backCanvas = document.createElement("canvas");
const backCtx = backCanvas.getContext("2d");
let renderSeq = 0;
let uiAttached = false;
const syncChannel = "BroadcastChannel" in window ? new BroadcastChannel(SYNC_CHANNEL_NAME) : null;

const statusEl = document.getElementById("status");
const errorsEl = document.getElementById("errors");
const overlayEl = document.getElementById("lock-overlay");
const overlayIndicesEl = document.getElementById("overlay-indices");
const overlaySeedEl = document.getElementById("overlay-seed");
const overlayStabilityEl = document.getElementById("overlay-stability");
const zoneControlsEl = document.getElementById("zone-controls");
const creatureNameEl = document.getElementById("creature-name-value");

const statCreatureIndexEl = document.getElementById("stat-creature-index");
const statSeenEl = document.getElementById("stat-seen");
const comboCreatureIndexEl = document.getElementById("combo-creature-index");
const comboSeenEl = document.getElementById("combo-seen");
const comboRepeatEl = document.getElementById("combo-repeat");
const comboTotalEl = document.getElementById("combo-total");
const comboExploredEl = document.getElementById("combo-explored");
const comboRepeatPillEl = document.querySelector(".combo-pill-alert");
const statHumanEl = document.getElementById("stat-human");
const statTorsoEl = document.getElementById("stat-torso");
const statCoherenceEl = document.getElementById("stat-coherence");
const statMutationEl = document.getElementById("stat-mutation");
const statSyncEl = document.getElementById("stat-sync");
const statRarityEl = document.getElementById("stat-rarity");
const statDistanceEl = document.getElementById("stat-distance");
const statSetEl = document.getElementById("stat-set");
const statRepeatEl = document.getElementById("stat-repeat");
const statGenerationEl = document.getElementById("stat-generation");
const statCorrHTEl = document.getElementById("stat-corr-ht");
const statCorrLFEl = document.getElementById("stat-corr-lf");
const statCorrULEl = document.getElementById("stat-corr-ul");
const heatHeadEl = document.getElementById("heat-head");
const heatTorsoEl = document.getElementById("heat-torso");
const heatLegsEl = document.getElementById("heat-legs");
const heatFeetEl = document.getElementById("heat-feet");
const repeatAlarmEl = document.getElementById("repeat-alarm");
const spaceTickerEl = document.getElementById("space-ticker");

const poolGateEl = document.getElementById("pool-gate");
const poolLargeBtn = document.getElementById("pool-large");
const poolSmallBtn = document.getElementById("pool-small");
const goBackBtn = document.getElementById("go-back");
const submitBtn = document.getElementById("submit-creature");
const exportDataBtn = document.getElementById("export-data");
const setAnchorBtn = document.getElementById("set-anchor");
const mutateUnlockedBtn = document.getElementById("mutate-unlocked");
const undoBtn = document.getElementById("undo-action");
const redoBtn = document.getElementById("redo-action");
const lockButtons = Array.from(document.querySelectorAll("button.lock-btn[data-lock-part]"));

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function wrapIndex(value, count) {
  if (!count) {
    return 0;
  }
  return ((value % count) + count) % count;
}

function hash32(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function currentSignature() {
  return [state.poolMode || "none", ...PARTS.map((p) => `${p}:${state.files[p][state.indices[p]] || "none"}`)].join("|");
}

function seedFromState() {
  const seedNum = hash32(currentSignature());
  return seedNum.toString(16).toUpperCase().padStart(8, "0");
}

function stabilityFromSeed(seed) {
  const n = parseInt(seed, 16);
  return 60 + (n % 40);
}

function createRng(seedInt) {
  let t = seedInt >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  const u1 = Math.max(rng(), 1e-7);
  const u2 = Math.max(rng(), 1e-7);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function pick(rng, values) {
  return values[Math.floor(rng() * values.length) % values.length];
}

function toPercent(n) {
  return `${Math.round(n)}%`;
}

function toCorrelation(n) {
  return n.toFixed(2);
}

function cloneIndices(src = state.indices) {
  return {
    head: src.head,
    torso: src.torso,
    legs: src.legs,
    feet: src.feet,
  };
}

function cloneLocks(src = state.partLocks) {
  return {
    head: Boolean(src.head),
    torso: Boolean(src.torso),
    legs: Boolean(src.legs),
    feet: Boolean(src.feet),
  };
}

function changedPartsCount(a, b) {
  return PARTS.reduce((count, part) => count + (a[part] === b[part] ? 0 : 1), 0);
}

function distancePercentFromIndices(a, b) {
  return Math.round((changedPartsCount(a, b) / PARTS.length) * 100);
}

function makeSnapshot() {
  return {
    indices: cloneIndices(),
    locks: cloneLocks(),
    cohesiveSetCursor: state.cohesiveSetCursor,
    currentSetNumber: state.currentSetNumber,
    currentSetId: state.currentSetId,
  };
}

function snapshotsEqual(a, b) {
  if (!a || !b) {
    return false;
  }
  const sameIndices = PARTS.every((part) => a.indices?.[part] === b.indices?.[part]);
  const sameLocks = PARTS.every((part) => Boolean(a.locks?.[part]) === Boolean(b.locks?.[part]));
  const sameSetMeta =
    (a.cohesiveSetCursor ?? -1) === (b.cohesiveSetCursor ?? -1) &&
    (a.currentSetNumber ?? null) === (b.currentSetNumber ?? null) &&
    (a.currentSetId ?? null) === (b.currentSetId ?? null);
  return sameIndices && sameLocks && sameSetMeta;
}

function flashStatus(text, ms = 900) {
  statusEl.textContent = text;
  setTimeout(() => {
    statusEl.textContent = state.locked ? "LOCKED" : "READY";
  }, ms);
}

function updateLockButtons() {
  lockButtons.forEach((btn) => {
    const part = btn.dataset.lockPart;
    const active = Boolean(state.partLocks[part]);
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.title = active ? `${part.toUpperCase()} locked` : `${part.toUpperCase()} unlocked`;
  });
}

function updateHistoryButtons() {
  if (undoBtn) {
    undoBtn.disabled = state.historyUndo.length === 0;
  }
  if (redoBtn) {
    redoBtn.disabled = state.historyRedo.length === 0;
  }
}

function pushUndoSnapshot() {
  const snap = makeSnapshot();
  const last = state.historyUndo[state.historyUndo.length - 1];
  if (!last || !snapshotsEqual(last, snap)) {
    state.historyUndo.push(snap);
    if (state.historyUndo.length > HISTORY_LIMIT) {
      state.historyUndo.shift();
    }
  }
  state.historyRedo = [];
  updateHistoryButtons();
}

function applySnapshot(snapshot, fromHumanInput = true) {
  if (!snapshot) {
    return;
  }

  PARTS.forEach((part) => {
    const count = state.files[part].length;
    state.indices[part] = wrapIndex(snapshot.indices?.[part] ?? 0, count);
  });
  state.partLocks = cloneLocks(snapshot.locks || state.partLocks);
  state.cohesiveSetCursor = typeof snapshot.cohesiveSetCursor === "number" ? snapshot.cohesiveSetCursor : -1;
  state.currentSetNumber = snapshot.currentSetNumber ?? null;
  state.currentSetId = snapshot.currentSetId ?? null;
  updateLockButtons();
  if (fromHumanInput) {
    markInput();
  }
  redraw();
}

function undoAction(fromHumanInput = true) {
  if (state.historyUndo.length === 0) {
    flashStatus("NO UNDO", 600);
    return;
  }
  const current = makeSnapshot();
  const previous = state.historyUndo.pop();
  state.historyRedo.push(current);
  updateHistoryButtons();
  applySnapshot(previous, fromHumanInput);
}

function redoAction(fromHumanInput = true) {
  if (state.historyRedo.length === 0) {
    flashStatus("NO REDO", 600);
    return;
  }
  const current = makeSnapshot();
  const next = state.historyRedo.pop();
  state.historyUndo.push(current);
  updateHistoryButtons();
  applySnapshot(next, fromHumanInput);
}

function randomizePartToDifferentValue(part) {
  const count = state.files[part].length;
  if (count <= 1) {
    return;
  }
  const current = state.indices[part];
  let next = Math.floor(Math.random() * count);
  if (next === current) {
    next = (current + 1 + Math.floor(Math.random() * (count - 1))) % count;
  }
  state.indices[part] = next;
}

function idFromEntry(entry) {
  const file = displayFileFromEntry(entry);
  const m = file.match(/(\d{1,4})/);
  return m ? m[1].padStart(4, "0") : null;
}

function buildCohesiveSetsFromCurrentPool() {
  const perPart = { head: new Map(), torso: new Map(), legs: new Map(), feet: new Map() };
  PARTS.forEach((part) => {
    state.files[part].forEach((entry) => {
      const id = idFromEntry(entry);
      if (!id) {
        return;
      }
      const { sourceTag } = splitPoolEntry(entry);
      const source = sourceTag || "U";
      const key = `${source}:${id}`;
      if (perPart[part].has(key)) {
        return;
      }
      perPart[part].set(key, entry);
    });
  });

  const keys = [...perPart.head.keys()].filter((key) => PARTS.every((part) => perPart[part].has(key)));
  keys.sort((a, b) => {
    const [sourceA, idA] = a.split(":");
    const [sourceB, idB] = b.split(":");
    if (sourceA !== sourceB) {
      return sourceA.localeCompare(sourceB);
    }
    return Number(idA) - Number(idB);
  });

  state.cohesiveSets = keys.map((key, idx) => {
    const [source, id] = key.split(":");
    return {
    number: idx + 1,
    id: `${source}-${id}`,
    idRaw: id,
    source,
    entries: {
      head: perPart.head.get(key),
      torso: perPart.torso.get(key),
      legs: perPart.legs.get(key),
      feet: perPart.feet.get(key),
    },
  };
  });
  if (state.cohesiveSetCursor >= state.cohesiveSets.length) {
    state.cohesiveSetCursor = -1;
  }
}

function syncCurrentSetMarker() {
  if (!state.cohesiveSets.length) {
    state.currentSetNumber = null;
    state.currentSetId = null;
    state.cohesiveSetCursor = -1;
    return;
  }
  const idx = state.cohesiveSets.findIndex((set) =>
    PARTS.every((part) => set.entries[part] === state.files[part][state.indices[part]]),
  );
  if (idx >= 0) {
    state.cohesiveSetCursor = idx;
    state.currentSetNumber = state.cohesiveSets[idx].number;
    state.currentSetId = state.cohesiveSets[idx].id;
  } else {
    state.currentSetNumber = null;
    state.currentSetId = null;
  }
}

function setAnchor(fromHumanInput = true) {
  if (!state.cohesiveSets.length) {
    buildCohesiveSetsFromCurrentPool();
  }
  if (!state.cohesiveSets.length) {
    flashStatus("NO SET", 700);
    return;
  }

  if (fromHumanInput) {
    pushUndoSnapshot();
  }
  let nextCursor = Math.floor(Math.random() * state.cohesiveSets.length);
  if (state.cohesiveSets.length > 1 && nextCursor === state.cohesiveSetCursor) {
    nextCursor = (nextCursor + 1 + Math.floor(Math.random() * (state.cohesiveSets.length - 1))) % state.cohesiveSets.length;
  }
  const set = state.cohesiveSets[nextCursor];
  PARTS.forEach((part) => {
    const idx = state.files[part].indexOf(set.entries[part]);
    if (idx >= 0) {
      state.indices[part] = idx;
    }
  });
  state.cohesiveSetCursor = nextCursor;
  state.currentSetNumber = set.number;
  state.currentSetId = set.id;
  if (fromHumanInput) {
    markInput();
  }
  flashStatus(`SET ${set.id}`, 800);
  redraw();
}

function mutateUnlocked(fromHumanInput = true) {
  const unlocked = PARTS.filter((part) => !state.partLocks[part]);
  if (unlocked.length === 0) {
    flashStatus("ALL LOCKED", 700);
    return;
  }

  if (fromHumanInput) {
    pushUndoSnapshot();
  }
  unlocked.forEach((part) => {
    randomizePartToDifferentValue(part);
  });
  if (fromHumanInput) {
    markInput();
  }
  redraw();
}

function togglePartLock(part, fromHumanInput = true) {
  if (!PARTS.includes(part)) {
    return;
  }
  if (fromHumanInput) {
    pushUndoSnapshot();
  }
  state.partLocks[part] = !state.partLocks[part];
  updateLockButtons();
  if (fromHumanInput) {
    markInput();
  }
  updateOverlay();
  updateGeneratedProfile();
}

function goBackAction(fromHumanInput = true) {
  if (fromHumanInput) {
    markInput();
  }
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  openPoolGate();
}

function makePoolEntry(file, sourceTag) {
  return `${sourceTag}${POOL_ENTRY_SEP}${file}`;
}

function splitPoolEntry(entry) {
  if (typeof entry !== "string") {
    return { sourceTag: null, file: String(entry || "") };
  }

  const i = entry.indexOf(POOL_ENTRY_SEP);
  if (i === -1) {
    return { sourceTag: null, file: entry };
  }

  return {
    sourceTag: entry.slice(0, i),
    file: entry.slice(i + POOL_ENTRY_SEP.length),
  };
}

function displayFileFromEntry(entry) {
  return splitPoolEntry(entry).file;
}

function partIdFromSelection(part) {
  const entry = state.files[part][state.indices[part]];
  const file = displayFileFromEntry(entry);
  if (!file) {
    return "----";
  }
  const m = file.match(/(\d{1,4})/);
  if (!m) {
    return file.replace(/\.png$/i, "");
  }
  return m[1].padStart(4, "0");
}

function extractFilesFromManifest(manifest) {
  const out = { head: [], torso: [], legs: [], feet: [] };
  PARTS.forEach((part) => {
    const items = Array.isArray(manifest?.parts?.[part]) ? manifest.parts[part] : [];
    out[part] = items.map((it) => it.file).filter(Boolean);
  });
  return out;
}

function idFromManifestEntry(entry) {
  const raw = entry?.id || entry?.file || "";
  const m = String(raw).match(/(\d{1,4})/);
  if (!m) {
    return null;
  }
  return m[1].padStart(4, "0");
}

function sortIds(ids) {
  return ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function buildCorrelatedPool(manifest, limit = 0) {
  const fileById = { head: new Map(), torso: new Map(), legs: new Map(), feet: new Map() };

  PARTS.forEach((part) => {
    const items = Array.isArray(manifest?.parts?.[part]) ? manifest.parts[part] : [];
    for (const item of items) {
      if (!item?.file) {
        continue;
      }
      const id = idFromManifestEntry(item);
      if (!id || fileById[part].has(id)) {
        continue;
      }
      fileById[part].set(id, item.file);
    }
  });

  let commonIds = [...fileById[PARTS[0]].keys()].filter((id) => PARTS.every((part) => fileById[part].has(id)));
  commonIds = sortIds(commonIds);

  if (limit > 0) {
    commonIds = commonIds.slice(0, limit);
  }

  const files = { head: [], torso: [], legs: [], feet: [] };
  PARTS.forEach((part) => {
    files[part] = commonIds.map((id) => fileById[part].get(id)).filter(Boolean);
  });

  const complete = commonIds.length > 0 && PARTS.every((part) => files[part].length === commonIds.length);
  return { files, ids: commonIds, complete };
}

function clearAssetCaches() {
  PARTS.forEach((part) => {
    state.images[part].clear();
    state.metrics[part].clear();
    state.missing[part].clear();
  });
}

function totalVariationsCount() {
  let total = 1n;
  for (const part of PARTS) {
    const c = BigInt(state.files[part].length || 0);
    if (c === 0n) {
      return 0n;
    }
    total *= c;
  }
  return total;
}

function creatureIndexFromState() {
  if (PARTS.some((part) => state.files[part].length === 0)) {
    return 0n;
  }

  let idx = 0n;
  for (const part of PARTS) {
    idx = idx * BigInt(state.files[part].length) + BigInt(state.indices[part]);
  }
  return idx + 1n;
}

function normalizedIndex(part) {
  const count = state.files[part].length;
  if (count <= 1) {
    return 0.5;
  }
  return state.indices[part] / (count - 1);
}

function statFromNormal(rng, mean, stdDev, min, max) {
  return clamp(mean + gaussian(rng) * stdDev, min, max);
}

function proceduralName(seedInt) {
  const rng = createRng(seedInt ^ 0x9e3779b9);
  const first = [
    "Amber",
    "Arc",
    "Ash",
    "Atomic",
    "Binary",
    "Black",
    "Blind",
    "Blue",
    "Bright",
    "Broken",
    "Chrome",
    "Cinder",
    "Cold",
    "Copper",
    "Crimson",
    "Crystal",
    "Distant",
    "Echo",
    "Electric",
    "Feral",
    "Final",
    "Ghost",
    "Glass",
    "Golden",
    "Hollow",
    "Velvet",
    "Iron",
    "Solar",
    "Neon",
    "Night",
    "Null",
    "Obsidian",
    "Old",
    "Prime",
    "Primal",
    "Quiet",
    "Red",
    "Royal",
    "Rust",
    "Silent",
    "Silver",
    "Signal",
    "Paper",
    "Static",
    "Stone",
    "Velour",
    "White",
    "Wild",
  ];
  const second = [
    "Animal",
    "Archive",
    "Beacon",
    "Bloom",
    "Body",
    "Carrier",
    "Channel",
    "Cipher",
    "Circuit",
    "Chorus",
    "Crown",
    "Current",
    "Drifter",
    "Echo",
    "Engine",
    "Figure",
    "Flame",
    "Form",
    "Frame",
    "Garden",
    "Keeper",
    "Mask",
    "Mimic",
    "Mirror",
    "Walker",
    "Oracle",
    "Pattern",
    "Phantom",
    "River",
    "Ritual",
    "Sensor",
    "Signal",
    "Spiral",
    "Structure",
    "Thread",
    "Totem",
    "Vector",
    "Witness",
    "Visitor",
  ];
  const tail = [
    "ALPHA",
    "ARCHIVE",
    "ATLAS",
    "BAND",
    "BLOCK",
    "CITY",
    "CORE",
    "DELTA",
    "DISTRICT",
    "DOMAIN",
    "ECHO",
    "FIELD",
    "GRID",
    "GROUP",
    "HOUSE",
    "INDEX",
    "LAB",
    "LINE",
    "NODE",
    "PHASE",
    "PLAZA",
    "POINT",
    "RANGE",
    "SECTOR",
    "UNIT",
    "ZONE",
  ];
  const connectors = ["OF", "IN", "FROM", "UNDER", "BEYOND"];

  const style = rng();
  if (style < 0.56) {
    return `${pick(rng, first)} ${pick(rng, second)}`;
  }
  if (style < 0.84) {
    return `${pick(rng, first)} ${pick(rng, second)} ${pick(rng, tail)}`;
  }
  if (style < 0.94) {
    return `${pick(rng, first)}-${pick(rng, first)} ${pick(rng, second)}`;
  }
  return `${pick(rng, first)} ${pick(rng, second)} ${pick(rng, connectors)} ${pick(rng, tail)}`;
}

function computeGeneratedProfile() {
  const seedInt = hash32(currentSignature());
  const rng = createRng(seedInt);

  const h = normalizedIndex("head");
  const t = normalizedIndex("torso");
  const l = normalizedIndex("legs");
  const f = normalizedIndex("feet");

  const corrHTBase = 1 - Math.abs(h - t);
  const corrLFBase = 1 - Math.abs(l - f);
  const corrULBase = 1 - Math.abs((h + t) / 2 - (l + f) / 2);

  const corrHT = clamp(corrHTBase + gaussian(rng) * 0.06, 0, 0.99);
  const corrLF = clamp(corrLFBase + gaussian(rng) * 0.06, 0, 0.99);
  const corrUL = clamp(corrULBase + gaussian(rng) * 0.06, 0, 0.99);
  const corrMean = (corrHT + corrLF + corrUL) / 3;

  const coherence = statFromNormal(rng, 46 + corrMean * 42, 8, 20, 99);
  const mutation = statFromNormal(rng, 52 - corrMean * 22, 9, 5, 95);
  const sync = statFromNormal(rng, 40 + corrMean * 50, 7, 15, 99);

  const humanScoreRaw = coherence * 0.46 + sync * 0.36 + (100 - mutation) * 0.28 + gaussian(rng) * 4.5;
  const humanScore = clamp(Math.round(humanScoreRaw), 10, 99);

  return {
    name: proceduralName(seedInt),
    humanScore,
    coherence,
    mutation,
    sync,
    corrHT,
    corrLF,
    corrUL,
  };
}

function computeUniquenessMetrics() {
  const sig = currentSignature();
  const repeatCount = state.seenCounts.get(sig) || 0;
  const generationBase = Math.max(1, state.generationCount);

  let rarityAccum = 0;
  const partRarity = { head: 0, torso: 0, legs: 0, feet: 0 };
  PARTS.forEach((part) => {
    const entry = state.files[part][state.indices[part]];
    const count = state.partPickCounts[part].get(entry) || 0;
    const commonness = count / generationBase;
    const rarity = clamp(Math.round((1 - commonness) * 100), 0, 100);
    partRarity[part] = rarity;
    rarityAccum += rarity / 100;
  });

  const rarity = clamp(Math.round((rarityAccum / PARTS.length) * 100), 0, 100);
  const setLabel = state.currentSetNumber ? `${String(state.currentSetNumber).padStart(3, "0")}·${state.currentSetId || "----"}` : "--";

  return {
    rarity,
    distance: clamp(Math.round(state.lastDistancePercent), 0, 100),
    setLabel,
    partRarity,
    repeatCount,
    generation: state.generationCount,
  };
}

function exploredPercent(totalVariations) {
  if (!totalVariations || totalVariations <= 0n) {
    return 0;
  }
  return Number(state.seen.size) / Number(totalVariations);
}

function updateGeneratedProfile() {
  const profile = computeGeneratedProfile();
  const uniqueness = computeUniquenessMetrics();
  const total = totalVariationsCount();
  const current = creatureIndexFromState();

  if (creatureNameEl) {
    creatureNameEl.textContent = profile.name;
  }

  if (statCreatureIndexEl) {
    statCreatureIndexEl.textContent = current.toString();
  }
  if (comboCreatureIndexEl) {
    comboCreatureIndexEl.textContent = current.toString();
  }

  if (statSeenEl) {
    statSeenEl.textContent = `${state.seen.size}/${total.toString()}`;
  }
  if (comboSeenEl) {
    comboSeenEl.textContent = String(state.seen.size);
  }
  if (comboTotalEl) {
    comboTotalEl.textContent = total.toString();
  }

  if (statHumanEl) {
    statHumanEl.textContent = String(profile.humanScore);
  }
  if (statTorsoEl) {
    statTorsoEl.textContent = partIdFromSelection("torso");
  }
  if (statCoherenceEl) {
    statCoherenceEl.textContent = toPercent(profile.coherence);
  }
  if (statMutationEl) {
    statMutationEl.textContent = toPercent(profile.mutation);
  }
  if (statSyncEl) {
    statSyncEl.textContent = toPercent(profile.sync);
  }
  if (statRarityEl) {
    statRarityEl.textContent = toPercent(uniqueness.rarity);
  }
  if (statDistanceEl) {
    statDistanceEl.textContent = toPercent(uniqueness.distance);
  }
  if (statSetEl) {
    statSetEl.textContent = uniqueness.setLabel;
  }
  if (statRepeatEl) {
    statRepeatEl.textContent = `${uniqueness.repeatCount}x`;
  }
  if (comboRepeatEl) {
    comboRepeatEl.textContent = `${uniqueness.repeatCount}x`;
  }
  if (comboRepeatPillEl) {
    comboRepeatPillEl.classList.toggle("active", uniqueness.repeatCount > 1);
  }
  if (statGenerationEl) {
    statGenerationEl.textContent = String(uniqueness.generation);
  }
  if (statCorrHTEl) {
    statCorrHTEl.textContent = `HEAD~TORSO r=${toCorrelation(profile.corrHT)}`;
  }
  if (statCorrLFEl) {
    statCorrLFEl.textContent = `LEGS~FEET r=${toCorrelation(profile.corrLF)}`;
  }
  if (statCorrULEl) {
    statCorrULEl.textContent = `UPPER~LOWER r=${toCorrelation(profile.corrUL)}`;
  }

  if (heatHeadEl) {
    heatHeadEl.style.width = `${uniqueness.partRarity.head}%`;
  }
  if (heatTorsoEl) {
    heatTorsoEl.style.width = `${uniqueness.partRarity.torso}%`;
  }
  if (heatLegsEl) {
    heatLegsEl.style.width = `${uniqueness.partRarity.legs}%`;
  }
  if (heatFeetEl) {
    heatFeetEl.style.width = `${uniqueness.partRarity.feet}%`;
  }

  if (repeatAlarmEl) {
    const alarming = uniqueness.repeatCount > 1;
    repeatAlarmEl.classList.toggle("hidden", !alarming);
    repeatAlarmEl.textContent = `REPEAT ALERT x${uniqueness.repeatCount}`;
  }

  if (spaceTickerEl) {
    const explored = exploredPercent(total) * 100;
    spaceTickerEl.textContent = `SPACE ${state.seen.size} / ${total.toString()}  ${explored.toFixed(4)}%`;
    if (comboExploredEl) {
      comboExploredEl.textContent = `${explored.toFixed(4)}%`;
    }
  }
}

function setError(msg) {
  errorsEl.textContent = msg;
}

function clearError() {
  errorsEl.textContent = "";
}

function updateOverlay() {
  const labels = PARTS.map((part) => (state.partLocks[part] ? `${PART_ABBR[part]}*` : PART_ABBR[part])).join(" ");
  const seed = seedFromState();
  const stability = stabilityFromSeed(seed);

  overlayIndicesEl.textContent = labels;
  overlaySeedEl.textContent = `SEED ${seed}`;
  overlayStabilityEl.textContent = `STABILITY ${stability}%`;
}

function setLockState(locked) {
  state.locked = locked;
  if (locked) {
    statusEl.textContent = "LOCKED";
    updateOverlay();
    overlayEl.classList.remove("hidden");
    overlayEl.setAttribute("aria-hidden", "false");
  } else {
    statusEl.textContent = "READY";
    overlayEl.classList.add("hidden");
    overlayEl.setAttribute("aria-hidden", "true");
  }
}

function resetIdleTimers() {
  Object.values(state.timers).forEach((id) => {
    if (id) {
      clearTimeout(id);
    }
  });

  state.autoRandomizedSinceLastInput = false;
  document.body.classList.remove("hide-cursor");

  state.timers.cursorHide = setTimeout(() => {
    document.body.classList.add("hide-cursor");
  }, 3000);

  state.timers.lockTransition = setTimeout(() => {
    statusEl.textContent = "INTERPRETING...";
    state.timers.lockFinal = setTimeout(() => {
      setLockState(true);
    }, 600);
  }, 2000);

  state.timers.autoRandomize = setTimeout(() => {
    if (!state.autoRandomizedSinceLastInput) {
      randomizeAll(false);
      state.autoRandomizedSinceLastInput = true;
    }
  }, 60000);
}

function markInput() {
  setLockState(false);
  resetIdleTimers();
}

function imagePath(part, entry, basePath = state.basePath) {
  const { sourceTag, file } = splitPoolEntry(entry);
  let resolvedBase = basePath;
  if (sourceTag === SOURCE_TAG.smart) {
    resolvedBase = state.poolSources.large || resolvedBase;
  } else if (sourceTag === SOURCE_TAG.curated) {
    resolvedBase = state.poolSources.small || resolvedBase;
  }
  return `${resolvedBase}/${part}/${encodeURIComponent(file)}`;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

function analyzeInkBounds(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ox = off.getContext("2d", { willReadFrequently: true });
  ox.drawImage(img, 0, 0);

  const data = ox.getImageData(0, 0, w, h).data;

  let top = null;
  let bottom = null;
  let left = w - 1;
  let right = 0;

  for (let y = 0; y < h; y += 1) {
    let rowHasInk = false;
    const rowBase = y * w * 4;
    for (let x = 0; x < w; x += 1) {
      const i = rowBase + x * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r < INK_THRESHOLD || g < INK_THRESHOLD || b < INK_THRESHOLD) {
        rowHasInk = true;
        if (x < left) {
          left = x;
        }
        if (x > right) {
          right = x;
        }
      }
    }

    if (rowHasInk) {
      if (top === null) {
        top = y;
      }
      bottom = y;
    }
  }

  if (top === null || bottom === null) {
    return {
      top: 0,
      bottom: h - 1,
      left: 0,
      right: w - 1,
      cropTop: 0,
      cropBottom: h - 1,
      cropHeight: h,
      centerX: w / 2,
    };
  }

  const cropTop = clamp(top + TRIM_PX, 0, h - 1);
  const cropBottom = clamp(bottom - TRIM_PX, cropTop, h - 1);
  const cropHeight = Math.max(1, cropBottom - cropTop + 1);

  return {
    top,
    bottom,
    left,
    right,
    cropTop,
    cropBottom,
    cropHeight,
    centerX: (left + right) / 2,
  };
}

async function loadPartImage(part) {
  const entry = state.files[part][state.indices[part]];
  const file = displayFileFromEntry(entry);
  if (!entry || !file) {
    return { img: null, metric: null, file: null };
  }

  const cache = state.images[part];
  const metricCache = state.metrics[part];

  if (cache.has(entry) && metricCache.has(entry)) {
    return { img: cache.get(entry), metric: metricCache.get(entry), file };
  }

  if (state.missing[part].has(entry)) {
    return { img: null, metric: null, file };
  }

  const src = imagePath(part, entry);
  try {
    const img = await loadImage(src);
    cache.set(entry, img);

    const metric = analyzeInkBounds(img);
    metricCache.set(entry, metric);

    return { img, metric, file };
  } catch {
    state.missing[part].add(entry);
    return { img: null, metric: null, file };
  }
}

function computeLayout(selected, canvasSize) {
  const total = selected.reduce((sum, s) => sum + (s.metric ? s.metric.cropHeight : 1), 0);
  const topPad = Math.round(canvasSize * CANVAS_TOP_PADDING_RATIO);
  const bottomPad = Math.round(canvasSize * CANVAS_BOTTOM_PADDING_RATIO);
  const usable = Math.max(1, canvasSize - topPad - bottomPad);

  let y = topPad;

  return selected.map((s, idx) => {
    let h;
    if (idx === selected.length - 1) {
      h = canvasSize - bottomPad - y;
    } else {
      h = Math.max(1, Math.round(((s.metric ? s.metric.cropHeight : 1) / total) * usable));
    }

    const out = { ...s, y, h };
    y += h;
    return out;
  });
}

function positionZoneControls(layout) {
  layout.forEach(({ part, y, h }) => {
    const zone = zoneControlsEl.querySelector(`.zone-control[data-part="${part}"]`);
    if (!zone) {
      return;
    }
    const centerPercent = ((y + h / 2) / state.config.canvas) * 100;
    zone.style.top = `${centerPercent}%`;
  });
}

function drawMissingPart(targetCtx, part, file, y, h) {
  const size = state.config.canvas;
  targetCtx.save();
  targetCtx.fillStyle = "rgba(255,255,255,0.9)";
  targetCtx.fillRect(0, y, size, h);
  targetCtx.strokeStyle = "rgba(0,0,0,0.3)";
  targetCtx.strokeRect(0, y, size, h);
  targetCtx.fillStyle = "#111";
  targetCtx.font = `${Math.round(size * 0.022)}px Helvetica`;
  targetCtx.textAlign = "center";
  targetCtx.textBaseline = "middle";
  targetCtx.fillText(`MISSING ${part.toUpperCase()} ${file || "(none)"}`, size / 2, y + h / 2);
  targetCtx.restore();
}

async function redraw() {
  if (PARTS.some((part) => state.files[part].length === 0)) {
    setError("No files in selected pool.");
    return;
  }

  const seq = ++renderSeq;
  const size = state.config.canvas;

  const selected = [];
  for (const part of PARTS) {
    const loaded = await loadPartImage(part);
    selected.push({ part, ...loaded });
  }

  if (seq !== renderSeq) {
    return;
  }

  const layout = computeLayout(selected, size);
  const validMetrics = layout.filter((l) => l.metric);
  const sortedCenters = validMetrics.map((l) => l.metric.centerX).sort((a, b) => a - b);
  const targetCenterX = sortedCenters.length ? sortedCenters[Math.floor(sortedCenters.length / 2)] : null;

  backCanvas.width = size;
  backCanvas.height = size;
  backCtx.clearRect(0, 0, size, size);
  backCtx.fillStyle = "#fff";
  backCtx.fillRect(0, 0, size, size);

  let hadMissing = false;

  for (const segment of layout) {
    const { part, img, metric, y, h, file } = segment;

    if (img && metric) {
      const srcY = metric.cropTop;
      const srcH = metric.cropHeight;
      const srcW = clamp(Math.floor(img.naturalWidth * SOURCE_WINDOW_RATIO), 1, img.naturalWidth);
      const target = targetCenterX === null ? metric.centerX : targetCenterX;
      const blendedCenter = metric.centerX * 0.65 + target * 0.35;
      const srcX = clamp(Math.round(blendedCenter - srcW / 2), 0, img.naturalWidth - srcW);

      backCtx.save();
      backCtx.beginPath();
      backCtx.rect(0, y, size, h);
      backCtx.clip();
      backCtx.drawImage(img, srcX, srcY, srcW, srcH, 0, y, size, h);
      backCtx.restore();
    } else {
      hadMissing = true;
      drawMissingPart(backCtx, part, file, y, h);
    }
  }

  if (seq !== renderSeq) {
    return;
  }

  ctx.drawImage(backCanvas, 0, 0);

  if (hadMissing) {
    setError("Some images are missing (app still running)");
  } else {
    clearError();
  }

  const signature = currentSignature();
  const changedSelection = signature !== state.lastCommittedSignature;

  if (changedSelection) {
    const previous = state.lastCommittedIndices ? cloneIndices(state.lastCommittedIndices) : null;
    state.seen.add(signature);
    state.seenCounts.set(signature, (state.seenCounts.get(signature) || 0) + 1);
    state.generationCount += 1;
    PARTS.forEach((part) => {
      const entry = state.files[part][state.indices[part]];
      const map = state.partPickCounts[part];
      map.set(entry, (map.get(entry) || 0) + 1);
    });
    state.lastDistancePercent = previous ? distancePercentFromIndices(previous, state.indices) : 0;
    state.lastCommittedIndices = cloneIndices();
    state.lastCommittedSignature = signature;
    appendVariationLogEntry(signature);
  }

  syncCurrentSetMarker();
  updateGeneratedProfile();
  emitSyncSnapshot();
  updateHistoryButtons();
  positionZoneControls(layout);
  if (state.locked) {
    updateOverlay();
  }
}

function shiftPart(part, delta, fromHumanInput = true) {
  const count = state.files[part].length;
  if (count <= 1) {
    return;
  }
  if (fromHumanInput) {
    pushUndoSnapshot();
  }
  state.indices[part] = wrapIndex(state.indices[part] + delta, count);
  if (fromHumanInput) {
    markInput();
  }
  redraw();
}

function randomizeAll(fromHumanInput = true) {
  const targets = PARTS.filter((part) => !state.partLocks[part]);
  if (targets.length === 0) {
    if (fromHumanInput) {
      flashStatus("ALL LOCKED", 700);
    }
    return;
  }
  if (fromHumanInput) {
    pushUndoSnapshot();
  }
  targets.forEach((part) => {
    randomizePartToDifferentValue(part);
  });

  if (fromHumanInput) {
    markInput();
  }

  redraw();
}

async function toggleFullscreen() {
  const root = document.documentElement;
  if (!document.fullscreenElement) {
    try {
      await root.requestFullscreen();
    } catch {
      setError("Fullscreen request was blocked by the browser.");
    }
  } else {
    try {
      await document.exitFullscreen();
    } catch {
      setError("Could not exit fullscreen.");
    }
  }
}

function buildSyncPayload() {
  const total = totalVariationsCount();
  const profile = computeGeneratedProfile();
  const uniqueness = computeUniquenessMetrics();
  return {
    at: Date.now(),
    seed: seedFromState(),
    name: profile.name,
    creatureIndex: creatureIndexFromState().toString(),
    poolMode: state.poolMode,
    indices: cloneIndices(),
    partIds: {
      head: partIdFromSelection("head"),
      torso: partIdFromSelection("torso"),
      legs: partIdFromSelection("legs"),
      feet: partIdFromSelection("feet"),
    },
    setNumber: state.currentSetNumber,
    setId: state.currentSetId,
    repeatCount: uniqueness.repeatCount,
    rarity: uniqueness.rarity,
    distance: uniqueness.distance,
    generation: uniqueness.generation,
    humanScore: profile.humanScore,
    coherence: profile.coherence,
    mutation: profile.mutation,
    sync: profile.sync,
    corrHT: profile.corrHT,
    corrLF: profile.corrLF,
    corrUL: profile.corrUL,
    partRarity: uniqueness.partRarity,
    seen: state.seen.size,
    total: total.toString(),
    exploredPercent: (exploredPercent(total) * 100).toFixed(4),
  };
}

function emitSyncSnapshot() {
  const payload = buildSyncPayload();
  try {
    localStorage.setItem(SYNC_LAST_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage limits/errors in rendering path.
  }
  if (syncChannel) {
    syncChannel.postMessage({ type: "snapshot", payload });
  }
}

function readGalleryEntries() {
  try {
    const raw = localStorage.getItem(GALLERY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArrayStorageWithTrim(key, entries, options = {}) {
  const preferRecent = options.preferRecent !== false;
  const minKeep = Math.max(1, Number(options.minKeep) || 20);
  const trimFactor = clamp(Number(options.trimFactor) || 0.75, 0.4, 0.95);
  const source = Array.isArray(entries) ? entries : [];
  let candidate = source.slice();
  let trimmed = false;

  while (candidate.length >= minKeep) {
    try {
      localStorage.setItem(key, JSON.stringify(candidate));
      return { ok: true, stored: candidate.length, trimmed };
    } catch {
      trimmed = true;
      const nextLen = Math.max(minKeep, Math.floor(candidate.length * trimFactor));
      if (nextLen >= candidate.length) {
        break;
      }
      candidate = preferRecent ? candidate.slice(candidate.length - nextLen) : candidate.slice(0, nextLen);
    }
  }

  try {
    const fallback = preferRecent ? source.slice(-minKeep) : source.slice(0, minKeep);
    localStorage.setItem(key, JSON.stringify(fallback));
    return { ok: true, stored: fallback.length, trimmed: true };
  } catch {
    return { ok: false, stored: 0, trimmed: true };
  }
}

function writeGalleryEntries(entries) {
  const primary = writeArrayStorageWithTrim(GALLERY_STORAGE_KEY, entries, {
    preferRecent: false,
    minKeep: 10,
    trimFactor: 0.72,
  });
  if (primary.ok) {
    return primary;
  }

  // Last-resort: persist metadata without thumbnails.
  const stripped = (Array.isArray(entries) ? entries : []).map((entry) => {
    const next = { ...entry };
    next.image = "";
    return next;
  });
  const fallback = writeArrayStorageWithTrim(GALLERY_STORAGE_KEY, stripped, {
    preferRecent: false,
    minKeep: 10,
    trimFactor: 0.72,
  });
  if (!fallback.ok) {
    setError("Gallery storage is full. Clear gallery or export DATA.");
  }
  return fallback;
}

function readSubmissionEntries() {
  try {
    const raw = localStorage.getItem(SUBMISSION_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSubmissionEntries(entries) {
  const result = writeArrayStorageWithTrim(SUBMISSION_LOG_KEY, entries, {
    preferRecent: false,
    minKeep: 30,
    trimFactor: 0.72,
  });
  if (!result.ok) {
    setError("Submission log storage is full.");
  }
  return result;
}

function readVariationLogEntries() {
  try {
    const raw = localStorage.getItem(VARIATION_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeVariationLogEntries(entries) {
  const result = writeArrayStorageWithTrim(VARIATION_LOG_KEY, entries, {
    preferRecent: true,
    minKeep: 120,
    trimFactor: 0.7,
  });
  if (!result.ok) {
    setError("Variation log storage is full. Export DATA and refresh.");
  }
  return result;
}

function appendVariationLogEntry(signature) {
  const total = totalVariationsCount();
  const profile = computeGeneratedProfile();
  const uniqueness = computeUniquenessMetrics();
  const entry = {
    at: new Date().toISOString(),
    poolMode: state.poolMode || "unknown",
    seed: seedFromState(),
    signature,
    creatureNumber: creatureIndexFromState().toString(),
    name: profile.name,
    ids: {
      head: partIdFromSelection("head"),
      torso: partIdFromSelection("torso"),
      legs: partIdFromSelection("legs"),
      feet: partIdFromSelection("feet"),
    },
    repeatFactor: uniqueness.repeatCount,
    rarity: uniqueness.rarity,
    distance: uniqueness.distance,
    generation: uniqueness.generation,
    set: uniqueness.setLabel,
    seenUnique: state.seen.size,
    totalVariations: total.toString(),
    exploredPercent: Number((exploredPercent(total) * 100).toFixed(4)),
  };

  const next = [...readVariationLogEntries(), entry];
  if (next.length > VARIATION_LIMIT) {
    next.splice(0, next.length - VARIATION_LIMIT);
  }
  writeVariationLogEntries(next);
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

function buildVariationLogCsv(entries) {
  const headers = [
    "at",
    "poolMode",
    "seed",
    "signature",
    "creatureNumber",
    "name",
    "headId",
    "torsoId",
    "legsId",
    "feetId",
    "repeatFactor",
    "rarity",
    "distance",
    "generation",
    "set",
    "seenUnique",
    "totalVariations",
    "exploredPercent",
  ];

  const lines = [headers.join(",")];
  entries.forEach((entry) => {
    const row = [
      entry.at,
      entry.poolMode,
      entry.seed,
      entry.signature,
      entry.creatureNumber,
      entry.name,
      entry.ids?.head,
      entry.ids?.torso,
      entry.ids?.legs,
      entry.ids?.feet,
      entry.repeatFactor,
      entry.rarity,
      entry.distance,
      entry.generation,
      entry.set,
      entry.seenUnique,
      entry.totalVariations,
      entry.exploredPercent,
    ].map(csvEscape);
    lines.push(row.join(","));
  });

  return `${lines.join("\n")}\n`;
}

function createGalleryThumbDataUrl() {
  const thumbSize = 192;
  const thumb = document.createElement("canvas");
  thumb.width = thumbSize;
  thumb.height = thumbSize;
  const tx = thumb.getContext("2d");
  tx.fillStyle = "#fff";
  tx.fillRect(0, 0, thumbSize, thumbSize);
  tx.drawImage(canvas, 0, 0, thumbSize, thumbSize);
  return thumb.toDataURL("image/jpeg", 0.62);
}

function appendSubmissionEntry(entry) {
  const next = [entry, ...readSubmissionEntries()].slice(0, SUBMISSION_LIMIT);
  const result = writeSubmissionEntries(next);
  if (syncChannel) {
    syncChannel.postMessage({ type: "submit-log", payload: entry });
  }
  return result;
}

function appendGalleryEntry(filename) {
  const baseEntry = {
    id: `${Date.now()}-${seedFromState()}`,
    at: Date.now(),
    filename,
    seed: seedFromState(),
    name: creatureNameEl ? creatureNameEl.textContent : "CREATURE",
    creatureNumber: creatureIndexFromState().toString(),
    setNumber: state.currentSetNumber,
    setId: state.currentSetId,
    poolMode: state.poolMode,
  };
  const submissionResult = appendSubmissionEntry(baseEntry);

  let image = "";
  try {
    image = createGalleryThumbDataUrl();
  } catch {
    image = "";
  }

  const galleryEntry = { ...baseEntry, image };
  const next = [galleryEntry, ...readGalleryEntries()].slice(0, GALLERY_LIMIT);
  const galleryResult = writeGalleryEntries(next);

  if (syncChannel) {
    syncChannel.postMessage({ type: "submit", payload: galleryEntry });
  }

  return {
    submissionLogged: Boolean(submissionResult?.ok),
    galleryLogged: Boolean(galleryResult?.ok),
  };
}

function safeNameToken(input) {
  return String(input || "creature")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "creature";
}

function submitTimestamp() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}${mo}${da}-${h}${mi}${s}`;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportVariationData() {
  const entries = readVariationLogEntries();
  if (entries.length === 0) {
    flashStatus("NO DATA", 700);
    return;
  }

  const csv = buildVariationLogCsv(entries);
  const filename = `variation-log-${submitTimestamp()}.csv`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  triggerBlobDownload(blob, filename);
  flashStatus("DATA EXPORTED", 900);
}

function submitCreature() {
  const rawName = creatureNameEl ? creatureNameEl.textContent : "creature";
  const filename = `${safeNameToken(rawName)}-${seedFromState().toLowerCase()}-${submitTimestamp()}.png`;
  const submitLog = appendGalleryEntry(filename);
  emitSyncSnapshot();

  if (submitLog.submissionLogged || submitLog.galleryLogged) {
    flashStatus("SUBMITTED", 900);
  } else {
    setError("Submit could not be saved. Storage is full.");
    flashStatus("SUBMIT FAILED", 950);
  }

  const reportCaptureFailure = () => {
    if (submitLog.submissionLogged || submitLog.galleryLogged) {
      setError("Entry saved, but image download failed.");
    } else {
      setError("Submit failed while capturing image.");
    }
  };

  try {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => {
        if (!blob) {
          reportCaptureFailure();
          return;
        }
        triggerBlobDownload(blob, filename);
        if (submitLog.submissionLogged || submitLog.galleryLogged) {
          clearError();
        }
      }, "image/png");
      return;
    }

    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (submitLog.submissionLogged || submitLog.galleryLogged) {
      clearError();
    }
  } catch {
    reportCaptureFailure();
  }
}

function attachUI() {
  document.querySelectorAll("button.side-arrow").forEach((btn) => {
    btn.addEventListener("click", () => {
      const part = btn.dataset.part;
      const action = btn.dataset.action;
      shiftPart(part, action === "inc" ? 1 : -1, true);
    });
  });

  if (goBackBtn) {
    goBackBtn.addEventListener("click", () => {
      goBackAction(true);
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      markInput();
      submitCreature();
    });
  }

  if (exportDataBtn) {
    exportDataBtn.addEventListener("click", () => {
      markInput();
      exportVariationData();
    });
  }

  if (setAnchorBtn) {
    setAnchorBtn.addEventListener("click", () => {
      setAnchor(true);
    });
  }

  if (mutateUnlockedBtn) {
    mutateUnlockedBtn.addEventListener("click", () => {
      mutateUnlocked(true);
    });
  }

  if (undoBtn) {
    undoBtn.addEventListener("click", () => {
      undoAction(true);
    });
  }

  if (redoBtn) {
    redoBtn.addEventListener("click", () => {
      redoAction(true);
    });
  }

  lockButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const part = btn.dataset.lockPart;
      togglePartLock(part, true);
    });
  });

  window.addEventListener("keydown", (evt) => {
    const key = evt.key.toLowerCase();

    if (KEYMAP[key]) {
      evt.preventDefault();
      const [part, delta] = KEYMAP[key];
      shiftPart(part, delta, true);
      return;
    }

    if (key === "r") {
      evt.preventDefault();
      randomizeAll(true);
      return;
    }

    if (key === "m") {
      evt.preventDefault();
      mutateUnlocked(true);
      return;
    }

    if (key === "g") {
      evt.preventDefault();
      setAnchor(true);
      return;
    }

    if (key === "u") {
      evt.preventDefault();
      undoAction(true);
      return;
    }

    if (key === "y") {
      evt.preventDefault();
      redoAction(true);
      return;
    }

    if (key === "1") {
      evt.preventDefault();
      togglePartLock("head", true);
      return;
    }

    if (key === "2") {
      evt.preventDefault();
      togglePartLock("torso", true);
      return;
    }

    if (key === "3") {
      evt.preventDefault();
      togglePartLock("legs", true);
      return;
    }

    if (key === "4") {
      evt.preventDefault();
      togglePartLock("feet", true);
      return;
    }

    if (key === "f") {
      evt.preventDefault();
      markInput();
      toggleFullscreen();
      return;
    }

    if (key === "c") {
      evt.preventDefault();
      markInput();
      submitCreature();
      return;
    }

    if (key === "v") {
      evt.preventDefault();
      markInput();
      exportVariationData();
      return;
    }

    if (key === "b") {
      evt.preventDefault();
      goBackAction(true);
    }
  });

  ["mousemove", "mousedown", "touchstart"].forEach((ev) => {
    window.addEventListener(ev, () => {
      markInput();
    });
  });

  window.addEventListener("resize", () => {
    redraw();
  });

  updateLockButtons();
  updateHistoryButtons();
}

function setPool(mode) {
  state.poolMode = mode;

  PARTS.forEach((part) => {
    const source = state.poolFiles[mode]?.[part] || state.poolFiles.large[part] || [];
    state.files[part] = source.slice();
    state.indices[part] = wrapIndex(state.indices[part], state.files[part].length);
  });

  state.basePath = state.poolSources[mode] || state.poolSources.large;
  clearAssetCaches();
  state.seen.clear();
  state.seenCounts.clear();
  PARTS.forEach((part) => {
    state.partPickCounts[part].clear();
  });
  state.generationCount = 0;
  state.lastCommittedSignature = null;
  state.lastCommittedIndices = null;
  state.lastDistancePercent = 0;
  state.partLocks = { head: false, torso: false, legs: false, feet: false };
  state.cohesiveSets = [];
  state.cohesiveSetCursor = -1;
  state.currentSetNumber = null;
  state.currentSetId = null;
  state.anchorIndices = null;
  state.historyUndo = [];
  state.historyRedo = [];
  buildCohesiveSetsFromCurrentPool();
  updateLockButtons();
  updateHistoryButtons();
}

function preparePools(largeManifest, smallManifest) {
  state.manifests.large = largeManifest;
  state.manifests.small = smallManifest || largeManifest;

  const largeCorrelated = buildCorrelatedPool(state.manifests.large);
  const smallCorrelated = buildCorrelatedPool(state.manifests.small, SMALL_POOL_LIMIT);
  const largeFallback = extractFilesFromManifest(state.manifests.large);
  const smallFallbackRaw = extractFilesFromManifest(state.manifests.small);

  PARTS.forEach((part) => {
    const fallbackSmall = smallFallbackRaw[part].slice(0, Math.min(SMALL_POOL_LIMIT, smallFallbackRaw[part].length));
    const smartFiles = largeCorrelated.complete ? largeCorrelated.files[part] : largeFallback[part];
    const curatedFiles = smallCorrelated.complete ? smallCorrelated.files[part] : fallbackSmall;

    state.poolFiles.large[part] = [
      ...smartFiles.map((file) => makePoolEntry(file, SOURCE_TAG.smart)),
      ...curatedFiles.map((file) => makePoolEntry(file, SOURCE_TAG.curated)),
    ];
    state.poolFiles.small[part] = curatedFiles.map((file) => makePoolEntry(file, SOURCE_TAG.curated));
    state.files[part] = [];
  });

  state.poolSources.large = state.manifests.large?.source || "../PARTS_SMART_LATEST";
  state.poolSources.small = state.manifests.small?.source || "../CURATED PARTS";
}

function openPoolGate() {
  poolGateEl.classList.remove("hidden");
  statusEl.textContent = "SELECT POOL";
}

function closePoolGate() {
  poolGateEl.classList.add("hidden");
}

async function startPool(mode) {
  setPool(mode);
  closePoolGate();

  if (!uiAttached) {
    attachUI();
    uiAttached = true;
  }

  await redraw();
  clearError();
  statusEl.textContent = "READY";
  resetIdleTimers();
}

function wirePoolButtons() {
  poolLargeBtn.addEventListener("click", () => {
    startPool("large");
  });
  poolSmallBtn.addEventListener("click", () => {
    startPool("small");
  });
}

async function init() {
  statusEl.textContent = "LOADING";

  try {
    const [configRes, manifestRes, oldManifestRes] = await Promise.all([
      fetch("./config.json", { cache: "no-store" }),
      fetch("./manifest.json", { cache: "no-store" }),
      fetch("./versions/manifest_old_curated.json", { cache: "no-store" }),
    ]);

    if (!configRes.ok) {
      throw new Error(`Config fetch failed: ${configRes.status}`);
    }
    if (!manifestRes.ok) {
      throw new Error(`Manifest fetch failed: ${manifestRes.status}`);
    }

    state.config = await configRes.json();
    const manifest = await manifestRes.json();
    const oldManifest = oldManifestRes.ok ? await oldManifestRes.json() : null;

    if (!state.config.canvas) {
      throw new Error("Invalid config.json");
    }

    preparePools(manifest, oldManifest);

    canvas.width = state.config.canvas;
    canvas.height = state.config.canvas;

    wirePoolButtons();
    openPoolGate();
  } catch (err) {
    statusEl.textContent = "ERROR";
    setError(`Startup failed: ${err.message}`);
  }
}

init();
