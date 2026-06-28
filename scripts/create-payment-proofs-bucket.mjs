// One-off: create the private `payment-proofs` Storage bucket used for payment receipts
// and refund supporting documents. Uses the Storage REST API directly (avoids supabase-js
// realtime, which needs `ws` on Node < 22). Safe to re-run (ignores "already exists").
import { readFileSync } from "node:fs";

// Pick the env file: `node create-payment-proofs-bucket.mjs [.env.local.beta]` (default .env.local).
const envFile = process.argv[2] || ".env.local";
for (const line of readFileSync(new URL(`../${envFile}`, import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
console.log(`Using ${envFile} → ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const res = await fetch(`${url}/storage/v1/bucket`, {
  method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    id: "payment-proofs",
    name: "payment-proofs",
    public: false,
    allowed_mime_types: ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"],
    file_size_limit: 10 * 1024 * 1024,
  }),
});

const body = await res.json().catch(() => ({}));
if (res.ok) console.log('Created private bucket "payment-proofs".');
else if (/exists/i.test(JSON.stringify(body))) console.log('Bucket "payment-proofs" already exists — OK.');
else {
  console.error("Failed:", res.status, JSON.stringify(body));
  process.exit(1);
}
