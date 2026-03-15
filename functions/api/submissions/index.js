const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store",
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

function cleanText(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function parsePartIds(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function mapRow(row) {
  let data = {};
  try {
    data = JSON.parse(row?.data_json || "{}");
  } catch {
    data = {};
  }

  return {
    id: row.id,
    at: Number(row.submitted_at) || Date.now(),
    filename: row.filename,
    name: row.name,
    seed: row.seed,
    category: row.category,
    poolMode: row.pool_mode || "",
    creatureNumber: row.creature_number || "",
    setLabel: row.set_label || "--",
    imageUrl: `/api/submissions/${encodeURIComponent(row.id)}/image`,
    ...data,
  };
}

function ensureBindings(env) {
  if (!env?.SUBMISSIONS_DB) {
    return "Missing SUBMISSIONS_DB binding.";
  }
  if (!env?.SUBMISSIONS_IMAGES) {
    return "Missing SUBMISSIONS_IMAGES binding.";
  }
  return null;
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, POST, OPTIONS",
    },
  });
}

export async function onRequestGet(context) {
  const bindingError = ensureBindings(context.env);
  if (bindingError) {
    return json({ error: bindingError }, 503);
  }

  const url = new URL(context.request.url);
  const limit = Math.min(240, Math.max(1, safeInteger(url.searchParams.get("limit"), 120)));

  const totalRow = await context.env.SUBMISSIONS_DB
    .prepare("SELECT COUNT(*) AS count FROM submissions")
    .first();

  const rows = await context.env.SUBMISSIONS_DB
    .prepare(
      `SELECT
        id,
        filename,
        name,
        seed,
        category,
        pool_mode,
        creature_number,
        set_label,
        submitted_at,
        data_json
      FROM submissions
      ORDER BY submitted_at DESC
      LIMIT ?1`,
    )
    .bind(limit)
    .all();

  return json({
    submissions: (rows.results || []).map(mapRow),
    total: Number(totalRow?.count) || 0,
  });
}

export async function onRequestPost(context) {
  const bindingError = ensureBindings(context.env);
  if (bindingError) {
    return json({ error: bindingError }, 503);
  }

  const form = await context.request.formData();
  const image = form.get("image");

  if (!image || typeof image.arrayBuffer !== "function") {
    return json({ error: "Missing submission image." }, 400);
  }

  const submittedAt = Date.now();
  const id = crypto.randomUUID();
  const name = cleanText(form.get("name") || "CREATURE", 120) || "CREATURE";
  const filename = cleanText(form.get("filename") || `CreatureComposer-${name}.png`, 180) || `CreatureComposer-${id}.png`;
  const seed = cleanText(form.get("seed") || "--------", 40) || "--------";
  const category = cleanText(form.get("category") || "Hybrids", 60) || "Hybrids";
  const poolMode = cleanText(form.get("poolMode") || "", 40);
  const creatureNumber = cleanText(form.get("creatureNumber") || "", 40);
  const setLabel = cleanText(form.get("setLabel") || "--", 80) || "--";
  const data = {
    poolLabel: cleanText(form.get("poolLabel") || "", 40),
    setNumber: cleanText(form.get("setNumber") || "", 24),
    setId: cleanText(form.get("setId") || "", 80),
    partIds: parsePartIds(form.get("partIds")),
    rarity: safeInteger(form.get("rarity"), 0),
    distance: safeInteger(form.get("distance"), 0),
    generation: safeInteger(form.get("generation"), 0),
  };

  const imageKey = `submissions/${id}.png`;

  await context.env.SUBMISSIONS_IMAGES.put(imageKey, image, {
    httpMetadata: {
      contentType: image.type || "image/png",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  await context.env.SUBMISSIONS_DB
    .prepare(
      `INSERT INTO submissions (
        id,
        filename,
        image_key,
        name,
        seed,
        category,
        pool_mode,
        creature_number,
        set_label,
        submitted_at,
        data_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      id,
      filename,
      imageKey,
      name,
      seed,
      category,
      poolMode,
      creatureNumber,
      setLabel,
      submittedAt,
      JSON.stringify(data),
    )
    .run();

  return json(
    {
      submission: mapRow({
        id,
        filename,
        name,
        seed,
        category,
        pool_mode: poolMode,
        creature_number: creatureNumber,
        set_label: setLabel,
        submitted_at: submittedAt,
        data_json: JSON.stringify(data),
      }),
    },
    201,
  );
}
