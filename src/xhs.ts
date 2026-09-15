import { jsonrepair } from "jsonrepair";

export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
  return url.replace(/^http:\/\/([^/]*\.xhscdn\.com\/)/, "https://$1");
}

export async function resolveShortlink(path: string): Promise<string> {
  const r = await fetch("http://xhslink.com/" + path, {
    headers: { "user-agent": CHROME_UA },
    redirect: "manual",
  });
  const location = r.headers.get("location");
  if (r.status < 300 || r.status >= 400 || !location) {
    throw new Error(`shortlink returned no redirect (status ${r.status})`);
  }
  let u: URL;
  try {
    u = new URL(location);
  } catch {
    throw new Error(`unexpected redirect location: ${location}`);
  }
  if (u.host !== "www.xiaohongshu.com" || (!u.pathname.startsWith("/discovery/item/") && !u.pathname.startsWith("/explore/"))) {
    throw new Error(`unexpected redirect host/path: ${u.host}${u.pathname}`);
  }
  const rewritten = u.pathname.replace("/discovery/item/", "/explore/");
  return `https://www.xiaohongshu.com${rewritten}${u.search}`;
}

export async function fetchNote(noteUrl: string): Promise<string> {
  const r = await fetch(noteUrl, {
    headers: { "user-agent": CHROME_UA },
    redirect: "manual",
  });
  if (r.status >= 300 && r.status < 400) {
    throw new Error(`note page redirected to ${r.headers.get("location")} (token may be expired)`);
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
      video = {
        url: upgradeScheme(String(best.masterUrl ?? "")),
        backupUrls: (best.backupUrls ?? []).map((u: unknown) => upgradeScheme(String(u))),
        width: Number(best.width) || 0,
        height: Number(best.height) || 0,
        durationMs: Number(best.duration) || 0,
      };
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
