import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp, type UiLink } from "../lib/state";
import { Icon } from "./Icon";
import { LinkCard, type ViewMode } from "./LinkCard";
import { Sheet } from "./Sheet";
import { TagInput } from "./TagInput";

export interface ListQuery {
  view: string;
  collection?: string | null;
  tag?: string | null;
  domain?: string | null;
  q?: string | null;
  sort?: string | null;
}

const EMPTY: Record<string, { title: string; text: string }> = {
  all: { title: "Belum ada link", text: "Simpan link pertamamu. Tempel URL, atau pakai bookmarklet dan tombol Bagikan di HP." },
  pinned: { title: "Belum ada yang disematkan", text: "Sematkan link yang sering kamu buka supaya selalu di atas." },
  unread: { title: "Semua sudah dibuka", text: "Link yang belum pernah kamu buka akan muncul di sini." },
  reminders: { title: "Tidak ada pengingat", text: "Pasang pengingat di link mana pun, nanti dikirim lewat email." },
  archive: { title: "Arsip kosong", text: "Arsipkan link yang sudah selesai supaya daftar utama tetap rapi." },
  trash: { title: "Sampah kosong", text: "Link yang dihapus disimpan di sini 30 hari sebelum hilang permanen." },
  broken: { title: "Tidak ada link rusak", text: "Kami cek link secara berkala. Yang tidak bisa dibuka lagi akan muncul di sini." },
  shared: { title: "Belum ada yang dibagikan ke kamu", text: "Kalau teman membagikan link atau koleksi ke emailmu, semuanya muncul di sini." },
  lupa: { title: "Tidak ada yang terlupa", text: "Link yang disimpan lebih dari 2 minggu dan belum pernah dibuka akan muncul di sini." },
  collection: { title: "Koleksi ini masih kosong", text: "Simpan link langsung ke sini, atau pilih beberapa link lalu pakai Pindah ke…" },
  search: { title: "Tidak ketemu", text: "Coba kata lain: judul, catatan, nama situs, atau tag." },
};

function toParams(q: ListQuery, cursor?: string | null) {
  const p = new URLSearchParams();
  p.set("view", q.view);
  if (q.collection) p.set("collection", q.collection);
  if (q.tag) p.set("tag", q.tag);
  if (q.domain) p.set("domain", q.domain);
  if (q.q) p.set("q", q.q);
  if (q.sort) p.set("sort", q.sort);
  if (cursor) p.set("cursor", cursor);
  return p.toString();
}

export function LinkList({ query, mode, activeId, onSelect, onItems, onAdd }: { query: ListQuery; mode: ViewMode; activeId: string | null; onSelect: (id: string) => void; onItems?: (ids: string[]) => void; onAdd?: () => void }) {
  const { linksVersion, onLinkPatched, toast, bumpLinks, collections } = useApp();
  const [items, setItems] = useState<UiLink[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagSheet, setTagSheet] = useState(false);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const lastToggled = useRef<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const key = toParams(query);
  const reqId = useRef(0);

  const load = useCallback(
    async (cursor: string | null) => {
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const r = await api(`/links?${toParams(query, cursor)}`);
        if (id !== reqId.current) return;
        setItems((prev) => (cursor ? [...prev, ...r.items.filter((x: UiLink) => !prev.some((p) => p.id === x.id))] : r.items));
        setNext(r.next);
      } catch (e) {
        if (id === reqId.current) setError((e as Error).message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [key],
  );

  useEffect(() => {
    load(null);
  }, [load, linksVersion]);

  useEffect(() => setSelected(new Set()), [key]);
  useEffect(() => onItems?.(items.map((i) => i.id)), [items, onItems]);

  useEffect(
    () => onLinkPatched((l) => setItems((prev) => prev.map((p) => (p.id === l.id ? l : p)))),
    [onLinkPatched],
  );

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && !loading && load(next), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, loading, load]);

  // Metadata is fetched in the background after saving; poll briefly so thumbnails appear without a reload.
  const pendingIds = items.filter((i) => i.status === "pending").map((i) => i.id).join(",");
  useEffect(() => {
    if (!pendingIds) return;
    let tries = 0;
    const timer = setInterval(async () => {
      if (++tries > 6) return clearInterval(timer);
      for (const id of pendingIds.split(",")) {
        try {
          const r = await api(`/links/${id}`);
          if (r.link.status !== "pending") setItems((prev) => prev.map((p) => (p.id === id ? r.link : p)));
        } catch {}
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [pendingIds]);

  const toggle = useCallback(
    (id: string, range: boolean) => {
      setSelected((prev) => {
        const s = new Set(prev);
        if (range && lastToggled.current) {
          const ids = items.map((i) => i.id);
          const [a, b] = [ids.indexOf(lastToggled.current), ids.indexOf(id)].sort((x, y) => x - y);
          if (a >= 0 && b >= 0) ids.slice(a, b + 1).forEach((x) => s.add(x));
        } else if (s.has(id)) s.delete(id);
        else s.add(id);
        lastToggled.current = id;
        return s;
      });
    },
    [items],
  );

  const bulk = async (action: string, value?: unknown) => {
    const ids = [...selected];
    try {
      await api("/links/batch", { method: "POST", json: { ids, action, value } });
      setSelected(new Set());
      bumpLinks();
      const label: Record<string, string> = { archive: "diarsipkan", unarchive: "dikembalikan", delete: "dipindah ke sampah", restore: "dipulihkan", purge: "dihapus permanen", pin: "disematkan", unpin: "dilepas", move: "dipindahkan", tag: "diberi tag", read: "ditandai dibuka" };
      toast(`${ids.length} link ${label[action] ?? "diperbarui"}`, action === "delete" ? { action: { label: "Urungkan", run: () => api("/links/batch", { method: "POST", json: { ids, action: "restore" } }).then(bumpLinks) } } : {});
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
  };

  const emptyKey = query.q ? "search" : query.collection && query.view === "all" ? "collection" : query.view;
  const writable = collections.filter((c) => c.role !== "viewer");

  return (
    <div className="list-wrap">
      {selected.size > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Aksi untuk link terpilih">
          <button className="icon-btn" onClick={() => setSelected(new Set())} aria-label="Batal pilih"><Icon name="x" /></button>
          <strong>{selected.size} dipilih</strong>
          <button className="link-btn" onClick={() => setSelected(new Set(items.filter((i) => i.mine).map((i) => i.id)))}>Pilih semua</button>
          <div className="bulk-actions">
            {query.view === "trash" ? (
              <>
                <button className="btn sm" onClick={() => bulk("restore")}>Pulihkan</button>
                <button className="btn sm danger" onClick={() => confirm(`Hapus permanen ${selected.size} link? Tidak bisa dibatalkan.`) && bulk("purge")}>Hapus permanen</button>
              </>
            ) : (
              <>
                <button className="btn sm" onClick={() => bulk("pin")}><Icon name="pin" size={15} />Sematkan</button>
                <button className="btn sm" onClick={() => (setBulkTags([]), setTagSheet(true))}><Icon name="tag" size={15} />Tag</button>
                <select className="btn sm" value="" onChange={(e) => e.target.value && bulk("move", e.target.value === "__none" ? null : e.target.value)} aria-label="Pindah ke koleksi">
                  <option value="">Pindah ke…</option>
                  <option value="__none">Tanpa koleksi</option>
                  {writable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {query.view === "archive" ? (
                  <button className="btn sm" onClick={() => bulk("unarchive")}>Keluarkan</button>
                ) : (
                  <button className="btn sm" onClick={() => bulk("archive")}><Icon name="archive" size={15} />Arsip</button>
                )}
                <button className="btn sm danger" onClick={() => bulk("delete")}><Icon name="trash" size={15} />Hapus</button>
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="notice error">
          {error} <button className="link-btn" onClick={() => load(null)}>Coba lagi</button>
        </div>
      )}

      {!loading && !error && items.length === 0 ? (
        <div className="empty">
          <Icon name={query.q ? "search" : query.view === "trash" ? "trash" : "link"} size={36} />
          <h3>{EMPTY[emptyKey]?.title ?? EMPTY.all.title}</h3>
          <p>{EMPTY[emptyKey]?.text ?? EMPTY.all.text}</p>
          {onAdd && (query.view === "all" || query.collection) && !query.q && (
            <button className="btn primary" onClick={onAdd}><Icon name="plus" />Simpan link</button>
          )}
        </div>
      ) : (
        <div className={`links links-${mode}${loading && !items.length ? " skeleton" : ""}`}>
          {items.length === 0 && loading
            ? Array.from({ length: 8 }, (_, i) => <div key={i} className={`card card-${mode} ghost`} />)
            : items.map((l) => (
                <LinkCard key={l.id} link={l} mode={mode} selected={selected.has(l.id)} active={l.id === activeId} selecting={selected.size > 0} onSelect={onSelect} onToggle={toggle} />
              ))}
        </div>
      )}
      <div ref={sentinel} className="sentinel">{loading && items.length > 0 && <span className="spinner" />}</div>

      <Sheet
        open={tagSheet}
        onClose={() => setTagSheet(false)}
        title={`Beri tag ${selected.size} link`}
        footer={
          <>
            <button className="btn" onClick={() => setTagSheet(false)}>Batal</button>
            <button className="btn primary" disabled={!bulkTags.length} onClick={() => (bulk("tag", bulkTags), setTagSheet(false))}>Tambahkan</button>
          </>
        }
      >
        <TagInput value={bulkTags} onChange={setBulkTags} />
      </Sheet>
    </div>
  );
}
