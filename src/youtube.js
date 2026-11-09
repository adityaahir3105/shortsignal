// YouTube sources.
//  1. Channel RSS feeds (no key): every public channel has a feed of its latest
//     15 uploads, and Shorts are linked as /shorts/<id>, so we can tell them apart.
//  2. YouTube Data API search (optional key): finds Shorts from any creator.
//  3. oEmbed (no key): title + author for a single URL you paste in.

const UA = { "User-Agent": "Mozilla/5.0 (ShortSignal personal feed)" };

export function parseYouTubeId(url) {
  const m = String(url).match(
    /(?:youtube\.com\/(?:shorts\/|watch\?(?:.*&)?v=|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

export function youtubeRecord({ videoId, title, author, channelId, description, publishedAt, views, durationSec, source, isShort = true }) {
  return {
    id: `yt:${videoId}`,
    platform: "youtube",
    videoId,
    url: isShort ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`,
    title,
    author,
    channelId,
    description: (description || "").slice(0, 1500),
    // hq2.jpg is a frame from the middle of the video (YouTube auto-generates
    // frames at 25/50/75%). Same idea as HackerTube: no clickbait thumbnails.
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hq2.jpg`,
    publishedAt,
    views: views ?? null,
    durationSec: durationSec ?? null,
    source,
  };
}

/** Resolve "@handle" -> "UC..." channel id by reading the channel page. Cached by caller. */
export async function resolveHandle(handle) {
  const res = await fetch(`https://www.youtube.com/${handle}`, { headers: UA, redirect: "follow" });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/) || html.match(/channel_id=(UC[A-Za-z0-9_-]{22})/);
  return m ? m[1] : null;
}

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : "";
};

/** Parse a channel RSS feed and return only the Shorts. */
export function parseChannelFeed(xml, handle) {
  const entries = xml.split("<entry>").slice(1);
  const out = [];
  for (const e of entries) {
    const link = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || "";
    if (!link.includes("/shorts/")) continue;
    const videoId = tag(e, "yt:videoId");
    const views = (e.match(/<media:statistics views="(\d+)"/) || [])[1];
    out.push(
      youtubeRecord({
        videoId,
        title: tag(e, "title"),
        author: tag(tag(e, "author"), "name") || handle,
        channelId: tag(e, "yt:channelId"),
        description: tag(e, "media:description"),
        publishedAt: tag(e, "published"),
        views: views ? Number(views) : null,
        source: `rss:${handle}`,
      }),
    );
  }
  return out;
}

export async function fetchChannelShorts(channelId, handle) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: UA });
  if (!res.ok) throw new Error(`RSS ${res.status} for ${handle}`);
  return parseChannelFeed(await res.text(), handle);
}

/** ISO 8601 duration (PT1M5S) -> seconds */
export function isoDurationToSec(iso) {
  const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

/**
 * Search the YouTube Data API for short videos. Costs 100 quota units per search
 * plus 1 per videos.list call (50 ids each). Shorts can be up to 3 minutes.
 */
export async function searchShorts(query, apiKey, { maxResults = 25, days = 120 } = {}) {
  const publishedAfter = new Date(Date.now() - days * 86400e3).toISOString();
  const s = new URL("https://www.googleapis.com/youtube/v3/search");
  Object.entries({
    part: "snippet",
    q: query,
    type: "video",
    videoDuration: "short", // < 4 minutes
    order: "relevance",
    relevanceLanguage: "en",
    publishedAfter,
    maxResults,
    key: apiKey,
  }).forEach(([k, v]) => s.searchParams.set(k, v));
  const sr = await fetch(s);
  if (!sr.ok) throw new Error(`YouTube search ${sr.status}: ${(await sr.text()).slice(0, 200)}`);
  const ids = (await sr.json()).items.map((i) => i.id.videoId).filter(Boolean);
  if (!ids.length) return [];

  const v = new URL("https://www.googleapis.com/youtube/v3/videos");
  v.searchParams.set("part", "snippet,contentDetails,statistics");
  v.searchParams.set("id", ids.join(","));
  v.searchParams.set("key", apiKey);
  const vr = await fetch(v);
  if (!vr.ok) throw new Error(`YouTube videos ${vr.status}`);
  return (await vr.json()).items
    .map((it) => ({ it, sec: isoDurationToSec(it.contentDetails.duration) }))
    .filter(({ sec }) => sec !== null && sec <= 180)
    .map(({ it, sec }) =>
      youtubeRecord({
        videoId: it.id,
        title: it.snippet.title,
        author: it.snippet.channelTitle,
        channelId: it.snippet.channelId,
        description: it.snippet.description,
        publishedAt: it.snippet.publishedAt,
        views: Number(it.statistics?.viewCount ?? 0),
        durationSec: sec,
        source: `search:${query}`,
      }),
    );
}

/** Title + author for one pasted URL, no key needed. */
export async function oembed(url) {
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { headers: UA });
  if (!res.ok) return null;
  return res.json();
}
