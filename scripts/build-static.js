// npm run build:static
// Builds the public, read-only site into site/ for GitHub Pages:
//   site/index.html, app.js, styles.css, rank.js   the same UI, in static mode
//   site/data/feed.json                            relevant YouTube videos, trimmed
//   site/data/library.json                         full library, so tomorrow's run continues from it
// Instagram items and your own feedback never leave your machine.
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadLibrary, loadConfig } from "../src/store.js";

const OUT = path.join(ROOT, "site");
const SITE_URL = (process.env.SITE_URL || "").replace(/\/?$/, "/");
const REPO = process.env.REPO_URL || "https://github.com/adityaahir3105/shortsignal";
const MAX_AGE_DAYS = 365;

const lib = loadLibrary();
const { topics } = loadConfig("topics");
const cutoff = Date.now() - MAX_AGE_DAYS * 86400e3;

// Keep the public library to YouTube videos from the last year.
const publicVideos = Object.fromEntries(
  Object.entries(lib.videos).filter(
    ([, v]) => v.platform === "youtube" && (!v.publishedAt || new Date(v.publishedAt).getTime() > cutoff),
  ),
);

const feedVideos = Object.values(publicVideos)
  .filter((v) => v.score?.relevant)
  .map(({ id, platform, videoId, url, title, author, publishedAt, views, durationSec, thumbnail, score }) => ({
    id, platform, videoId, url, title, author, publishedAt, views, durationSec, thumbnail, score,
  }));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });

for (const f of ["app.js", "styles.css"]) fs.copyFileSync(path.join(ROOT, "public", f), path.join(OUT, f));
fs.copyFileSync(path.join(ROOT, "src", "rank.js"), path.join(OUT, "rank.js"));

const description = "A curated feed of short AI and Claude videos. Ten good ones a day, scored for depth, not hype.";
const head = [
  `<meta property="og:type" content="website" />`,
  `<meta property="og:title" content="ShortSignal: AI Shorts worth your time" />`,
  `<meta property="og:description" content="${description}" />`,
  SITE_URL !== "/" ? `<meta property="og:url" content="${SITE_URL}" />` : "",
  fs.existsSync(path.join(ROOT, "public", "og.jpg")) && SITE_URL !== "/" ? `<meta property="og:image" content="${SITE_URL}og.jpg" />` : "",
  `<meta name="twitter:card" content="summary_large_image" />`,
  `<script>window.SHORTSIGNAL_STATIC = ${JSON.stringify({ repo: REPO })};</script>`,
].filter(Boolean).join("\n  ");

const html = fs
  .readFileSync(path.join(ROOT, "public", "index.html"), "utf8")
  .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${description}" />`)
  .replace("</head>", `  ${head}\n</head>`);
fs.writeFileSync(path.join(OUT, "index.html"), html);
if (fs.existsSync(path.join(ROOT, "public", "og.jpg"))) fs.copyFileSync(path.join(ROOT, "public", "og.jpg"), path.join(OUT, "og.jpg"));

const generatedAt = new Date().toISOString();
fs.writeFileSync(
  path.join(OUT, "data", "feed.json"),
  JSON.stringify({ generatedAt, topics: topics.map(({ id, name }) => ({ id, name })), videos: feedVideos }),
);
fs.writeFileSync(
  path.join(OUT, "data", "library.json"),
  JSON.stringify({ videos: publicVideos, channels: lib.channels, generatedAt }),
);
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

const claude = feedVideos.filter((v) => v.score.by === "claude").length;
console.log(`Built site/ with ${feedVideos.length} videos in the feed (${claude} scored by Claude), ${Object.keys(publicVideos).length} in the library.`);
