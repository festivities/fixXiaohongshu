import { encode } from "html-entities";
import { cleanDesc, truncate } from "./embed";
import { accountUri, statusUri, MASTODON_USERNAME, type Post } from "./xhs";

interface MediaMeta {
  width: number;
  height: number;
  size: string;
  aspect: number;
  duration?: number;
}

export interface MediaAttachment {
  id: string;
  type: "video" | "image";
  url: string;
  preview_url: string | null;
  remote_url: null;
  preview_remote_url: null;
  text_url: null;
  description: null;
  meta: {
    original: MediaMeta;
    small: MediaMeta;
  };
}

interface MastodonAccount {
  id: string;
  username: string;
  acct: string;
  display_name: string;
  url: string;
  uri: string;
  created_at: string;
  locked: boolean;
  bot: boolean;
  discoverable: boolean;
  indexable: boolean;
  group: boolean;
  avatar: string;
  avatar_static: string;
  header: string;
  header_static: string;
  followers_count: number;
  following_count: number;
  statuses_count: number;
  hide_collections: boolean;
  noindex: boolean;
  emojis: unknown[];
  roles: unknown[];
  fields: unknown[];
  note: string;
  last_status_at: string;
}

export interface MastodonStatus {
  id: string;
  uri: string;
  url: string;
  created_at: string;
  edited_at: null;
  reblog: null;
  in_reply_to_id: null;
  in_reply_to_account_id: null;
  language: string;
  content: string;
  spoiler_text: string;
  visibility: "public";
  sensitive: boolean;
  application: { name: string; website: null };
  mentions: unknown[];
  tags: unknown[];
  emojis: unknown[];
  card: null;
  poll: null;
  account: MastodonAccount;
  media_attachments: MediaAttachment[];
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
  text: string;
}

const FALLBACK_AVATAR = "https://picasso-static.xiaohongshu.com/fe-platform/6c07fd8c66e75c05c3877ff4e7cb1c4f4f10024a.png";

function escapeAttr(s: string): string {
  return encode(s, { mode: "specialChars" }).replace(/'/g, "&#39;");
}

function videoAttachment(post: Post): MediaAttachment {
  const video = post.video!;
  const width = video.width || 720;
  const height = video.height || 1280;
  const smallWidth = 400;
  const smallHeight = Math.round((smallWidth * height) / width);
  const duration = video.durationMs ? video.durationMs / 1000 : undefined;
  return {
    id: `${post.noteId}_v0`,
    type: "video",
    url: video.url,
    preview_url: post.images[0] ?? null,
    remote_url: null,
    preview_remote_url: null,
    text_url: null,
    description: null,
    meta: {
      original: { width, height, size: `${width}x${height}`, aspect: width / height, duration },
      small: {
        width: smallWidth,
        height: smallHeight,
        size: `${smallWidth}x${smallHeight}`,
        aspect: width / height,
        duration,
      },
    },
  };
}

function imageAttachments(post: Post): MediaAttachment[] {
  return post.images.slice(0, 4).map((img, i) => ({
    id: `${post.noteId}_i${i}`,
    type: "image",
    url: img,
    preview_url: img,
    remote_url: null,
    preview_remote_url: null,
    text_url: null,
    description: null,
    meta: {
      original: { width: 1080, height: 1080, size: "1080x1080", aspect: 1.0 },
      small: { width: 400, height: 400, size: "400x400", aspect: 1.0 },
    },
  }));
}

// ponytail: an error must still look like a Mastodon status — Discord fetches
// this route expecting JSON, so a plain {error} blob would render nothing
export function buildFallbackStatus(noteId: string, workerUrl: string, message: string): MastodonStatus {
  const username = MASTODON_USERNAME;
  const selfUri = statusUri(workerUrl, noteId);
  const noteUrl = `https://www.xiaohongshu.com/explore/${noteId}`;
  const created = new Date().toISOString().replace(/\.\d+Z$/, ".000Z");

  return {
    id: noteId,
    uri: selfUri,
    url: noteUrl,
    created_at: created,
    edited_at: null,
    reblog: null,
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    language: "en",
    content: `<p>${encode(message)}</p>`,
    spoiler_text: "",
    visibility: "public",
    sensitive: false,
    application: { name: "Xiaohongshu", website: null },
    mentions: [],
    tags: [],
    emojis: [],
    card: null,
    poll: null,
    account: {
      id: username,
      username,
      acct: username,
      display_name: "Xiaohongshu",
      url: noteUrl,
      uri: accountUri(workerUrl),
      created_at: created,
      locked: false,
      bot: false,
      discoverable: true,
      indexable: false,
      group: false,
      avatar: FALLBACK_AVATAR,
      avatar_static: FALLBACK_AVATAR,
      header: "",
      header_static: "",
      followers_count: 0,
      following_count: 0,
      statuses_count: 1,
      hide_collections: false,
      noindex: false,
      emojis: [],
      roles: [],
      fields: [],
      note: "",
      last_status_at: created.split("T")[0],
    },
    media_attachments: [],
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    text: message,
  };
}

export function buildStatus(post: Post, workerUrl: string, noteUrl: string): MastodonStatus {
  const username = MASTODON_USERNAME;
  const selfUri = statusUri(workerUrl, post.noteId);
  const created = new Date(post.time).toISOString().replace(/\.\d+Z$/, ".000Z");

  const mediaAttachments: MediaAttachment[] = post.video ? [videoAttachment(post)] : imageAttachments(post);

  const avatar = post.user.avatar || FALLBACK_AVATAR;
  const bodyText = cleanDesc(post.desc);
  const displayName = post.user.nickname || "Xiaohongshu User";

  return {
    id: post.noteId,
    uri: selfUri,
    url: noteUrl,
    created_at: created,
    edited_at: null,
    reblog: null,
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    language: "zh",
    content: `<p>${encode(bodyText)}</p>`,
    spoiler_text: "",
    visibility: "public",
    sensitive: false,
    application: { name: "Xiaohongshu", website: null },
    mentions: [],
    tags: post.tags.map((name) => ({ name, url: "" })),
    emojis: [],
    card: null,
    poll: null,
    account: {
      id: username,
      username,
      acct: username,
      display_name: displayName,
      url: noteUrl,
      uri: accountUri(workerUrl),
      created_at: created,
      locked: false,
      bot: false,
      discoverable: true,
      indexable: false,
      group: false,
      avatar,
      avatar_static: avatar,
      header: "",
      header_static: "",
      followers_count: 0,
      following_count: 0,
      statuses_count: 1,
      hide_collections: false,
      noindex: false,
      emojis: [],
      roles: [],
      fields: [],
      note: "",
      last_status_at: created.split("T")[0],
    },
    media_attachments: mediaAttachments,
    replies_count: Number(post.interactInfo.comment) || 0,
    reblogs_count: Number(post.interactInfo.share) || 0,
    favourites_count: Number(post.interactInfo.liked) || 0,
    text: bodyText,
  };
}

export function buildPlayerPage(post: Post): string {
  const title = encode(post.title || truncate(cleanDesc(post.desc), 80) || "小红书笔记");

  if (post.video?.url) {
    return `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"/>
<title>${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;display:flex;justify-content:center;align-items:center;height:100vh}video{max-width:100%;max-height:100vh;display:block}</style>
</head><body>
<video controls autoplay playsinline poster="${escapeAttr(post.images[0] || "")}">
<source src="${escapeAttr(post.video.url)}" type="video/mp4"/>
</video></body></html>`;
  }

  if (post.images.length) {
    const imgs = post.images.map((u) => `  <img src="${escapeAttr(u)}" alt="" loading="lazy"/>`).join("\n");
    const counter = post.images.length > 1 ? ` (${post.images.length} images)` : "";
    return `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"/>
<title>${title}${counter}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#111;display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px;min-height:100vh}img{max-width:100%;max-height:90vh;object-fit:contain;display:block;border-radius:4px}</style>
</head><body>
${imgs}</body></html>`;
  }

  return `<html><body>No media</body></html>`;
}
