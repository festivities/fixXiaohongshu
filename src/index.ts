import { Hono, type Context } from "hono";
import { createEmbed, errorHtml } from "./embed";
import { extractPost, fetchNote, parseState, resolveShortlink, CHROME_UA } from "./xhs";

type AppEnv = { Bindings: { XHS_COOKIES?: string } };

const app = new Hono<AppEnv>();

function cookieOf(c: Context<AppEnv>): string | undefined {
  const v = c.env.XHS_COOKIES?.trim();
  return v ? v : undefined;
}

function isEmbedRequest(c: Context<AppEnv>): boolean {
  const ua = c.req.header("User-Agent") ?? c.req.header("user-agent") ?? "";
  if (ua.includes("Discordbot")) return true;
  try {
    const host = new URL(c.req.url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

async function embedFromNoteUrl(noteUrl: string, origin: string, currentPath: string, shareId?: string, cookie?: string) {
  const html = await fetchNote(noteUrl, cookie);
  const post = extractPost(parseState(html));
  return createEmbed(post, { origin, currentPath, shareId });
}

async function handleShare(c: Context<AppEnv>, kind: "o" | "a", id: string) {
  const url = new URL(c.req.url);
  const origin = url.origin;
  const currentPath = url.pathname + url.search;
  if (!isEmbedRequest(c)) {
    return c.redirect(`http://xhslink.com/${kind}/${id}`, 302);
  }
  try {
    const cookie = cookieOf(c);
    const noteUrl = await resolveShortlink(`${kind}/${id}`, Boolean(cookie));
    const html = await embedFromNoteUrl(noteUrl, origin, currentPath, `${kind}/${id}`, cookie);
    return c.html(html);
  } catch (e) {
    return c.html(errorHtml(e instanceof Error ? e.message : String(e)));
  }
}

app.get("/", (c) => c.redirect("https://github.com/festivities/fixXiaohongshu", 302));
app.get("/favicon.ico", (c) => c.body(null, 204));
app.get("/health", (c) => c.text("OK"));

app.get("/o/:id", (c) => handleShare(c, "o", c.req.param("id")));
app.get("/a/:id", (c) => handleShare(c, "a", c.req.param("id")));

app.get("/explore/:noteId", async (c) => {
  const url = new URL(c.req.url);
  const origin = url.origin;
  const currentPath = url.pathname + url.search;
  const noteId = c.req.param("noteId");
  const cookie = cookieOf(c);
  const host = cookie ? "www.rednote.com" : "www.xiaohongshu.com";
  if (!isEmbedRequest(c)) {
    return c.redirect(`https://${host}/explore/${noteId}${url.search}`, 302);
  }
  if (!url.searchParams.get("xsec_token")) {
    return c.html(errorHtml("missing xsec_token query param"));
  }
  try {
    const html = await embedFromNoteUrl(`https://${host}/explore/${noteId}${url.search}`, origin, currentPath, undefined, cookie);
    return c.html(html);
  } catch (e) {
    return c.html(errorHtml(e instanceof Error ? e.message : String(e)));
  }
});

app.get("/dl/:id", async (c) => {
  const id = c.req.param("id");
  try {
    // ponytail: /dl ids are shortlink share ids (o/a); /explore links have no share id so they embed the CDN url directly
    const cookie = cookieOf(c);
    const noteUrl = await resolveShortlink(id.includes("/") ? id : `o/${id}`, Boolean(cookie));
    const post = extractPost(parseState(await fetchNote(noteUrl, cookie)));
    if (!post.video?.url) throw new Error("no video found for this post");
    const host = new URL(post.video.url).host;
    if (!host.endsWith(".xhscdn.com")) throw new Error(`unexpected video host: ${host}`);
    // ponytail: stream bytes (200) rather than 302 — Discord's video unfurler does not reliably follow redirects on og:video
    const range = c.req.header("range");
    const up = await fetch(post.video.url, {
      headers: { "user-agent": CHROME_UA, ...(range ? { range } : {}) },
    });
    if (!up.ok || !up.body) throw new Error(`video fetch failed with status ${up.status}`);
    const headers = new Headers();
    headers.set("content-type", up.headers.get("content-type") ?? "video/mp4");
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      const v = up.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set("cache-control", "public, max-age=3600");
    return new Response(up.body, { status: up.status, headers });
  } catch (e) {
    return c.html(errorHtml(e instanceof Error ? e.message : String(e)));
  }
});

app.onError((e, c) => c.html(errorHtml(e.message)));

export default app;
