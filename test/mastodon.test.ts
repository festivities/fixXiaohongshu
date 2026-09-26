import { describe, expect, it } from "vitest";
import { buildFallbackStatus, buildPlayerPage, buildStatus } from "../src/mastodon";
import { accountUri, statusUri, type Post } from "../src/xhs";

const WORKER = "https://xhslink.festivity.moe";
const NOTE_URL = "https://www.xiaohongshu.com/explore/6aa69315000000000d02643c?xsec_token=ABC%3D";

const videoPost: Post = {
  noteId: "6aa69315000000000d02643c",
  type: "video",
  title: "魔卡中最具梦核感的一段",
  desc: "文案灵感 #百变小樱[话题]#",
  user: { nickname: "天外天", avatar: "https://sns-avatar-qc.xhscdn.com/avatar/x.jpg" },
  interactInfo: { liked: "3678", comment: "43", share: "49", collected: "395" },
  images: ["https://sns-webpic-qc.xhscdn.com/img.jpg"],
  video: { url: "https://sns-video-zl.xhscdn.com/v.mp4?sign=a&t=b", backupUrls: [], width: 720, height: 960, durationMs: 25146 },
  ipLocation: "江西",
  time: 1789301525000,
  tags: ["百变小樱"],
  xsecToken: "ABC=",
};

const imagePost: Post = { ...videoPost, type: "normal", video: undefined, images: [1, 2, 3, 4, 5].map((n) => `https://sns-webpic-qc.xhscdn.com/i${n}.jpg`) };

describe("statusUri/accountUri", () => {
  it("builds mastodon-shaped urls", () => {
    expect(statusUri(WORKER, "abc")).toBe(`${WORKER}/users/xiaohongshu/statuses/abc`);
    expect(accountUri(WORKER)).toBe(`${WORKER}/users/xiaohongshu`);
  });
});

describe("buildStatus", () => {
  it("video post becomes one video media attachment with real dimensions", () => {
    const s = buildStatus(videoPost, WORKER, NOTE_URL);
    expect(s.id).toBe(videoPost.noteId);
    expect(s.url).toBe(NOTE_URL);
    expect(s.uri).toBe(statusUri(WORKER, videoPost.noteId));
    expect(s.media_attachments).toHaveLength(1);
    const m = s.media_attachments[0];
    expect(m.type).toBe("video");
    expect(m.url).toBe(videoPost.video!.url);
    expect(m.preview_url).toBe(videoPost.images[0]);
    expect(m.meta.original.width).toBe(720);
    expect(m.meta.original.duration).toBeCloseTo(25.146);
  });

  it("image post becomes up to 4 image attachments", () => {
    const s = buildStatus(imagePost, WORKER, NOTE_URL);
    expect(s.media_attachments).toHaveLength(4);
    for (const m of s.media_attachments) expect(m.type).toBe("image");
    expect(s.media_attachments[0].url).toBe(imagePost.images[0]);
  });

  it("maps counts, content, tags and account", () => {
    const s = buildStatus(videoPost, WORKER, NOTE_URL);
    expect(s.favourites_count).toBe(3678);
    expect(s.replies_count).toBe(43);
    expect(s.reblogs_count).toBe(49);
    expect(s.content).toContain("#百变小樱");
    expect(s.content).not.toContain("[话题]");
    expect(s.account.display_name).toBe("天外天");
    expect(s.account.avatar).toBe(videoPost.user.avatar);
    expect(s.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*\.000Z$/);
  });

  it("escapes hostile desc in content", () => {
    const s = buildStatus({ ...videoPost, desc: '<script>alert("x")</script>' }, WORKER, NOTE_URL);
    expect(s.content).not.toContain("<script>");
    expect(s.content).toContain("&lt;script&gt;");
    expect(s.text).toContain('<script>alert("x")</script>');
  });
});

describe("buildFallbackStatus", () => {
  it("stays a valid status shape with the error as content", () => {
    const s = buildFallbackStatus("abc", WORKER, "note page redirected to /login");
    expect(s.id).toBe("abc");
    expect(s.uri).toBe(statusUri(WORKER, "abc"));
    expect(s.media_attachments).toEqual([]);
    expect(s.account.display_name).toBe("Xiaohongshu");
    expect(s.content).toContain("note page redirected to /login");
    expect(s.text).toBe("note page redirected to /login");
  });
});

describe("buildPlayerPage", () => {
  it("renders a video player with escaped urls", () => {
    const html = buildPlayerPage(videoPost);
    expect(html).toContain("<video controls");
    expect(html).toContain("&amp;t=b");
    expect(html).not.toContain('src="https://sns-video-zl.xhscdn.com/v.mp4?sign=a&t=b"');
  });

  it("renders an image gallery capped at all images", () => {
    const html = buildPlayerPage(imagePost);
    expect((html.match(/<img /g) ?? []).length).toBe(5);
    expect(html).toContain("(5 images)");
  });

  it("escapes hostile image urls", () => {
    const hostile = { ...imagePost, images: ['https://e.com/a.jpg"onload="evil'] };
    const html = buildPlayerPage(hostile);
    expect(html).not.toContain('onload="evil');
    expect(html).toContain("&quot;");
  });
});
