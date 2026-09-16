# fixXiaohongshu

Fixes Xiaohongshu (XHS / REDnote) link previews on Discord. Discord's crawler
(`Discordbot`) gets bounced to an XHS login wall, so shared posts embed with no
title, image, or video. This service re-serves proper `og:` embed HTML.

Swap the shortlink host in any XHS share link:

```
http://xhslink.com/o/1vgC2PZXLe9
→ https://xhslink.festivity.moe/o/1vgC2PZXLe9
```

There is also a passthrough form for full note URLs:

```
https://xhslink.festivity.moe/explore/{noteId}?xsec_token=...&xsec_source=...
```

Example of a working Discord embed:

![Discord embed of a Xiaohongshu video post](https://raw.githubusercontent.com/hareru/public/main/xiaohongshu/A.png)

Inspired by [fxBilibili](https://github.com/seriaati/fxBilibili) (embed layout,
error-HTML pattern) and
[xiaohongshu-rednote-discord-embed](https://github.com/TheFalloutOf76/xiaohongshu-rednote-discord-embed)
(shortlink-resolution flow).

## How it works

1. `GET /o/:id` (or `/a/:id`) fetches `http://xhslink.com/o/:id` with a Chrome
   UA and `redirect: manual`, taking the 302 `Location` to
   `www.xiaohongshu.com/discovery/item/{noteId}?...`.
2. The path is rewritten `discovery/item` → `explore` (query kept — the
   `xsec_token` param is mandatory) and fetched, again with a Chrome UA.
3. The SSR `window.__INITIAL_STATE__` payload is parsed (`undefined` tokens are
   repaired to `null`), the note extracted, and embed HTML with `og:` tags
   re-served to Discord.
4. Video posts get `og:video` pointing at `/dl/:id`, which re-resolves a fresh
   signed CDN URL and streams the bytes back (HTTP 200 with Range support —
   Discord's video unfurler does not reliably follow redirects, so no 302 is
   used). Humans (non-`Discordbot` UAs) are 302-redirected to the original XHS
   URL.

XHS only serves the SSR page to browser-TLS clients. Production Cloudflare
Workers `fetch` with a Chrome UA passes; local `wrangler dev` (workerd) does
not — so dev uses remote mode:

```
npm run dev   # wrangler dev --remote --port 8787
```

## Deploy

```
npm install
npx wrangler deploy
```

Custom domain (`xhslink.festivity.moe`) is configured via `routes` in
`wrangler.toml` and requires the `festivity.moe` zone in the account.

## Dev / test

```
npm run typecheck
npm test        # vitest, pure functions only, no network (real fixtures in test/fixtures/)
```

## Known limitations

- `xsec_token` eventually expires → old share links stop resolving (error embed
  is served instead of nothing).
- Only the first image is exposed as `og:image` (Discord shows one thumbnail
  for image posts; video posts embed the player).
- No caching yet — every embed hit re-fetches upstream. The upgrade path is
  the Workers Cache API on the note-page fetch.
