import { useEffect, useState } from "react";
import { titleOf } from "../lib/format";

function hue(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function Favicon({ src, domain, size = 16 }: { src: string | null; domain: string; size?: number }) {
  const sources = [src, `https://icons.duckduckgo.com/ip3/${domain}.ico`].filter(Boolean) as string[];
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [src, domain]);
  if (i >= sources.length) {
    return (
      <span className="favicon letter" style={{ width: size, height: size, fontSize: size * 0.62, background: `hsl(${hue(domain)} 45% 42%)` }} aria-hidden="true">
        {domain.charAt(0).toUpperCase()}
      </span>
    );
  }
  return <img className="favicon" src={sources[i]} width={size} height={size} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setI(i + 1)} />;
}

interface ThumbLink {
  image: string | null;
  imageProxy?: string | null;
  favicon: string | null;
  domain: string;
  title: string | null;
  url: string;
}

export function Thumb({ link, className = "" }: { link: ThumbLink; className?: string }) {
  // Direct first (free, no Worker request), proxy only when the site blocks hotlinking.
  const sources = [link.image, link.imageProxy].filter(Boolean) as string[];
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [link.image, link.imageProxy]);
  if (i >= sources.length) {
    const h = hue(link.domain);
    return (
      <div className={`thumb thumb-fallback ${className}`} style={{ background: `linear-gradient(135deg, hsl(${h} 38% 88%), hsl(${(h + 40) % 360} 42% 80%))` }}>
        <Favicon src={link.favicon} domain={link.domain} size={28} />
        <span className="thumb-domain">{link.domain}</span>
        <span className="thumb-title" aria-hidden="true">{titleOf(link)}</span>
      </div>
    );
  }
  return (
    <div className={`thumb ${className}`}>
      <img src={sources[i]} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setI(i + 1)} />
    </div>
  );
}
