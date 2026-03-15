# Creature MVP

## Run

From project root:

```bash
python3 -m http.server 8000
```

Then open:

[http://localhost:8000/web/](http://localhost:8000/web/)

## Primary Controls

- `Randomize`: randomizes unlocked parts only.
- `Original`: jumps to a cohesive original matched set (former Set behavior).
- `Back`: steps back to the previous state (disabled when no history).

## Live Submission Wall

The web app now supports live shared submissions through Cloudflare Pages Functions.

- Frontend save path: `web/app.js`
- Live gallery feed: `web/gallery.js`
- Cloudflare API routes: `functions/api/submissions`
- D1 schema: `cloudflare/submissions.sql`

Required Cloudflare bindings:

- `SUBMISSIONS_DB`: D1 database binding
- `SUBMISSIONS_IMAGES`: R2 bucket binding

The submit flow falls back to local storage if those bindings are not configured, so local/static previews still work.
