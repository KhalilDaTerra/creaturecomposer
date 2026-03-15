export async function onRequestGet(context) {
  if (!context.env?.SUBMISSIONS_IMAGES) {
    return new Response("Missing SUBMISSIONS_IMAGES binding.", { status: 503 });
  }

  const id = String(context.params?.id || "").trim();
  if (!id) {
    return new Response("Missing submission id.", { status: 400 });
  }

  const object = await context.env.SUBMISSIONS_IMAGES.get(`submissions/${id}.png`);
  if (!object) {
    return new Response("Submission image not found.", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(object.body, {
    status: 200,
    headers,
  });
}
