import { isBlockedHost } from "./url";

export interface PageMeta {
  finalUrl: string;
  httpStatus: number;
  contentType: string | null;
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
  siteName: string | null;
}

export class FetchError extends Error {
  constructor(message: string, public httpStatus: number | null = null, public permanent = false) {
    super(message);
  }
}

const UA = "Mozilla/5.0 (compatible; JanganLupaBot/1.0; +https://github.com/janganlupa) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 512 * 1024;

export async function safeFetch(input: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
  let current = input;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), init.timeout ?? TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = new URL(current);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || isBlockedHost(url.hostname)) {
        throw new FetchError("Alamat tidak diizinkan", null, true);
      }
      const res = await fetch(url.toString(), { ...init, redirect: "manual", signal: controller.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, url).toString();
        res.body?.cancel();
        continue;
      }
      Object.defineProperty(res, "finalUrl", { value: current });
      return res;
    }
    throw new FetchError("Terlalu banyak redirect");
  } catch (e) {
    if (e instanceof FetchError) throw e;
    if (controller.signal.aborted) throw new FetchError("Waktu habis saat membuka halaman");
    throw new FetchError(e instanceof Error ? e.message : "Gagal membuka halaman");
  } finally {
    clearTimeout(timer);
  }
}

export const finalUrlOf = (res: Response, fallback: string) => ((res as unknown as { finalUrl?: string }).finalUrl ?? fallback);

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function safeChar(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function resolve(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  const v = href.trim();
  if (!v || v.startsWith("data:") || v.startsWith("javascript:")) return null;
  try {
    const u = new URL(v, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function tidy(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const v = decodeEntities(s).replace(/\s+/g, " ").trim();
  if (!v) return null;
  return v.length > max ? v.slice(0, max - 1) + "…" : v;
}

export async function fetchMeta(target: string): Promise<PageMeta> {
  const res = await safeFetch(target, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/*;q=0.8,*/*;q=0.5",
      "accept-language": "id,en;q=0.8",
    },
  });
  const finalUrl = finalUrlOf(res, target);
  const contentType = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? null;
  const base: PageMeta = { finalUrl, httpStatus: res.status, contentType, title: null, description: null, image: null, favicon: null, siteName: null };

  if (res.status === 404 || res.status === 410) {
    res.body?.cancel();
    throw new FetchError(`Halaman tidak ditemukan (${res.status})`, res.status, true);
  }
  if (res.status >= 400) {
    res.body?.cancel();
    // 401/403/429/5xx are often bot protection; the link may still work in a real browser.
    throw new FetchError(`Situs menolak akses (${res.status})`, res.status);
  }

  if (contentType?.startsWith("image/")) {
    res.body?.cancel();
    return { ...base, image: finalUrl, title: decodeURIComponent(new URL(finalUrl).pathname.split("/").pop() || "") || null };
  }
  if (contentType && !contentType.includes("html") && !contentType.includes("xml")) {
    res.body?.cancel();
    const file = decodeURIComponent(new URL(finalUrl).pathname.split("/").pop() || "");
    return { ...base, title: file || null };
  }

  const found: Record<string, string> = {};
  let titleText = "";
  let inTitle = false;
  const icons: { href: string; score: number }[] = [];
  const firstImg: { src?: string } = {};

  const setOnce = (key: string, value: string | null) => {
    if (value && !found[key]) found[key] = value;
  };

  const rewriter = new HTMLRewriter()
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("property") || el.getAttribute("name") || el.getAttribute("itemprop") || "").toLowerCase();
        const content = el.getAttribute("content");
        if (!key || !content) return;
        if (["og:title", "twitter:title"].includes(key)) setOnce("ogTitle", content);
        else if (["og:description", "twitter:description", "description"].includes(key)) setOnce(key === "description" ? "desc" : "ogDesc", content);
        else if (["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src", "image"].includes(key)) setOnce("image", content);
        else if (key === "og:site_name" || key === "application-name") setOnce("siteName", content);
      },
    })
    .on("title", {
      element(el) {
        inTitle = true;
        el.onEndTag(() => {
          inTitle = false;
        });
      },
      text(t) {
        if (inTitle && titleText.length < 500) titleText += t.text;
      },
    })
    .on("link", {
      element(el) {
        const rel = (el.getAttribute("rel") || "").toLowerCase();
        const href = el.getAttribute("href");
        if (!href) return;
        if (rel.includes("icon")) {
          const sizes = parseInt(el.getAttribute("sizes") || "0", 10) || 0;
          const score = (rel.includes("apple-touch") ? 180 : 0) + sizes + (href.endsWith(".svg") ? 64 : 0);
          icons.push({ href, score });
        } else if (rel === "image_src") setOnce("image", href);
      },
    })
    .on("img", {
      element(el) {
        if (firstImg.src) return;
        const src = el.getAttribute("src") || el.getAttribute("data-src");
        const w = parseInt(el.getAttribute("width") || "0", 10);
        if (src && !src.startsWith("data:") && !/logo|icon|sprite|avatar|\.svg(\?|$)/i.test(src) && (w === 0 || w >= 200)) firstImg.src = src;
      },
    });

  // Read only the first chunk of the document; metadata lives in <head>.
  const reader = rewriter.transform(new Response(limitStream(res.body, MAX_HTML_BYTES), { headers: res.headers })).body?.getReader();
  if (reader) {
    while (!(await reader.read()).done) {
      if (found.ogTitle && found.image && (found.ogDesc || found.desc) && titleText && icons.length) break;
    }
    reader.cancel().catch(() => {});
  }

  icons.sort((a, b) => b.score - a.score);
  const origin = new URL(finalUrl).origin;
  return {
    ...base,
    title: tidy(found.ogTitle || titleText, 300),
    description: tidy(found.ogDesc || found.desc, 600),
    image: resolve(found.image, finalUrl) ?? resolve(firstImg.src, finalUrl),
    favicon: resolve(icons[0]?.href, finalUrl) ?? `${origin}/favicon.ico`,
    siteName: tidy(found.siteName, 80),
  };
}

function limitStream(body: ReadableStream<Uint8Array> | null, max: number): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  let seen = 0;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done || seen >= max) {
        reader.cancel().catch(() => {});
        controller.close();
        return;
      }
      seen += value.byteLength;
      controller.enqueue(value);
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}
