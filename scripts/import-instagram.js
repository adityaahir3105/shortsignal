// npm run import:instagram -- <path to export folder or .json file>
//
// Get the export from Instagram: Settings -> Accounts Center -> Your information
// and permissions -> Download your information -> choose JSON format, and at
// least "Saved" and "Likes". Unzip it and point this script at the folder.
import fs from "node:fs";
import path from "node:path";
import { loadLibrary, saveLibrary, upsertVideo, loadConfig } from "../src/store.js";
import { extractFromExport } from "../src/instagram.js";
import { heuristicScore } from "../src/score.js";

const target = process.argv[2];
if (!target || !fs.existsSync(target)) {
  console.error("Usage: npm run import:instagram -- <export folder or file.json>");
  process.exit(1);
}

// Only the files that list your own saves and likes.
const WANTED = /(saved_posts|saved_collections|liked_posts|liked_reels)\.json$/i;

function walk(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).flatMap((f) => walk(path.join(p, f)));
}

const files = walk(target).filter((f) => f.endsWith(".json") && (fs.statSync(target).isFile() || WANTED.test(f)));
if (!files.length) {
  console.error("No saved_posts.json / liked_posts.json found. Did you choose JSON (not HTML) when exporting?");
  process.exit(1);
}

const lib = loadLibrary();
const { topics } = loadConfig("topics");
let added = 0;
for (const f of files) {
  const kind = /liked/i.test(f) ? "liked" : "saved";
  const items = extractFromExport(JSON.parse(fs.readFileSync(f, "utf8")), `ig-export:${kind}`);
  let n = 0;
  for (const v of items) {
    v.score = heuristicScore(v, topics);
    if (upsertVideo(lib, v) === "added") n++;
  }
  added += n;
  console.log(`  ${path.basename(f)}: ${items.length} posts (${n} new)`);
}
saveLibrary(lib);
console.log(`Imported ${added} new Instagram posts. They show up under "Your saves" in the app.`);
