import { jsonrepair } from "jsonrepair";

export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// ponytail: full browser navigation headers — XHS risk-scores header
// completeness, UA alone gets challenged sooner; keep sec-ch-ua in sync with CHROME_UA
export const XHS_HEADERS: Record<string, string> = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "max-age=0",
  priority: "u=0, i",
  "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "user-agent": CHROME_UA,
};

export interface Post {
  noteId: string;
  type: string;
  title: string;
  desc: string;
  user: { nickname: string; avatar: string };
  interactInfo: { liked: string; comment: string; share: string; collected: string };
  images: string[];
  video?: { url: string; backupUrls: string[]; width: number; height: number; durationMs: number };
  ipLocation: string;
  time: number;
  tags: string[];
}

export function upgradeScheme(url: string): string {
  return url.replace(/^http:\/\/([^/]*\.(?:xhscdn|rednotecdn)\.com\/)/, "https://$1");
}

export async function resolveShortlink(path: string, useRednote = false): Promise<string> {
  const r = await fetch("http://xhslink.com/" + path, {
    headers: XHS_HEADERS,
    redirect: "manual",
  });
  const location = r.headers.get("location");
  if (r.status < 300 || r.status >= 400 || !location) {
    throw new Error(`shortlink returned no redirect (status ${r.status})`);
  }
  return rewriteNoteUrl(location, useRednote);
}

// ponytail: validates the shortlink target, then picks the fetch host —
// rednote.com keeps path+query untouched (cookie mode), xiaohongshu.com
// gets the discovery/item → explore rewrite. Only these two hosts ever result.
export function rewriteNoteUrl(location: string, useRednote: boolean): string {
  let u: URL;
  try {
    u = new URL(location);
  } catch {
    throw new Error(`unexpected redirect location: ${location}`);
  }
  if (u.host !== "www.xiaohongshu.com" || (!u.pathname.startsWith("/discovery/item/") && !u.pathname.startsWith("/explore/"))) {
    throw new Error(`unexpected redirect host/path: ${u.host}${u.pathname}`);
  }
  if (useRednote) {
    return `https://www.rednote.com${u.pathname}${u.search}`;
  }
  const rewritten = u.pathname.replace("/discovery/item/", "/explore/");
  return `https://www.xiaohongshu.com${rewritten}${u.search}`;
}

// ponytail: cookies ride in the XHS_COOKIES secret (wrangler secret put),
// never in code — a logged-in session passes walls the anonymous fetch cannot
export function buildNoteHeaders(cookie?: string): Record<string, string> {
  if (!cookie) return XHS_HEADERS;
  return { ...XHS_HEADERS, cookie, Referer: "https://www.rednote.com/" };
}

export async function fetchNote(noteUrl: string, cookie?: string): Promise<string> {
  const r = await fetch(noteUrl, {
    headers: buildNoteHeaders(cookie),
    redirect: "manual",
  });
  if (r.status >= 300 && r.status < 400) {
    const where = r.headers.get("location");
    throw new Error(
      `note page redirected to ${where}${cookie ? " (XHS_COOKIES may have expired — refresh the secret)" : " (token may be expired)"}`,
    );
  }
  if (!r.ok) {
    throw new Error(`note page fetch failed with status ${r.status}`);
  }
  return r.text();
}

export function parseState(html: string): any {
  const m = html.match(/<script>window\.__INITIAL_STATE__=(.+?)<\/script>/s);
  if (!m) throw new Error("Unable to find __INITIAL_STATE__ in page HTML");
  const raw = m[1];
  const fixed = raw.replace(/(:\s*)undefined(\W)/g, "$1null$2");
  try {
    return JSON.parse(fixed);
  } catch {
    return JSON.parse(jsonrepair(raw));
  }
}

function unwrapId(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "_value" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)._value);
  }
  throw new Error("Unable to determine firstNoteId");
}

export function extractPost(state: any): Post {
  const firstNoteId = unwrapId(state?.note?.firstNoteId);
  const note = state?.note?.noteDetailMap?.[firstNoteId]?.note;
  if (!note) throw new Error("note detail not found in page state");

  const images: string[] = (note.imageList ?? []).map((img: any) => upgradeScheme(String(img.urlDefault ?? ""))).filter(Boolean);

  let video: Post["video"];
  const stream = note.video?.media?.stream;
  if (stream && typeof stream === "object") {
    const keys = ["h264", "h265", "h266", "av1"];
    let entries: any[] = [];
    for (const k of keys) {
      if (Array.isArray(stream[k]) && stream[k].length > 0) {
        entries = stream[k];
        break;
      }
    }
    if (entries.length > 0) {
      const best = entries.reduce((a: any, b: any) => (Number(a.width) || 0) * (Number(a.height) || 0) >= (Number(b.width) || 0) * (Number(b.height) || 0) ? a : b);
      const url = upgradeScheme(String(best.masterUrl ?? ""));
      if (url) {
        video = {
          url,
          backupUrls: (best.backupUrls ?? []).map((u: unknown) => upgradeScheme(String(u))),
          width: Number(best.width) || 0,
          height: Number(best.height) || 0,
          durationMs: Number(best.duration) || 0,
        };
      }
    }
  }

  const ii = note.interactInfo ?? {};
  return {
    noteId: String(note.noteId ?? firstNoteId),
    type: String(note.type ?? "normal"),
    title: String(note.title ?? ""),
    desc: String(note.desc ?? ""),
    user: { nickname: String(note.user?.nickname ?? ""), avatar: String(note.user?.avatar ?? "") },
    interactInfo: {
      liked: String(ii.likedCount ?? "0"),
      comment: String(ii.commentCount ?? "0"),
      share: String(ii.shareCount ?? "0"),
      collected: String(ii.collectedCount ?? "0"),
    },
    images,
    video,
    ipLocation: String(note.ipLocation ?? ""),
    time: Number(note.time) || 0,
    tags: (note.tagList ?? []).map((t: any) => String(t.name ?? "")).filter(Boolean),
  };
}
