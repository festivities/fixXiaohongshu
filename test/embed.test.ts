import { describe, expect, it } from "vitest";
import { cleanDesc, createEmbed, displayTitle, truncate } from "../src/embed";
import type { Post } from "../src/xhs";

const base: Post = {
  noteId: "6aa69315000000000d02643c",
  type: "video",
  title: "魔卡中最具梦核感的一段",
  desc: "文案灵感 #百变小樱[话题]# #魔卡少女樱[话题]#",
  user: { nickname: "天外天", avatar: "https://sns-avatar-qc.xhscdn.com/avatar/x.jpg" },
  interactInfo: { liked: "3678", comment: "43", share: "49", collected: "395" },
  images: ["https://sns-webpic-qc.xhscdn.com/img.jpg"],
  video: { url: "https://sns-video-zl.xhscdn.com/v.mp4", backupUrls: [], width: 720, height: 1280, durationMs: 25146 },
  ipLocation: "上海",
  time: 1789488610000,
  tags: ["百变小樱"],
};

describe("cleanDesc", () => {
  it("strips [话题] markers keeping the tag", () => {
    expect(cleanDesc("#百变小樱[话题]# #魔卡少女樱[话题]# hello")).toBe("#百变小樱 #魔卡少女樱 hello");
  });
  it("collapses whitespace", () => {
    expect(cleanDesc("a\n\nb   c")).toBe("a b c");
  });
});

describe("truncate", () => {
  it("truncates at ~350 chars with ellipsis", () => {
    const long = "x".repeat(400);
    const out = truncate(long);
    expect(out.length).toBe(351);
    expect(out.endsWith("…")).toBe(true);
    expect(truncate("short")).toBe("short");
  });
});

describe("displayTitle", () => {
  it("prefers title, falls back to first desc line", () => {
    expect(displayTitle(base)).toBe("魔卡中最具梦核感的一段");
    expect(displayTitle({ ...base, title: "", desc: "line one\nline two" })).toBe("line one");
    expect(displayTitle({ ...base, title: "", desc: "" })).toBe("小红书笔记");
  });
});

describe("createEmbed video", () => {
  const html = createEmbed(base, { origin: "https://xhslink.festivity.moe", currentPath: "/o/abc123", shareId: "o/abc123" });
  it("has theme color and title", () => {
    expect(html).toContain('content="#ff2442"');
    expect(html).toContain("魔卡中最具梦核感的一段");
  });
  it("points og:video at kind-prefixed /dl/ share id, URI-encoded", () => {
    expect(html).toContain('property="og:video" content="https://xhslink.festivity.moe/dl/o%2Fabc123"');
    expect(html).toContain('content="video/mp4"');
    expect(html).toContain('property="og:video:width" content="720"');
  });
  it("formats the stats line", () => {
    expect(html).toContain("❤️ 3678");
    expect(html).toContain("💬 43");
    expect(html).toContain("⭐ 395");
    expect(html).toContain("🔁 49");
  });
  it("escapes hostile input", () => {
    const evil = createEmbed({ ...base, title: '<script>alert("x")</script>&"\'', desc: "a<b>&\"c" }, { origin: "https://xhslink.festivity.moe", currentPath: "/o/1", shareId: "1" });
    expect(evil).not.toContain("<script>alert");
    expect(evil).toContain("&lt;script&gt;");
    expect(evil).toContain("&amp;");
    expect(evil).toContain("&quot;");
  });
});

describe("createEmbed image", () => {
  const html = createEmbed({ ...base, type: "normal", video: undefined, title: "" }, { origin: "https://xhslink.festivity.moe", currentPath: "/explore/n?xsec_token=t" });
  it("uses twitter summary_large_image and no og:video", () => {
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).not.toContain("og:video");
    expect(html).toContain("og:image");
  });
});
