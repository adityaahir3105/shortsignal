// Cloud Run job: the daily refresh on GCP.
// 1. Download yesterday's library from the bucket
// 2. npm run fetch / score / build:static (same scripts as everywhere else)
// 3. Upload the new feed.json and library.json to the bucket
// The web service (serve-public.js) reads feed.json from the bucket.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, DATA_DIR } from "../src/store.js";
import { download, upload } from "../src/gcs.js";

const BUCKET = process.env.GCS_BUCKET;
if (!BUCKET) {
  console.error("GCS_BUCKET is not set.");
  process.exit(1);
}

const run = (script) => {
  console.log(`\n=== ${script} ===`);
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", script)], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`${script} exited with ${r.status}`);
};

fs.mkdirSync(DATA_DIR, { recursive: true });
const previous = await download(BUCKET, "library.json");
if (previous) {
  fs.writeFileSync(path.join(DATA_DIR, "library.json"), previous);
  console.log(`Restored library from gs://${BUCKET}/library.json`);
} else {
  console.log("No previous library in the bucket, starting fresh.");
}

run("fetch.js");
run("score.js");
run("build-static.js");

for (const name of ["feed.json", "library.json"]) {
  await upload(BUCKET, name, fs.readFileSync(path.join(ROOT, "site", "data", name)));
  console.log(`Uploaded gs://${BUCKET}/${name}`);
}
console.log("Refresh complete.");
