import { useEffect, useState } from "react";
import type { Collection } from "../../shared/types";
import { api } from "../lib/api";
import { COLLECTION_COLORS } from "../lib/format";
import { useApp } from "../lib/state";
import { Icon } from "./Icon";
import { PeopleShare } from "./PeopleShare";
import { Sheet } from "./Sheet";

export function CollectionDialog({ open, collection, onClose, onCreated, variant }: { open: boolean; collection: Collection | null; onClose: () => void; onCreated?: (id: string) => void; variant: "dialog" | "bottom" }) {
  const { refresh, toast, bumpLinks } = useApp();
  const [name, setName] = useState("");
  const [color, setColor] = useState("teal");
  const [busy, setBusy] = useState(false);
  const isOwner = !collection || collection.role === "owner";

  useEffect(() => {
    if (open) {
      setName(collection?.name ?? "");
      setColor(collection?.color ?? "teal");
    }
  }, [open, collection]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (collection) {
        await api(`/collections/${collection.id}`, { method: "PATCH", json: { name, color } });
        toast("Koleksi diperbarui");
      } else {
        const r = await api("/collections", { method: "POST", json: { name, color } });
        toast("Koleksi dibuat");
        onCreated?.(r.item.id);
      }
      refresh();
      if (!collection) onClose();
    } catch (err) {
      toast((err as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!collection) return;
    if (!confirm(`Hapus koleksi "${collection.name}" dan pindahkan link-mu di dalamnya ke sampah? Link anggota lain tetap milik mereka.`)) return;
    try {
      await api(`/collections/${collection.id}?links=delete`, { method: "DELETE" });
      toast("Koleksi dihapus");
      refresh();
      bumpLinks();
      onClose();
    } catch (err) {
      toast((err as Error).message, { tone: "error" });
    }
  };

  const keepLinksRemove = async () => {
    if (!collection || !confirm(`Hapus koleksi "${collection.name}" tapi simpan semua link-nya (pindah ke "Tanpa koleksi")?`)) return;
    try {
      await api(`/collections/${collection.id}`, { method: "DELETE" });
      toast("Koleksi dihapus, link tetap aman");
      refresh();
      bumpLinks();
      onClose();
    } catch (err) {
      toast((err as Error).message, { tone: "error" });
    }
  };

  const leave = async () => {
    if (!collection || !confirm(`Keluar dari koleksi "${collection.name}"? Kamu tidak akan bisa melihatnya lagi kecuali diundang ulang.`)) return;
    try {
      await api(`/collections/${collection.id}/leave`, { method: "POST" });
      toast("Kamu keluar dari koleksi");
      refresh();
      onClose();
    } catch (err) {
      toast((err as Error).message, { tone: "error" });
    }
  };

  return (
    <Sheet open={open} onClose={onClose} variant={variant} title={collection ? collection.name : "Koleksi baru"} wide={!!collection}>
      {isOwner ? (
        <form className="stack" onSubmit={save}>
          <label className="field">
            <span>Nama</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Misal: Riset skripsi, Resep, Kerjaan" maxLength={60} autoFocus={!collection} required />
          </label>
          <div className="field">
            <span>Warna</span>
            <div className="swatches">
              {Object.entries(COLLECTION_COLORS).map(([k, v]) => (
                <button type="button" key={k} className={`swatch${color === k ? " on" : ""}`} style={{ background: v }} onClick={() => setColor(k)} aria-label={k} aria-pressed={color === k} />
              ))}
            </div>
          </div>
          <div className="row-end">
            <button className="btn primary" disabled={busy || !name.trim()}>{collection ? "Simpan" : "Buat koleksi"}</button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <p>Dibagikan oleh <b>{collection!.ownerEmail}</b>. Kamu bisa {collection!.role === "editor" ? "menambah dan mengedit link" : "melihat link"} di koleksi ini.</p>
          <div className="row-end"><button className="btn danger" onClick={leave}>Keluar dari koleksi</button></div>
        </div>
      )}

      {collection && isOwner && <SharePanel collection={collection} />}

      {collection && isOwner && (
        <div className="danger-zone">
          <button className="btn" onClick={keepLinksRemove}>Hapus koleksi saja</button>
          <button className="btn danger" onClick={remove}>Hapus beserta link</button>
        </div>
      )}
    </Sheet>
  );
}

function SharePanel({ collection }: { collection: Collection }) {
  const { toast, refresh } = useApp();
  const [slug, setSlug] = useState<string | null>(collection.publicSlug);
  useEffect(() => setSlug(collection.publicSlug), [collection.id, collection.publicSlug]);

  const setPublic = async (body: Record<string, unknown>) => {
    try {
      const r = await api(`/collections/${collection.id}/public`, { method: "POST", json: body });
      setSlug(r.slug);
      refresh();
      if (r.slug && body.regenerate) toast("Link lama tidak berlaku lagi");
    } catch (err) {
      toast((err as Error).message, { tone: "error" });
    }
  };

  const publicUrl = slug ? `${location.origin}/s/${slug}` : "";

  return (
    <section className="share">
      <h3><Icon name="users" size={18} />Bagikan ke orang lain</h3>
      <PeopleShare base={`/collections/${collection.id}/members`} onChange={refresh} />

      <h3><Icon name="globe" size={18} />Link publik</h3>
      {slug ? (
        <>
          <div className="public-link">
            <input className="input" readOnly value={publicUrl} onFocus={(e) => e.target.select()} />
            <button className="btn" onClick={() => navigator.clipboard.writeText(publicUrl).then(() => toast("Link publik disalin"), () => prompt("Salin:", publicUrl))}><Icon name="copy" size={16} />Salin</button>
          </div>
          <div className="row-between">
            <button className="link-btn" onClick={() => setPublic({ regenerate: true })}>Buat link baru</button>
            <button className="link-btn danger" onClick={() => setPublic({ enabled: false })}>Matikan link publik</button>
          </div>
        </>
      ) : (
        <div className="row-between">
          <p className="muted small">Siapa pun yang punya link bisa melihat isi koleksi (tanpa catatan pribadi), tanpa perlu login.</p>
          <button className="btn" onClick={() => setPublic({ enabled: true })}>Aktifkan</button>
        </div>
      )}
    </section>
  );
}
