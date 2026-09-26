import { encode } from "html-entities";
import { statusUri, type Post } from "./xhs";

export function cleanDesc(desc: string): string {
  return desc
    .replace(/#(\S.+?)\[话题\]#/g, "#$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(s: string, max = 350): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export function displayTitle(post: Post): string {
  if (post.title) return post.title;
  const firstLine = (post.desc || "").split("\n")[0].trim();
  return firstLine || "小红书笔记";
}

export function createEmbed(post: Post, opts: { origin: string; currentPath: string; shareId?: string }): string {
  const title = displayTitle(post);
  const desc = truncate(cleanDesc(post.desc));
  const url = `${opts.origin}${opts.currentPath}`;
  // ponytail: the activity+json alternate is what makes Discord treat this as
  // a Mastodon status (rich text + up to 4 images / video). The token rides on
  // the link because Discord may fetch it verbatim with no other query.
  const activityBase = statusUri(opts.origin, post.noteId);
  const activityUrl = post.xsecToken ? `${activityBase}?xsec_token=${encodeURIComponent(post.xsecToken)}` : activityBase;
  const image = post.images[0] ?? post.user.avatar;
  const siteName = `❤️ ${post.interactInfo.liked}  💬 ${post.interactInfo.comment}  ⭐ ${post.interactInfo.collected}  🔁 ${post.interactInfo.share}`;

  const tags: string[] = [
    `<meta charset="utf-8">`,
    `<meta name="theme-color" content="#ff2442">`,
    `<meta property="og:title" content="${encode(title && post.user.nickname ? `${post.user.nickname} - ${title}` : title)}">`,
    `<meta property="og:description" content="${encode(desc)}">`,
    `<meta property="og:site_name" content="${encode(siteName)}">`,
    `<meta property="og:url" content="${encode(url)}">`,
    `<meta property="og:image" content="${encode(image)}">`,
    `<title>${encode(title)}</title>`,
    `<link rel="canonical" href="${encode(url)}">`,
    `<link rel="alternate" href="${encode(activityUrl)}" type="application/activity+json">`,
  ];

  if (post.video) {
    const videoUrl = opts.shareId ? `${opts.origin}/dl/${encodeURIComponent(opts.shareId)}` : post.video.url;
    tags.push(
      `<meta property="og:type" content="video.other">`,
      `<meta property="og:video" content="${encode(videoUrl)}">`,
      `<meta property="og:video:secure_url" content="${encode(videoUrl)}">`,
      `<meta property="og:video:type" content="video/mp4">`,
      `<meta property="og:video:width" content="${post.video.width}">`,
      `<meta property="og:video:height" content="${post.video.height}">`,
    );
  } else {
    tags.push(`<meta name="twitter:card" content="summary_large_image">`);
  }

  return `<!DOCTYPE html>\n<html lang="zh">\n<head>\n${tags.join("\n")}\n</head>\n<body></body>\n</html>`;
}

export function errorHtml(message: string): string {
  const m = encode(message);
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta property="og:title" content="Error - Post Not Found">\n<meta property="og:description" content="${m}">\n<meta name="twitter:card" content="summary">\n<title>Error</title>\n</head>\n<body>\n<h1>Error</h1>\n<p>${m}</p>\n</body>\n</html>`;
}
