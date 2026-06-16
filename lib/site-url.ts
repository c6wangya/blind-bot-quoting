/**
 * Public origin of the deployment, derived from proxy-forwarded headers.
 *
 * Behind a proxy (Render, Vercel, etc.) the app listens on an internal port, so
 * `new URL(req.url).origin` resolves to e.g. http://localhost:10000 — using that for
 * redirects sends users to localhost. Render sets `x-forwarded-host` / `x-forwarded-proto`;
 * honor those, falling back to the Host header, then the request origin (local dev).
 */
export function publicOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}
