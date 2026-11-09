// Instagram has no API for reading your feed, so we use your own data instead:
//  - the "Download your information" export (JSON), which lists your saved and
//    liked posts with their links, and
//  - links you paste or share into the app.
// Reels are shown with Instagram's own embed player; nothing is downloaded.

export function parseInstagramId(url) {
  const m = String(url).match(/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? { kind: m[1] === "p" ? "p" : "reel", code: m[2] } : null;
}

export function instagramRecord({ code, kind = "reel", author, note, savedAt, source }) {
  return {
    id: `ig:${code}`,
    platform: "instagram",
    videoId: code,
    url: `https://www.instagram.com/${kind}/${code}/`,
    embedKind: kind,
    title: note || (author ? `Reel by @${author}` : "Instagram reel"),
    author: author || null,
    description: note || "",
    thumbnail: null,
    publishedAt: savedAt || null,
    views: null,
    durationSec: null,
    source,
  };
}

/**
 * Walk any Instagram export JSON and pull out every post/reel link.
 * The export format changes every so often, so instead of hard-coding paths we
 * look for objects that carry an instagram.com/(reel|p)/ href, plus a nearby
 * "title" (the author) and timestamp.
 */
export function extractFromExport(json, source) {
  const found = new Map();
  const visit = (node, ctx) => {
    if (Array.isArray(node)) return node.forEach((n) => visit(n, ctx));
    if (!node || typeof node !== "object") return;
    const here = { ...ctx };
    if (typeof node.title === "string" && node.title && !node.title.includes("http")) here.author = node.title;
    if (typeof node.timestamp === "number") here.ts = node.timestamp;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && (k === "href" || k === "value" || k === "uri")) {
        const id = parseInstagramId(v);
        if (id && !found.has(id.code)) {
          const ts = typeof node.timestamp === "number" ? node.timestamp : here.ts;
          found.set(
            id.code,
            instagramRecord({
              code: id.code,
              kind: id.kind,
              author: here.author,
              savedAt: ts ? new Date(ts * 1000).toISOString() : null,
              source,
            }),
          );
        }
      } else if (v && typeof v === "object") {
        visit(v, here);
      }
    }
  };
  visit(json, {});
  return [...found.values()];
}
