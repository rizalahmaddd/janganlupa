const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "igshid", "igsh",
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "mkt_tok", "ref_src", "ref_url", "si", "s_cid", "spm",
  "share_source", "share_medium", "from_source", "vero_id", "oly_anon_id", "oly_enc_id", "rb_clickid",
]);

export function parseUserUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().replace(/^<|>$/g, "");
  if (!value || value.length > 4096) return null;
  if (/^\/\//.test(value)) value = "https:" + value;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = "https://" + value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname || (!url.hostname.includes(".") && url.hostname !== "localhost" && !isIpLiteral(url.hostname))) return null;
  url.username = "";
  url.password = "";
  return url;
}

export function normalizeUrl(url: URL): string {
  const u = new URL(url.toString());
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
  const kept: [string, string][] = [];
  for (const [k, v] of u.searchParams) {
    const key = k.toLowerCase();
    if (key.startsWith("utm_") || TRACKING_PARAMS.has(key)) continue;
    kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const search = new URLSearchParams(kept).toString();
  let path = u.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  // http and https are treated as the same link so re-saving after a site upgrades doesn't duplicate.
  return `${u.hostname}${u.port ? ":" + u.port : ""}${path === "/" ? "" : path}${search ? "?" + search : ""}`;
}

export function cleanUrl(url: URL): string {
  const u = new URL(url.toString());
  for (const k of [...u.searchParams.keys()]) {
    const key = k.toLowerCase();
    if (key.startsWith("utm_") || TRACKING_PARAMS.has(key)) u.searchParams.delete(k);
  }
  return u.toString();
}

export function displayDomain(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
}

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (host.includes(":")) {
    return host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:");
  }
  return false;
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+|\bwww\.[^\s<>"'`]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s<>"'`]*/gi;

export function extractUrls(text: string, limit = 500): URL[] {
  const seen = new Set<string>();
  const out: URL[] = [];
  for (const match of text.matchAll(URL_IN_TEXT)) {
    let raw = match[0].replace(/[,.;:!?\]'"]+$/, "");
    // Keep a closing paren only when it belongs to the URL, e.g. wiki/Foo_(bar).
    while (raw.endsWith(")") && (raw.match(/\(/g) ?? []).length < (raw.match(/\)/g) ?? []).length) raw = raw.slice(0, -1).replace(/[,.;:!?]+$/, "");
    const url = parseUserUrl(raw);
    if (!url) continue;
    const norm = normalizeUrl(url);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}
