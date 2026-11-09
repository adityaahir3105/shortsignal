// Minimal Cloud Storage client: download and upload one object.
// On Cloud Run the token comes from the metadata server (the service account).
// Locally, set GCS_TOKEN=$(gcloud auth print-access-token) to test against a real bucket.

let cached = { token: null, exp: 0 };

async function token() {
  if (process.env.GCS_TOKEN) return process.env.GCS_TOKEN;
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!res.ok) throw new Error(`metadata token ${res.status}`);
  const { access_token, expires_in } = await res.json();
  cached = { token: access_token, exp: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

/** Returns the object's text, or null if it doesn't exist. */
export async function download(bucket, name) {
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GCS download ${name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.text();
}

export async function upload(bucket, name, body, contentType = "application/json") {
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": contentType },
    body,
  });
  if (!res.ok) throw new Error(`GCS upload ${name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
