import { useCallback, useEffect, useState } from "react";
import { FEATURES } from "../../shared/features";
import type { Collection } from "../../shared/types";
import { Icon } from "../components/Icon";
import type { ViewMode } from "../components/LinkCard";
import type { ListQuery } from "../components/LinkList";
import { MORE_VIEWS, VIEWS, type Filters } from "../components/Nav";
import { storage, store, useDebounced, useOnline, type LayoutKind } from "../lib/hooks";
import { api } from "../lib/api";
import { colorOf } from "../lib/format";
import { queued } from "../lib/queue";
import { setParams, useLocation } from "../lib/router";
import { useApp } from "../lib/state";

export function useShell(kind: LayoutKind) {
  const { params } = useLocation();
  const { collections } = useApp();
  const filters: Filters = { view: params.get("view") || "all", c: params.get("c"), t: params.get("t"), d: params.get("d") };
  const q = params.get("q") || "";
  const sort = params.get("sort");
  const linkId = params.get("link");
  const [mode, setModeState] = useState<ViewMode>(() => storage(`jl:mode:${kind}`, kind === "desktop" ? "list" : kind === "tablet" ? "grid" : "list"));
  const [addOpen, setAddOpenState] = useState(params.get("add") === "1");
  const [addInitial, setAddInitial] = useState<{ url?: string; bulk?: string } | undefined>();
  const setAddOpen = useCallback((open: boolean, initial?: { url?: string; bulk?: string }) => {
    setAddInitial(open ? initial : undefined);
    setAddOpenState(open);
  }, []);
  const [collectionDialog, setCollectionDialog] = useState<{ open: boolean; collection: Collection | null }>({ open: false, collection: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => setModeState(storage(`jl:mode:${kind}`, kind === "tablet" ? "grid" : "list")), [kind]);
  useEffect(() => {
    if (params.get("add") === "1") {
      setAddOpen(true);
      setParams({ add: null }, { replace: true });
    }
  }, [params]);

  const anyOpen = addOpen || settingsOpen || collectionDialog.open;
  useEffect(() => {
    const fromText = (text: string) => {
      const urls = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
      if (urls.length > 1) return { bulk: text };
      if (urls.length === 1) return { url: urls[0] };
      const t = text.trim();
      return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) && !t.includes(" ") ? { url: t } : null;
    };
    const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
    // Pasting or dropping a link anywhere on the page opens the save form with it filled in.
    const onPaste = (e: ClipboardEvent) => {
      if (anyOpen || typing(e.target) || document.querySelector(".sheet-root")) return;
      const found = fromText(e.clipboardData?.getData("text") ?? "");
      if (found) {
        e.preventDefault();
        setAddOpen(true, found);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.some((t) => t === "text/uri-list" || t === "text/plain")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const text = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "";
      const found = fromText(text.split("\n").filter((l) => !l.startsWith("#")).join("\n"));
      if (found && !anyOpen) {
        e.preventDefault();
        setAddOpen(true, found);
      }
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [anyOpen, setAddOpen]);

  const setMode = (m: ViewMode) => {
    setModeState(m);
    store(`jl:mode:${kind}`, m);
  };

  const go = useCallback((f: Partial<Filters>) => {
    setParams({ view: f.view === "all" ? null : f.view, c: f.c, t: f.t, d: f.d, q: null, link: null });
    window.scrollTo({ top: 0 });
  }, []);

  const select = useCallback((id: string | null) => setParams({ link: id }, { replace: !!id && !!new URL(location.href).searchParams.get("link") }), []);

  const collection = filters.c && filters.c !== "none" ? collections.find((c) => c.id === filters.c) ?? null : null;
  const viewInfo = [...VIEWS, ...MORE_VIEWS].find((v) => v.id === filters.view);
  const title = q ? `Hasil “${q}”` : collection ? collection.name : filters.c === "none" ? "Tanpa koleksi" : filters.t ? `#${filters.t}` : filters.d ? filters.d : viewInfo?.label ?? "Semua link";

  const query: ListQuery = { view: filters.view, collection: filters.c, tag: filters.t, domain: filters.d, q: q || null, sort };

  const move = (dir: 1 | -1) => {
    if (!ids.length) return;
    const i = linkId ? ids.indexOf(linkId) : -1;
    const next = ids[Math.max(0, Math.min(ids.length - 1, i + dir))];
    select(next);
    document.querySelector(`[data-id="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };

  return {
    filters, q, sort, linkId, mode, setMode, go, select, title, query, collection, ids, setIds, move,
    addOpen, setAddOpen, addInitial, collectionDialog, setCollectionDialog, settingsOpen, setSettingsOpen,
  };
}

export type Shell = ReturnType<typeof useShell>;

export function SearchBox({ inputRef, autoFocus, onCancel }: { inputRef?: React.RefObject<HTMLInputElement | null>; autoFocus?: boolean; onCancel?: () => void }) {
  const { params } = useLocation();
  const [text, setText] = useState(params.get("q") ?? "");
  const debounced = useDebounced(text, 300);
  useEffect(() => {
    const q = debounced.trim();
    if (q === (new URL(location.href).searchParams.get("q") ?? "")) return;
    // Search is global on purpose: people search because they forgot where they put it.
    const scope = q ? { c: null, t: null, d: null, view: null } : {};
    setParams({ q: q || null, link: null, ...scope }, { replace: !!new URL(location.href).searchParams.get("q") });
  }, [debounced]);
  useEffect(() => {
    const q = params.get("q") ?? "";
    if (q !== text.trim()) setText(q);
  }, [params.get("q")]);

  return (
    <div className="search-box">
      <Icon name="search" />
      <input
        ref={inputRef}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setText("");
            (e.target as HTMLInputElement).blur();
            onCancel?.();
          }
        }}
        placeholder="Cari judul, catatan, situs, #tag…"
        aria-label="Cari link"
        autoFocus={autoFocus}
        enterKeyHint="search"
      />
      {text && <button className="icon-btn sm" onClick={() => setText("")} aria-label="Hapus pencarian"><Icon name="x" size={14} /></button>}
    </div>
  );
}

export function Toolbar({ shell, compact }: { shell: Shell; compact?: boolean }) {
  const { stats } = useApp();
  const { filters, q, sort, mode, setMode, title, collection } = shell;
  const sortValue = sort ?? (q ? "relevance" : filters.view === "reminders" ? "remind" : filters.view === "lupa" ? "shuffle" : "new");
  return (
    <div className="toolbar">
      <div className="toolbar-title">
        <h1>{title}</h1>
        {collection && collection.role !== "owner" && <span className="badge soft">dari {collection.ownerEmail}</span>}
        {filters.view === "lupa" && !q && <p className="muted small">Disimpan lebih dari 2 minggu lalu dan belum pernah dibuka. Buka, arsipkan, atau hapus.</p>}
        {filters.view === "shared" && !q && <SharedCollections onOpen={(id) => shell.go({ c: id, view: "all", t: null, d: null })} />}
        {FEATURES.reminders && filters.view === "all" && !filters.c && !filters.t && !filters.d && !q && stats && stats.due > 0 && (
          <button className="notice-pill warn" onClick={() => shell.go({ view: "reminders" })}><Icon name="bell" size={14} />{stats.due} pengingat jatuh tempo</button>
        )}
      </div>
      <div className="toolbar-tools">
        {(filters.t || filters.d) && (
          <button className="chip on" onClick={() => shell.go({ view: "all" })}>
            {filters.t ? `#${filters.t}` : filters.d}
            <Icon name="x" size={12} />
          </button>
        )}
        {collection && (
          <button className="btn sm" onClick={() => shell.setCollectionDialog({ open: true, collection })}>
            <Icon name={collection.role === "owner" ? "share" : "users"} size={15} />{compact ? "" : collection.role === "owner" ? "Bagikan" : "Info"}
          </button>
        )}
        {filters.view !== "lupa" && (
          <select className="btn sm" value={sortValue} onChange={(e) => setParams({ sort: ["relevance", "shuffle"].includes(e.target.value) ? null : e.target.value })} aria-label="Urutkan">
            {q && <option value="relevance">Paling cocok</option>}
            {FEATURES.reminders && filters.view === "reminders" && <option value="remind">Pengingat terdekat</option>}
            <option value="new">Terbaru</option>
            <option value="old">Terlama</option>
            <option value="opened">Terakhir dibuka</option>
            <option value="popular">Paling sering dibuka</option>
            <option value="title">Judul A–Z</option>
          </select>
        )}
        <div className="seg sm" role="group" aria-label="Tampilan">
          {(["grid", "list", "compact"] as const).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)} aria-label={m === "grid" ? "Kartu" : m === "list" ? "Daftar" : "Ringkas"} title={m === "grid" ? "Kartu" : m === "list" ? "Daftar" : "Ringkas"}>
              <Icon name={m === "grid" ? "grid" : m === "list" ? "list" : "rows"} size={15} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SharedCollections({ onOpen }: { onOpen: (id: string) => void }) {
  const { collections, refresh } = useApp();
  const shared = collections.filter((c) => c.role !== "owner");
  useEffect(() => {
    // Mark as seen after the view has rendered with its "baru" markers.
    const t = setTimeout(() => api("/shared/seen", { method: "POST" }).then(refresh).catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, [refresh]);
  return (
    <div className="shared-head">
      <p className="muted small">Link dan koleksi yang dibagikan orang lain ke emailmu. Buka, simpan ke link-mu, atau edit kalau diberi akses.</p>
      {shared.length > 0 && (
        <div className="shared-cols">
          {shared.map((c) => (
            <button key={c.id} className="shared-col" onClick={() => onOpen(c.id)}>
              <span className="col-dot lg" style={{ background: colorOf(c.color) }} />
              <span className="grow">
                <b>{c.name}</b>
                <span className="muted small block">{c.ownerEmail} · {c.linkCount} link · {c.role === "editor" ? "bisa edit" : "lihat"}</span>
              </span>
              {c.isNew && <span className="badge new">Baru</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  const [pending, setPending] = useState(queued().length);
  useEffect(() => {
    const on = () => setPending(queued().length);
    window.addEventListener("jl:queue", on);
    return () => window.removeEventListener("jl:queue", on);
  }, []);
  if (online && !pending) return null;
  return (
    <div className="offline">
      <Icon name="wifiOff" size={15} />
      {online ? `Mengirim ${pending} link yang disimpan saat offline…` : `Offline. ${pending ? `${pending} link menunggu dikirim. ` : ""}Link baru tetap bisa disimpan.`}
    </div>
  );
}
