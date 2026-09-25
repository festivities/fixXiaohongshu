import { describe, expect, it } from "vitest";
import { buildNoteHeaders, extractPost, parseState, rewriteNoteUrl, upgradeScheme, XHS_HEADERS } from "../src/xhs";
import imageState from "./fixtures/image.json";
import videoState from "./fixtures/video.json";

const wrap = (state: unknown) => `<html><head><script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script></head></html>`;

describe("parseState", () => {
  it("parses the video fixture state", () => {
    const state = parseState(wrap(videoState));
    expect(state.note.firstNoteId).toBe("6aa69315000000000d02643c");
  });

  it("parses the image fixture state", () => {
    const state = parseState(wrap(imageState));
    expect(state.note.firstNoteId).toBe("6a88a537000000003300c784");
  });

  it("repairs undefined value tokens", () => {
    const withUndef = `<html><head><script>window.__INITIAL_STATE__=${JSON.stringify(videoState).replace(/^{/, '{"probe":undefined,')}</script></head></html>`;
    const state = parseState(withUndef);
    expect(state.probe).toBeNull();
    expect(state.note.firstNoteId).toBe("6aa69315000000000d02643c");
  });

  it("unwraps ref-style firstNoteId", () => {
    const ref = { ...videoState, note: { ...videoState.note, firstNoteId: { _value: "6aa69315000000000d02643c" } } };
    const state = parseState(wrap(ref));
    expect(extractPost(state).noteId).toBe("6aa69315000000000d02643c");
  });

  it("throws when state script is missing", () => {
    expect(() => parseState("<html></html>")).toThrow();
  });
});

describe("extractPost video", () => {
  const post = extractPost(parseState(wrap(videoState)));
  it("maps core fields", () => {
    expect(post.noteId).toBe("6aa69315000000000d02643c");
    expect(post.type).toBe("video");
    expect(post.title).toBe("魔卡中最具梦核感的一段");
    expect(post.user.nickname).toBeTruthy();
  });
  it("keeps stats as strings", () => {
    expect(post.interactInfo.liked).toMatch(/^\d+$/);
    expect(post.interactInfo.comment).toMatch(/^\d+$/);
    expect(post.interactInfo.share).toMatch(/^\d+$/);
    expect(post.interactInfo.collected).toMatch(/^\d+$/);
  });
  it("picks h264 video and upgrades to https", () => {
    expect(post.video).toBeDefined();
    expect(post.video!.url.startsWith("https://")).toBe(true);
    expect(post.video!.url).toContain(".xhscdn.com");
    expect(post.video!.url).toContain(".mp4");
    expect(post.video!.width).toBeGreaterThan(0);
    expect(post.video!.height).toBeGreaterThan(0);
    for (const u of post.video!.backupUrls) expect(u.startsWith("https://")).toBe(true);
  });
  it("falls back to h265 when h264 is empty and picks max resolution", () => {
    const state = JSON.parse(JSON.stringify(videoState));
    const note = state.note.noteDetailMap[state.note.firstNoteId].note;
    note.video.media.stream = {
      h264: [],
      h265: [
        { masterUrl: "http://sns-video-zl.xhscdn.com/low.mp4", width: 360, height: 480, duration: 1000, backupUrls: [] },
        { masterUrl: "http://sns-video-zl.xhscdn.com/high.mp4", width: 1080, height: 1440, duration: 1000, backupUrls: [] },
      ],
    };
    const post = extractPost(state);
    expect(post.video!.url).toBe("https://sns-video-zl.xhscdn.com/high.mp4");
    expect(post.video!.width).toBe(1080);
  });

  it("omits video when no stream entry has a masterUrl", () => {
    const state = JSON.parse(JSON.stringify(videoState));
    const note = state.note.noteDetailMap[state.note.firstNoteId].note;
    note.video.media.stream = { h264: [{ width: 720, height: 960, duration: 1000, backupUrls: [] }] };
    const post = extractPost(state);
    expect(post.video).toBeUndefined();
  });

  it("collects tags and images", () => {
    expect(post.tags).toContain("百变小樱");
    expect(post.images.length).toBeGreaterThan(0);
    for (const u of post.images) expect(u.startsWith("https://")).toBe(true);
  });
});

describe("extractPost image note", () => {
  const post = extractPost(parseState(wrap(imageState)));
  it("has no video and empty title", () => {
    expect(post.type).toBe("normal");
    expect(post.video).toBeUndefined();
    expect(post.title).toBe("");
    expect(post.desc.length).toBeGreaterThan(0);
    expect(post.images.length).toBeGreaterThan(0);
  });
});

describe("rewriteNoteUrl", () => {
  const loc =
    "https://www.xiaohongshu.com/discovery/item/6aa1380d0000000025034af9?xsec_token=ABC%3D&xsec_source=app_share";
  it("swaps host to rednote keeping path and full query", () => {
    expect(rewriteNoteUrl(loc, true)).toBe(
      "https://www.rednote.com/discovery/item/6aa1380d0000000025034af9?xsec_token=ABC%3D&xsec_source=app_share",
    );
  });
  it("rewrites discovery/item to explore on xiaohongshu", () => {
    expect(rewriteNoteUrl(loc, false)).toBe(
      "https://www.xiaohongshu.com/explore/6aa1380d0000000025034af9?xsec_token=ABC%3D&xsec_source=app_share",
    );
  });
  it("rejects off-host and off-path redirects", () => {
    expect(() => rewriteNoteUrl("https://evil.com/discovery/item/1", true)).toThrow();
    expect(() => rewriteNoteUrl("https://www.xiaohongshu.com/", false)).toThrow();
    expect(() => rewriteNoteUrl("not a url", false)).toThrow();
  });
});

describe("buildNoteHeaders", () => {
  it("sends no cookie without a session", () => {
    const h = buildNoteHeaders(undefined);
    expect(h).toEqual(XHS_HEADERS);
    expect("cookie" in h).toBe(false);
    expect("Referer" in h).toBe(false);
  });
  it("attaches cookie and rednote referer with a session", () => {
    const h = buildNoteHeaders("a1=xyz; webId=abc");
    expect(h.cookie).toBe("a1=xyz; webId=abc");
    expect(h.Referer).toBe("https://www.rednote.com/");
    expect(h["user-agent"]).toBe(XHS_HEADERS["user-agent"]);
  });
});

describe("upgradeScheme", () => {
  it("upgrades xhscdn http urls only", () => {
    expect(upgradeScheme("http://sns-video-zl.xhscdn.com/a.mp4")).toBe("https://sns-video-zl.xhscdn.com/a.mp4");
    expect(upgradeScheme("https://sns-video-zl.xhscdn.com/a.mp4")).toBe("https://sns-video-zl.xhscdn.com/a.mp4");
    expect(upgradeScheme("http://example.com/a.mp4")).toBe("http://example.com/a.mp4");
  });
  it("upgrades rednotecdn http urls", () => {
    expect(upgradeScheme("http://sns-web-i10.rednotecdn.com/a.jpg")).toBe("https://sns-web-i10.rednotecdn.com/a.jpg");
    expect(upgradeScheme("http://xhslink.com/a.mp4")).toBe("http://xhslink.com/a.mp4");
  });
});
