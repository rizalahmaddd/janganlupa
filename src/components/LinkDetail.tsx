import { useEffect, useRef, useState } from "react";
import { FEATURES } from "../../shared/features";
import { api } from "../lib/api";
import { ago, colorOf, fullDate, titleOf } from "../lib/format";
import { setParams } from "../lib/router";
import { useApp, type UiLink } from "../lib/state";
import { Icon } from "./Icon";
import { trackOpen } from "./LinkCard";
import { useLayout } from "../lib/hooks";
import { PeopleShare } from "./PeopleShare";
import { ReminderPicker } from "./ReminderPicker";
import { Sheet } from "./Sheet";
import { TagInput } from "./TagInput";
import { Favicon, Thumb } from "./Thumb";

export function LinkDetail({ id, onClose, onNavigate }: { id: string; onClose: () => void; onNavigate: (id: string) => void }) {
  const { patchLink, toast, bumpLinks, collections, refresh, onLinkPatched, me } = useApp();
  const [link, setLink] = useState<UiLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [related, setRelated] = useState<UiLink[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const kind = useLayout();

  useEffect(() => {
    let alive = true;
    setLink(null);
    setError(null);
    setEditing(false);
    api(`/links/${id}`)
      .then((r) => alive && setLink(r.link))
      .catch((e) => alive && setError(e.message));
    api(`/links/${id}/related`)
      .then((r) => alive && setRelated(r.items))
      .catch(() => alive && setRelated([]));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => onLinkPatched((l) => l.id === id && setLink(l)), [id, onLinkPatched]);

  useEffect(() => {
    if (link?.status !== "pending") return;
    const t = setTimeout(() => api(`/links/${id}`).then((r) => (setLink(r.link), patchLink(r.link))).catch(() => {}), 2500);
    return () => clearTimeout(t);
  }, [link, id, patchLink]);

  const save = async (patch: Record<string, unknown>, msg?: string) => {
    try {
      const r = await api(`/links/${id}`, { method: "PATCH", json: patch });
      setLink(r.link);
      patchLink(r.link);
      if ("collectionId" in patch || "tags" in patch || "archived" in patch || "pinned" in patch || "remindAt" in patch) refresh();
      if (msg) toast(msg);
      return true;
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
      return false;
    }
  };

  if (error) {
    return (
      <div className="detail">
        <div className="detail-top"><button className="icon-btn" onClick={onClose} aria-label="Tutup"><Icon name="x" /></button></div>
        <div className="empty"><h3>Tidak bisa membuka link</h3><p>{error}</p></div>
      </div>
    );
  }
  if (!link) return <div className="detail"><div className="detail-loading"><span className="spinner" /></div></div>;

  const canOwner = link.mine;
  const trash = !!link.deletedAt;
  const title = titleOf(link);
  const writable = collections.filter((c) => c.role !== "viewer");
  const col = collections.find((c) => c.id === link.collectionId);

  const remove = async () => {
    setBusy(true);
    try {
      if (trash) {
        if (!confirm("Hapus permanen? Link ini tidak bisa dikembalikan.")) return;
        await api(`/links/${id}?permanent=1`, { method: "DELETE" });
        toast("Dihapus permanen");
      } else {
        await api(`/links/${id}`, { method: "DELETE" });
        toast("Dipindah ke sampah", { action: { label: "Urungkan", run: () => api(`/links/${id}/restore`, { method: "POST" }).then(bumpLinks) } });
      }
      bumpLinks();
      onClose();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    try {
      await api(`/links/${id}/restore`, { method: "POST" });
      toast("Link dipulihkan");
      bumpLinks();
      onClose();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
  };

  const refetch = async () => {
    setBusy(true);
    try {
      const r = await api(`/links/${id}/refresh`, { method: "POST" });
      setLink(r.link);
      patchLink(r.link);
      toast(r.link.status === "ok" ? "Info halaman diperbarui" : r.link.status === "broken" ? "Halaman sepertinya sudah tidak ada" : "Situs tidak bisa dibaca, tapi link tetap tersimpan");
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      toast("Link disalin");
    } catch {
      prompt("Salin link ini:", link.url);
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title, url: link.url });
    } catch {}
  };

  const saveCopy = async () => {
    try {
      const r = await api(`/links/${id}/copy`, { method: "POST" });
      toast(r.duplicate ? "Link ini sudah ada di link-mu" : "Disimpan ke link-mu", { action: { label: "Lihat", run: () => onNavigate(r.link.id) } });
      bumpLinks();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
  };

  const leaveShare = async () => {
    try {
      await api(`/links/${id}/shares/${encodeURIComponent(me.email)}`, { method: "DELETE" });
      toast("Dihapus dari Dibagikan ke saya");
      bumpLinks();
      onClose();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
  };

  return (
    <div className="detail">
      <div className="detail-top">
        <button className="icon-btn" onClick={onClose} aria-label="Tutup"><Icon name="x" /></button>
        <div className="grow" />
        {canOwner && !trash && (
          <>
            <button className={`icon-btn${link.pinned ? " on" : ""}`} onClick={() => save({ pinned: !link.pinned })} title={link.pinned ? "Lepas sematan" : "Sematkan"} aria-label="Sematkan"><Icon name="pin" /></button>
            <button className="icon-btn" onClick={() => save({ archived: !link.archivedAt }, link.archivedAt ? "Dikeluarkan dari arsip" : "Diarsipkan").then((ok) => ok && bumpLinks())} title={link.archivedAt ? "Keluarkan dari arsip" : "Arsipkan"} aria-label="Arsipkan"><Icon name="archive" /></button>
          </>
        )}
        {link.canEdit && !trash && <button className="icon-btn" onClick={refetch} disabled={busy} title="Ambil ulang judul & gambar" aria-label="Perbarui info"><Icon name="refresh" /></button>}
        {canOwner && <button className="icon-btn danger" onClick={remove} disabled={busy} title={trash ? "Hapus permanen" : "Hapus"} aria-label="Hapus"><Icon name="trash" /></button>}
      </div>

      <div className="detail-scroll">
        <a className="detail-thumb" href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => trackOpen(link.id)}>
          <Thumb link={link} />
        </a>

        {trash && (
          <div className="notice">Link ini ada di sampah dan akan dihapus otomatis 30 hari setelah dihapus. <button className="link-btn" onClick={restore}>Pulihkan</button></div>
        )}
        {link.status === "broken" && (
          <div className="notice error">
            Halaman ini sepertinya sudah tidak bisa dibuka{link.httpStatus ? ` (HTTP ${link.httpStatus})` : ""}.{" "}
            <a href={`https://web.archive.org/web/*/${link.url}`} target="_blank" rel="noopener noreferrer">Cari di Wayback Machine</a>
          </div>
        )}
        {!link.mine && link.sharedBy && (
          <div className="notice shared-by">
            <Icon name="users" size={16} />
            <span className="grow">Dibagikan oleh <b>{link.sharedBy}</b> · {link.canEdit ? "kamu bisa mengedit" : "hanya lihat"}</span>
          </div>
        )}
        {link.status === "failed" && <div className="notice">Situs tidak mengizinkan kami membaca judulnya. Kamu bisa mengisi judul sendiri.</div>}

        {editing ? (
          <EditFields link={link} onCancel={() => setEditing(false)} onSave={async (p) => (await save(p, "Tersimpan")) && setEditing(false)} />
        ) : (
          <>
            <div className="detail-site">
              <Favicon src={link.favicon} domain={link.domain} />
              <button className="link-btn" onClick={() => setParams({ d: link.domain, view: null, c: null, t: null, q: null })} title="Lihat semua dari situs ini">{link.siteName || link.domain}</button>
            </div>
            <h2 className="detail-title">{title}</h2>
            {link.description && <p className="detail-desc">{link.description}</p>}
            <div className="detail-url">
              <span title={link.url}>{link.url}</span>
            </div>
          </>
        )}

        <div className="detail-actions">
          <a className="btn primary" href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => trackOpen(link.id)}><Icon name="external" size={16} />Buka</a>
          <button className="btn" onClick={copy}><Icon name="copy" size={16} />Salin</button>
          {canOwner && !trash ? (
            <button className="btn" onClick={() => setShareOpen(true)}><Icon name="users" size={16} />Bagikan{link.shareCount ? ` · ${link.shareCount}` : ""}</button>
          ) : !link.mine ? (
            <button className="btn" onClick={saveCopy}><Icon name="plus" size={16} />Simpan ke link saya</button>
          ) : null}
          {link.canEdit && !editing && <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={16} />Edit</button>}
        </div>
        {link.shareRole && (
          <button className="link-btn muted-link" onClick={leaveShare}>Hapus dari "Dibagikan ke saya"</button>
        )}

        <Sheet open={shareOpen} onClose={() => setShareOpen(false)} title={`Bagikan "${title.length > 40 ? title.slice(0, 39) + "…" : title}"`} variant={kind === "mobile" ? "bottom" : "dialog"} wide>
          <PeopleShare base={`/links/${id}/shares`} withMessage onChange={() => api(`/links/${id}`).then((r) => (setLink(r.link), patchLink(r.link)))} />
          {"share" in navigator && (
            <div className="share-other">
              <button className="btn" onClick={nativeShare}><Icon name="share" size={16} />Kirim lewat aplikasi lain</button>
            </div>
          )}
        </Sheet>

        <section className="field">
          <label>Catatan · kenapa kamu simpan ini?</label>
          <NoteField value={link.note ?? ""} disabled={!link.canEdit || trash} onSave={(note) => save({ note })} />
        </section>

        <section className="field">
          <label>Tag</label>
          <TagInput value={link.tags} disabled={!link.canEdit || trash} onChange={(tags) => save({ tags })} />
        </section>

        {(canOwner || col) && <section className="field">
          <label>Koleksi</label>
          {canOwner && !trash ? (
            <select className="input" value={link.collectionId ?? ""} onChange={(e) => save({ collectionId: e.target.value || null }, "Dipindahkan")}>
              <option value="">Tanpa koleksi</option>
              {writable.map((c) => <option key={c.id} value={c.id}>{c.name}{c.role !== "owner" ? ` (milik ${c.ownerEmail})` : ""}</option>)}
            </select>
          ) : (
            <p className="muted">{col ? <span className="badge col" style={{ ["--c" as string]: colorOf(col.color) }}>{col.name}</span> : "Tanpa koleksi"}</p>
          )}
        </section>}

        {FEATURES.reminders && canOwner && !trash && (
          <section className="field">
            <label>Ingatkan saya</label>
            <ReminderPicker value={link.remindAt} onChange={(remindAt) => save({ remindAt }, remindAt ? "Pengingat dipasang" : "Pengingat dihapus")} />
          </section>
        )}

        <dl className="detail-facts">
          <div><dt>Disimpan</dt><dd title={fullDate(link.createdAt)}>{ago(link.createdAt)}</dd></div>
          <div><dt>Dibuka</dt><dd>{link.openCount ? `${link.openCount}× · terakhir ${ago(link.lastOpenedAt)}` : "Belum pernah"}</dd></div>
          {!link.mine && <div><dt>Pemilik</dt><dd>{link.sharedBy ?? "Anggota koleksi"}</dd></div>}
          {link.contentType && link.contentType !== "text/html" && <div><dt>Tipe</dt><dd>{link.contentType}</dd></div>}
        </dl>

        {related.length > 0 && (
          <section className="related">
            <h4>Masih berkaitan</h4>
            {related.map((r) => (
              <button key={r.id} className="related-item" onClick={() => onNavigate(r.id)}>
                <Favicon src={r.favicon} domain={r.domain} />
                <span className="related-title">{titleOf(r)}</span>
                <span className="muted">{r.domain}</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function NoteField({ value, onSave, disabled }: { value: string; onSave: (v: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(value);
  const saved = useRef(value);
  useEffect(() => {
    setText(value);
    saved.current = value;
  }, [value]);
  const commit = () => {
    if (text !== saved.current) {
      saved.current = text;
      onSave(text);
    }
  };
  return (
    <textarea
      className="input note"
      rows={3}
      value={text}
      disabled={disabled}
      placeholder={disabled ? "Tidak ada catatan" : "Misal: referensi untuk proyek X, dikirim oleh Budi, baca sebelum rapat…"}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && (e.currentTarget as HTMLTextAreaElement).blur()}
    />
  );
}

function EditFields({ link, onSave, onCancel }: { link: UiLink; onSave: (p: Record<string, unknown>) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(link.title ?? "");
  const [description, setDescription] = useState(link.description ?? "");
  const [url, setUrl] = useState(link.url);
  const [image, setImage] = useState(link.image ?? "");
  return (
    <form
      className="edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        const p: Record<string, unknown> = {};
        if (title !== (link.title ?? "")) p.title = title;
        if (description !== (link.description ?? "")) p.description = description;
        if (image !== (link.image ?? "")) p.image = image || null;
        if (url !== link.url && link.mine) p.url = url;
        Object.keys(p).length ? onSave(p) : onCancel();
      }}
    >
      <label>Judul<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={link.domain} autoFocus /></label>
      {link.mine && <label>URL<input className="input" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" /></label>}
      <label>Deskripsi<textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label>URL gambar thumbnail<input className="input" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…/gambar.jpg (kosongkan untuk otomatis)" inputMode="url" /></label>
      <div className="row-end">
        <button type="button" className="btn" onClick={onCancel}>Batal</button>
        <button className="btn primary">Simpan</button>
      </div>
    </form>
  );
}
