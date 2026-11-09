// Cloud Run web service: serves the public, read-only feed.
// The UI files are baked into the image (site/, built at image build time);
// data/feed.json comes from the Cloud Storage bucket the daily job writes to,
// cached in memory for a few minutes.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../src/store.js";
import { download } from "../src/gcs.js";

const PORT = Number(process.env.PORT) || 8080;
const BUCKET = process.env.GCS_BUCKET;
const SITE = path.join(ROOT, "site");
const TTL_MS = 5 * 60 * 1000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg" };

let feed = { body: null, at: 0 };
async function getFeed() {
  if (feed.body && Date.now() - feed.at < TTL_MS) return feed.body;
  try {
    const body = BUCKET ? await download(BUCKET, "feed.json") : null;
    if (body) feed = { body, at: Date.now() };
  } catch (err) {
    console.error(`feed.json: ${err.message}`); // keep serving the last good copy
  }
  return feed.body ?? JSON.stringify({ generatedAt: null, topics: [], videos: [] });
}

const indexTemplate = fs.readFileSync(path.join(SITE, "index.html"), "utf8");

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try {
      if (url.pathname === "/data/feed.json") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" });
        return res.end(await getFeed());
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        // Link-preview tags need the absolute URL of this deployment.
        const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
        res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache" });
        return res.end(indexTemplate.replaceAll("__SITE_URL__", origin));
      }
      const file = path.join(SITE, decodeURIComponent(url.pathname));
      if (!file.startsWith(SITE + path.sep) || url.pathname.startsWith("/data/") || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end("Not found");
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "public, max-age=3600" });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end("Server error");
    }
  })
  .listen(PORT, () => console.log(`ShortSignal public feed on :${PORT} (bucket: ${BUCKET ?? "none"})`));
