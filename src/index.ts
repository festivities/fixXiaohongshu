import { Hono } from "hono";
import { createEmbed, errorHtml } from "./embed";
import { extractPost, fetchNote, parseState, resolveShortlink } from "./xhs";

const app = new Hono();

function isEmbedRequest(c: any): boolean {
  const ua = c.req.header("User-Agent") ?? c.req.header("user-agent") ?? "";
  if (ua.includes("Discordbot")) return true;
  try {
    const host = new URL(c.req.url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

async function embedFromNoteUrl(noteUrl: string, origin: string, currentPath: string, shareId?: string) {
  const html = await fetchNote(noteUrl);
  const post = extractPost(parseState(html));
  return createEmbed(post, { origin, currentPath, shareId });
}

async function handleShare(c: any, kind: "o" | "a", id: string) {
  const url = new URL(c.req.url);
  const origin = url.origin;
  const currentPath = url.pathname + url.search;
  if (!isEmbedRequest(c)) {
    return c.redirect(`http://xhslink.com/${kind}/${id}`, 302);
  }
  try {
    const noteUrl = await resolveShortlink(`${kind}/${id}`);
    const html = await createEmbedFromNote(noteUrl, origin, currentPath, id);
    return c.html(html);
  } catch (e) {
    return c.html(errorHtml(e instanceof Error ? e.message : String(e)));
  }
}

async function createEmbedFromNote(noteUrl: string, origin: string, currentPath: string, shareId?: string) {
  return embedFromNoteUrl(noteUrl, origin, currentPath, shareId);
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
  if (!isEmbedRequest(c)) {
    return c.redirect(`https://www.xiaohongshu.com/explore/${noteId}${url.search}`, 302);
  }
  if (!url.searchParams.get("xsec_token")) {
    return c.html(errorHtml("missing xsec_token query param"));
  }
  try {
    const html = await embedFromNoteUrl(`https://www.xiaohongshu.com/explore/${noteId}${url.search}`, origin, currentPath);
    return c.html(html);
  } catch (e) {
    return c.html(errorHtml(e instanceof Error ? e.message : String(e)));
  }
});

app.get("/dl/:id", async (c) => {
  const id = c.req.param("id");
  try {
    // ponytail: /dl ids are shortlink share ids (o/a); /explore links have no share id so they embed the CDN url directly
    const noteUrl = await resolveShortlink(id.includes("/") ? id : `o/${id}`);
    const post = extractPost(parseState(await fetchNote(noteUrl)));
    if (!post.video?.url) throw new Error("no video found for this post");
    const host = new URL(post.video.url).host;
    if (!host.endsWith(".xhscdn.com")) throw new Error(`unexpected video host: ${host}`);
    return c.redirect(post.video.url, 302);
  } catch (e) {
    return c.html(errorHtml(e instanceof Error ? e.message : String(e)));
  }
});

app.onError((e, c) => c.html(errorHtml(e.message)));

export default app;
