const SYNC_CHANNEL_NAME = "creature-sync-v1";
const SYNC_LAST_KEY = "creature-sync-last-v1";
const SUBMISSION_LOG_KEY = "creature-submissions-v1";
const MAX_SUBMIT_ROWS = 8;
const MAX_PHASE_POINTS = 140;

const refs = {
  time: document.getElementById("monitor-time"),
  name: document.getElementById("m-name"),
  seed: document.getElementById("m-seed"),
  gen: document.getElementById("m-gen"),
  rarity: document.getElementById("m-rarity"),
  distance: document.getElementById("m-distance"),
  repeat: document.getElementById("m-repeat"),
  heatH: document.getElementById("m-heat-h"),
  heatT: document.getElementById("m-heat-t"),
  heatL: document.getElementById("m-heat-l"),
  heatF: document.getElementById("m-heat-f"),
  space: document.getElementById("m-space"),
  explored: document.getElementById("m-explored"),
  alert: document.getElementById("m-alert"),
  humanConcept: document.getElementById("m-human-concept"),
  aiPressure: document.getElementById("m-ai-pressure"),
  tension: document.getElementById("m-tension"),
  conceptTag: document.getElementById("m-concept-tag"),
  classTag: document.getElementById("m-class-tag"),
  corrHTBar: document.getElementById("m-corr-ht"),
  corrLFBar: document.getElementById("m-corr-lf"),
  corrULBar: document.getElementById("m-corr-ul"),
  corrHTVal: document.getElementById("m-corr-ht-val"),
  corrLFVal: document.getElementById("m-corr-lf-val"),
  corrULVal: document.getElementById("m-corr-ul-val"),
  phaseCanvas: document.getElementById("m-phase-canvas"),
  submitCount: document.getElementById("m-submit-count"),
  submitList: document.getElementById("m-submit-list"),
};

const state = {
  phaseTrail: [],
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function nowClock() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function toPct(value) {
  return `${Math.round(Number(value) || 0)}%`;
}

function formatShortTime(ts) {
  const d = new Date(ts || Date.now());
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function loadJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadLastSnapshot() {
  return loadJson(SYNC_LAST_KEY);
}

function loadSubmissionEntries() {
  const parsed = loadJson(SUBMISSION_LOG_KEY);
  return Array.isArray(parsed) ? parsed : [];
}

function computeConceptModel(payload) {
  const corrHT = clamp(Number(payload?.corrHT ?? 0.5), 0, 1);
  const corrLF = clamp(Number(payload?.corrLF ?? 0.5), 0, 1);
  const corrUL = clamp(Number(payload?.corrUL ?? 0.5), 0, 1);
  const corrMean = (corrHT + corrLF + corrUL) / 3;

  const coherence = clamp(Number(payload?.coherence ?? (40 + corrMean * 45)), 0, 100);
  const mutation = clamp(Number(payload?.mutation ?? payload?.rarity ?? 50), 0, 100);
  const sync = clamp(Number(payload?.sync ?? (35 + corrMean * 55)), 0, 100);
  const humanScore = clamp(Number(payload?.humanScore ?? (coherence * 0.5 + sync * 0.3 + (100 - mutation) * 0.2)), 0, 100);

  const rarity = clamp(Number(payload?.rarity ?? 0), 0, 100);
  const distance = clamp(Number(payload?.distance ?? 0), 0, 100);
  const repeat = clamp(Number(payload?.repeatCount ?? 0), 0, 100);

  const humanConcept = clamp(
    Math.round(humanScore * 0.56 + coherence * 0.22 + sync * 0.16 + corrMean * 8),
    0,
    100,
  );
  const aiPressure = clamp(
    Math.round(rarity * 0.34 + mutation * 0.3 + distance * 0.24 + clamp(repeat - 1, 0, 12) * 4 + (1 - corrMean) * 16),
    0,
    100,
  );
  const tension = clamp(Math.round(Math.abs(humanConcept - aiPressure) * 0.86 + (100 - sync) * 0.14), 0, 100);

  let concept;
  let cls;
  if (humanConcept >= 72 && aiPressure <= 45) {
    concept = "FIGURATIVE MEMORY";
    cls = "HUMAN-LED";
  } else if (aiPressure >= 72 && humanConcept <= 45) {
    concept = "ALIEN ABSTRACTION";
    cls = "AI-LED";
  } else if (humanConcept >= 62 && aiPressure >= 62) {
    concept = "CYBORG MYTHOLOGY";
    cls = "CONTESTED";
  } else if (tension >= 65) {
    concept = "UNIQUENESS FRICTION";
    cls = "UNSTABLE";
  } else {
    concept = "HYBRID DRIFT";
    cls = "MIXED";
  }

  return {
    humanConcept,
    aiPressure,
    tension,
    concept,
    cls,
    corrHT,
    corrLF,
    corrUL,
  };
}

function ensureCanvasResolution(canvas) {
  if (!canvas) {
    return null;
  }
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const w = Math.max(320, Math.floor(canvas.clientWidth));
  const h = Math.max(120, Math.floor(canvas.clientHeight));
  const dw = Math.floor(w * dpr);
  const dh = Math.floor(h * dpr);
  if (canvas.width !== dw || canvas.height !== dh) {
    canvas.width = dw;
    canvas.height = dh;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawPhasePlot() {
  const setup = ensureCanvasResolution(refs.phaseCanvas);
  if (!setup) {
    return;
  }

  const { ctx, w, h } = setup;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const pad = { l: 28, r: 12, t: 10, b: 22 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;

  ctx.strokeStyle = "#ececec";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const x = pad.l + (pw * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + ph);
    ctx.stroke();

    const y = pad.t + (ph * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + pw, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#d0d0d0";
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t + ph);
  ctx.lineTo(pad.l + pw, pad.t + ph);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + ph);
  ctx.stroke();

  if (state.phaseTrail.length > 1) {
    ctx.beginPath();
    state.phaseTrail.forEach((point, idx) => {
      const x = pad.l + (point.human / 100) * pw;
      const y = pad.t + (1 - point.ai / 100) * ph;
      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = "rgba(248,0,0,0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();

    for (let i = 0; i < state.phaseTrail.length; i += 1) {
      const p = state.phaseTrail[i];
      const x = pad.l + (p.human / 100) * pw;
      const y = pad.t + (1 - p.ai / 100) * ph;
      const alpha = 0.1 + (i / state.phaseTrail.length) * 0.55;
      ctx.fillStyle = `rgba(248,0,0,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, i === state.phaseTrail.length - 1 ? 4.3 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = "#777";
  ctx.font = '11px "Courier New", Courier, monospace';
  ctx.fillText("HUMAN CONCEPT →", pad.l + 4, h - 7);
  ctx.save();
  ctx.translate(11, pad.t + ph - 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("AI PRESSURE →", 0, 0);
  ctx.restore();
}

function renderSnapshot(payload) {
  if (!payload) {
    return;
  }

  const model = computeConceptModel(payload);

  refs.name.textContent = payload.name || "NO SIGNAL";
  refs.seed.textContent = `SEED ${payload.seed || "--------"}`;
  refs.gen.textContent = String(payload.generation || 0);
  refs.rarity.textContent = toPct(payload.rarity);
  refs.distance.textContent = toPct(payload.distance);
  refs.repeat.textContent = `${payload.repeatCount || 0}x`;
  refs.heatH.style.width = `${payload.partRarity?.head || 0}%`;
  refs.heatT.style.width = `${payload.partRarity?.torso || 0}%`;
  refs.heatL.style.width = `${payload.partRarity?.legs || 0}%`;
  refs.heatF.style.width = `${payload.partRarity?.feet || 0}%`;
  refs.space.textContent = `SPACE ${payload.seen || 0} / ${payload.total || 0}`;
  refs.explored.textContent = `${payload.exploredPercent || "0.0000"}%`;

  refs.humanConcept.textContent = `${model.humanConcept}%`;
  refs.aiPressure.textContent = `${model.aiPressure}%`;
  refs.tension.textContent = `${model.tension}%`;
  refs.conceptTag.textContent = `CONCEPT: ${model.concept}`;
  refs.classTag.textContent = `CLASS: ${model.cls} • CREATURE ${payload.creatureIndex || "--"}`;

  refs.corrHTBar.style.width = `${Math.round(model.corrHT * 100)}%`;
  refs.corrLFBar.style.width = `${Math.round(model.corrLF * 100)}%`;
  refs.corrULBar.style.width = `${Math.round(model.corrUL * 100)}%`;
  refs.corrHTVal.textContent = model.corrHT.toFixed(2);
  refs.corrLFVal.textContent = model.corrLF.toFixed(2);
  refs.corrULVal.textContent = model.corrUL.toFixed(2);

  state.phaseTrail.push({ human: model.humanConcept, ai: model.aiPressure, tension: model.tension, at: Date.now() });
  if (state.phaseTrail.length > MAX_PHASE_POINTS) {
    state.phaseTrail.splice(0, state.phaseTrail.length - MAX_PHASE_POINTS);
  }
  drawPhasePlot();

  const repeated = (payload.repeatCount || 0) > 1;
  refs.alert.classList.toggle("hidden", !repeated);
  refs.alert.textContent = `REPEAT ALERT x${payload.repeatCount || 0}`;
}

function submitRowHtml(entry) {
  const name = String(entry?.name || "CREATURE").toUpperCase();
  const seed = String(entry?.seed || "--------");
  const time = formatShortTime(entry?.at);
  return `<div class="submit-row"><span class="submit-time">${time}</span><span class="submit-name">${name}</span><span class="submit-seed">${seed}</span></div>`;
}

function renderSubmissionFeed(entries) {
  const list = Array.isArray(entries) ? entries : [];
  refs.submitCount.textContent = String(list.length);
  const rows = list.slice(0, MAX_SUBMIT_ROWS).map(submitRowHtml).join("");
  refs.submitList.innerHTML = rows || '<div class="submit-row"><span class="submit-time">--:--:--</span><span class="submit-name">NO SUBMISSIONS YET</span><span class="submit-seed">--------</span></div>';
}

function refreshSubmissionFeed() {
  renderSubmissionFeed(loadSubmissionEntries());
}

const chan = "BroadcastChannel" in window ? new BroadcastChannel(SYNC_CHANNEL_NAME) : null;
if (chan) {
  chan.onmessage = (evt) => {
    const type = evt?.data?.type;
    const payload = evt?.data?.payload;
    if (type === "snapshot" && payload) {
      renderSnapshot(payload);
      return;
    }
    if ((type === "submit" || type === "submit-log") && payload) {
      refreshSubmissionFeed();
    }
  };
}

setInterval(() => {
  refs.time.textContent = nowClock();
}, 500);

setInterval(() => {
  drawPhasePlot();
}, 1500);

setInterval(() => {
  refreshSubmissionFeed();
}, 3000);

window.addEventListener("resize", () => {
  drawPhasePlot();
});

window.addEventListener("storage", (evt) => {
  if (evt.key === SYNC_LAST_KEY && evt.newValue) {
    try {
      renderSnapshot(JSON.parse(evt.newValue));
    } catch {
      // ignore
    }
    return;
  }

  if (evt.key === SUBMISSION_LOG_KEY) {
    refreshSubmissionFeed();
  }
});

refs.time.textContent = nowClock();
renderSnapshot(loadLastSnapshot());
refreshSubmissionFeed();
