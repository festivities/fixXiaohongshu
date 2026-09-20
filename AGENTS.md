# AGENTS.md — fixXiaohongshu

Fix Xiaohongshu (XHS) link preview embeds on Discord. Cloudflare Workers
(TypeScript + Hono). Users swap `xhslink.com` → `xhslink.festivity.moe` in an
XHS app share link; Discordbot gets og-tag embed HTML, humans get redirected
to XHS.

Live: `https://xhslink.festivity.moe` and `https://xhslink.festivity.workers.dev`
(both serve; `workers_dev = true` in wrangler.toml is intentional — removing it
silently kills the workers.dev host).

## Commands

```
npm run typecheck   # tsc --noEmit — must be clean before any commit
npm test            # vitest run — must pass (22 tests, no network)
npm run dev         # wrangler dev --remote --port 8787 — MUST be --remote (see Anti-bot)
npm run deploy      # wrangler deploy --minify (both hosts)
```

Run typecheck + tests after every change. Never commit with either failing.

## Architecture

```
src/index.ts   Hono routes, Discordbot UA gate, /dl streaming, error HTML
src/xhs.ts     resolveShortlink → fetchNote → parseState → extractPost, types
src/embed.ts   createEmbed og-tag HTML, desc cleanup, stats line, errorHtml
test/          vitest, pure functions only, real sanitized fixtures (video + image)
```

### Routes

- `GET /o/:id`, `GET /a/:id` — main flow. UA containing `Discordbot` (or
  localhost origin) → embed HTML; anything else → 302 to
  `http://xhslink.com/{kind}/{id}`.
- `GET /explore/:noteId?xsec_token=...&xsec_source=...` — same embed flow but
  skips shortlink resolution, builds the note URL directly from the incoming
  query. `xsec_token` required (error embed if missing). Humans → 302 to the
  xiaohongshu.com URL.
- `GET /dl/:id` — re-resolves a **fresh** signed CDN mp4 and **streams the bytes
  back** (HTTP 200, Range/206 passthrough). `:id` is a kind-prefixed share id
  (`o%2F...` / `a%2F...` — Hono URL-decodes params, so `id.includes("/")`
  distinguishes prefixed from legacy bare ids, defaulting bare to `o/`).
- `GET /health` → `OK`; `GET /favicon.ico` → 204; `GET /` → GitHub redirect.

### The share-id contract (do not break)

`handleShare` passes `` `${kind}/${id}` `` as `shareId` to `createEmbed`, which
emits `og:video = {origin}/dl/${encodeURIComponent(shareId)}`. `/o/` and `/a/`
ids are **not** a shared keyspace — `/a/{id}` and `/o/{id}` resolve to different
notes. Dropping the kind prefix silently breaks legacy `/a/` video embeds
(review found this as the one Major bug; there is a test locking it in).

## XHS domain knowledge (all live-verified; trust it, but re-verify if upstream changes)

### Anti-bot reality

XHS blocks non-browser clients on two layers:

1. **TLS/HTTP2 fingerprinting** — XHS (Tencent EdgeOne) fingerprints the TLS
   handshake. Plain curl/aiohttp/httpx is 302'd to a login wall even with valid
   browser cookies. Local workerd (`wrangler dev` without `--remote`) is also
   blocked. `curl_cffi` with `impersonate="chrome"` from a residential IP passes
   100% — that is the reference client for debugging.
2. **Egress IP reputation** — production Cloudflare Workers `fetch` with a
   Chrome UA passes *most of the time* but gets periodically flagged to a
   captcha wall (`302 → /website-login/captcha?...`), then recovers after
   ~an hour. Observed after heavy probe traffic; assume intermittency.
   Symptoms: error embeds saying "note page redirected to ...captcha...".

Consequence: when the service shows captcha-wall errors, it may be XHS flagging
CF egress, not a code bug. Verify with the reference client (curl_cffi,
residential IP) before debugging code. If flapping becomes chronic, the
fallback architecture is a Python fetch sidecar (fxBilibili-style, curl_cffi).
Full browser navigation headers (`XHS_HEADERS` in `src/xhs.ts`) are sent on
upstream fetches, but they do NOT lift an egress-IP flag — verified live:
flagged egress stays walled with full headers while residential IP passes
with curl's non-browser TLS. IP reputation dominates; headers only help at
the margin.

### Shortlink flow

- `http://xhslink.com/{o|a}/{id}` — **GET only** (HEAD → 404), `redirect:
  "manual"` → 302 `Location: https://www.xiaohongshu.com/discovery/item/
  {noteId}?...&xsec_token={...%3D}&...`. Keep the FULL query string. HEAD
  requests fail; always GET.
- Rewrite path `discovery/item` → `explore`, keep query. `xsec_token` is
  mandatory (without it: 302 to `/404/sec_...`).
- Tokens are per-share-link and eventually expire (hours-to-days scale). An
  expired token = login-wall 302 on the note page = error embed. This is
  expected; do not try to work around it without logged-in cookie support
  (deliberately not built).

### SSR state (`window.__INITIAL_STATE__`)

- Extract with `/<script>window\.__INITIAL_STATE__=(.+?)<\/script>/s` — the
  DOTALL flag is required.
- The payload is invalid JSON: it contains `undefined` value tokens. Repair
  with `raw.replace(/(:\s*)undefined(\W)/g, "$1null$2")` before `JSON.parse`;
  `jsonrepair` is the fallback (it also fixes array-position `undefined` the
  regex misses).
- Path: `state.note.firstNoteId` (plain string in SSR; browser-hydrated state
  wraps it in a Vue ref `{_value}` — extractPost defensively unwraps) →
  `state.note.noteDetailMap[firstNoteId].note`.
- Video streams live at `note.video.media.stream.{h264,h265,h266,av1}` in SSR.
  (Browser-hydrated state uses different keys `EF4/EF5/...` — irrelevant, we
  only parse SSR.) Prefer `h264`, fall back to first non-empty of
  h265/h266/av1, pick the max `width*height` entry.
- `imageList[].urlDefault` are `http://` — upgrade to https (only
  `*.xhscdn.com` hosts; see `upgradeScheme`). masterUrl/backupUrls likewise.
- Image posts (`type: "normal"`) have NO `video` key and often an empty
  `title` (fallback: first desc line, then `小红书笔记`).

### Video CDN

`sns-video*.xhscdn.com/stream/...mp4?sign=...` is open (no cookies/referer)
and fetchable from anywhere including Workers. Signs regenerate on every
note-page fetch and expire (~hour scale, `t=` param). That is why `/dl`
re-resolves instead of storing a URL.

## Discord behavior (live-verified)

- Discordbot UA: `Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)`
  — gate on the substring `Discordbot`, never exact-match.
- **Discord caches embeds per URL forever.** If a crawl fails, reposting the
  same URL shows the stale result. Bust with a junk query param
  (`?x=1`, `?x=2`, ...). Use this when verifying live.
- **`og:video` must NOT be a redirect.** Discord's video unfurler does not
  reliably follow 302s on og:video — embed silently fails. `/dl` streams
  bytes (200 + Range support) instead. Never revert to `c.redirect`.
- Error pages are served as **HTTP 200** with og tags — Discord only parses
  og tags on 2xx. (`errorHtml` exists for this.)

## Security invariants (review-verified; keep them true)

1. HTML-escape (html-entities `encode`) EVERY value interpolated into an
   attribute position — including URLs (quotes matter). Tests cover hostile
   title/desc.
2. `resolveShortlink` validates the Location host (`www.xiaohongshu.com`) and
   path prefix (`/discovery/item/` or `/explore/`) before use — the worker must
   never be turned into an open fetcher/redirector.
3. `/dl` asserts the video host ends with `.xhscdn.com` before fetching.
4. `upgradeScheme` only rewrites `http://*.xhscdn.com/` — regex anchored so it
   cannot cross `/`.
5. `:id` path params can contain `%2F`-encoded slashes (Hono decodes them);
   they flow into xhslink.com paths only, never arbitrary hosts.

## Tests

- vitest, **pure functions only, no network** — XHS blocks local workerd, so
  route-level E2E cannot run in CI. Fixtures (`test/fixtures/{video,image}.json`)
  are real sanitized `__INITIAL_STATE__` payloads (mediaV2/serverRequestInfo
  stripped).
- To refresh fixtures (needs a valid share link): resolve the shortlink with
  plain curl (xhslink.com has no anti-bot), then fetch the note page with
  `curl_cffi` `requests.Session(impersonate="chrome")` — that combination
  reliably passes. Extract the state script, strip `mediaV2`/`serverRequestInfo`,
  save.
- When adding extraction logic, add a synthetic-state test (see the h265
  fallback / max-resolution / no-masterUrl tests for the pattern).

## Live verification checklist

```
curl -s https://xhslink.festivity.moe/health                                      # OK
curl -s -A "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)" \
  "https://xhslink.festivity.moe/o/{id}"                                          # og-tag HTML
curl -s -A "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)" \
  -o NUL -w "%{http_code} %{content_type} %{size_download}B\n" \
  "https://xhslink.festivity.moe/dl/o%2F{id}"                                     # 200 video/mp4
curl -s -A "Mozilla/5.0" -o NUL -w "%{http_code} %{redirect_url}\n" \
  "https://xhslink.festivity.moe/o/{id}"                                          # 302 → xhslink.com
```

Upstream fetches make embed requests slow (1–4s) — use `--max-time 60`. The
final check is always a human posting a link (with a `?x=N` cache-buster) in
Discord.

## Code style

- No comments except `ponytail:`-prefixed notes marking real traps/ceilings.
- Boring TypeScript; `Context` from hono, no `any` in signatures (strict is on).
- Follow existing patterns in `src/`; reference projects: `fxBilibili` (embed
  layout, error HTML, UA gate) and `xiaohongshu-rednote-discord-embed` (the
  1-year-old ancestor; its state parsing is outdated — see SSR section).
- Commits: short imperative subject, no push unless asked.

## Known limitations (deliberate; upgrade paths noted)

- No caching — every embed hit re-fetches upstream. Upgrade: Workers Cache API
  on the note-page fetch (30–60 min TTL, keyed by note id).
- One `og:image` (Discord shows one thumbnail regardless).
- No login/cookie support — expired share tokens are unfixable server-side.
- Workers egress intermittency (see Anti-bot) — no mitigation built; if it
  becomes chronic, move note-page fetching to a curl_cffi sidecar.
