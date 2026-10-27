import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ago, colorOf, titleOf } from "../lib/format";
import { Icon } from "../components/Icon";
import { Favicon, Thumb } from "../components/Thumb";

interface PublicLink {
  id: string;
  url: string;
  domain: string;
  title: string | null;
  description: string | null;
  image: string | null;
  imageProxy: string | null;
  favicon: string | null;
  tags: string[];
  createdAt: number;
}

export function PublicPage({ slug }: { slug: string }) {
  const [data, setData] = useState<{ collection: { name: string; color: string | null; owner: string | null }; items: PublicLink[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api(`/public/${slug}`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  useEffect(() => {
    if (data) document.title = `${data.collection.name} · JanganLupa`;
  }, [data]);

  if (error) return <div className="auth-page"><div className="auth-card stack"><h1>Tidak ditemukan</h1><p className="muted">{error}</p><a className="btn primary" href="/">Ke JanganLupa</a></div></div>;
  if (!data) return <div className="center-fill"><span className="spinner" /></div>;

  const needle = q.trim().toLowerCase();
  const items = needle ? data.items.filter((l) => `${l.title} ${l.url} ${l.description} ${l.tags.join(" ")}`.toLowerCase().includes(needle)) : data.items;

  return (
    <div className="public">
      <header className="public-head">
        <a className="brand" href="/"><span className="brand-mark"><Icon name="link" size={16} /></span>JanganLupa</a>
        <div>
          <h1><span className="col-dot lg" style={{ background: colorOf(data.collection.color) }} />{data.collection.name}</h1>
          <p className="muted">{data.items.length} link{data.collection.owner ? ` · dikurasi oleh ${data.collection.owner}` : ""}</p>
        </div>
        <div className="search-box"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari di koleksi ini" /></div>
      </header>
      <div className="links links-grid">
        {items.map((l) => (
          <a key={l.id} className="card card-grid" href={l.url} target="_blank" rel="noopener noreferrer">
            <div className="card-media"><Thumb link={l} /></div>
            <div className="card-body">
              <div className="card-meta"><Favicon src={l.favicon} domain={l.domain} size={14} /><span className="card-domain">{l.domain}</span><span className="dot" /><span className="card-time">{ago(l.createdAt)}</span></div>
              <h3 className="card-title">{titleOf(l)}</h3>
              {l.description && <p className="card-desc">{l.description}</p>}
              {l.tags.length > 0 && <div className="card-tags">{l.tags.slice(0, 4).map((t) => <span key={t}>#{t}</span>)}</div>}
            </div>
          </a>
        ))}
      </div>
      <footer className="public-foot"><a href="/login">Simpan link-mu sendiri dengan JanganLupa →</a></footer>
    </div>
  );
}
