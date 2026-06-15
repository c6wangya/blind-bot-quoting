// Streams the carried-over result image through the quote origin so the browser's
// network panel never reveals the upstream (blind-bot) host. Allowlisted to prevent
// the route from being an open proxy / SSRF vector.

function hostOf(u: string | undefined): string {
  if (!u) return "";
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const ALLOWED_HOSTS = (process.env.IMG_PROXY_ALLOWED_HOSTS || hostOf(process.env.BLINDBOT_API_URL))
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export async function GET(req: Request) {
  const src = new URL(req.url).searchParams.get("src");
  if (!src) return new Response("missing src", { status: 400 });

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return new Response("invalid src", { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return new Response("invalid scheme", { status: 400 });
  }
  if (!ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) {
    return new Response("host not allowed", { status: 400 });
  }

  try {
    const upstream = await fetch(url.toString(), { cache: "no-store" });
    if (!upstream.ok) return new Response("upstream error", { status: 502 });
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: { "content-type": contentType, "cache-control": "public, max-age=3600" },
    });
  } catch {
    return new Response("fetch failed", { status: 502 });
  }
}
