import { useState } from "react";
import type { Collection } from "../../shared/types";
import { FEATURES } from "../../shared/features";
import { colorOf } from "../lib/format";
import { useApp } from "../lib/state";
import { Icon } from "./Icon";

export interface Filters {
  view: string;
  c: string | null;
  t: string | null;
  d: string | null;
}

export const VIEWS = [
  { id: "all", label: "Semua link", icon: "home", stat: "total" },
  { id: "shared", label: "Dibagikan ke saya", icon: "users", stat: "shared_new" },
  { id: "lupa", label: "Terlupakan", icon: "sparkle", stat: "forgotten" },
  ...(FEATURES.reminders ? [{ id: "reminders", label: "Pengingat", icon: "bell", stat: "due" }] : []),
  { id: "pinned", label: "Disematkan", icon: "pin", stat: "pinned" },
  { id: "unread", label: "Belum dibuka", icon: "inbox", stat: "unread" },
] as { id: string; label: string; icon: string; stat: string }[];

export const MORE_VIEWS = [
  { id: "broken", label: "Link rusak", icon: "alert", stat: "broken" },
  { id: "archive", label: "Arsip", icon: "archive", stat: "archived" },
  { id: "trash", label: "Sampah", icon: "trash", stat: "trash" },
] as { id: string; label: string; icon: string; stat: string }[];

export function Nav({ filters, go, onNewCollection, onManage, onSettings, compact }: { filters: Filters; go: (f: Partial<Filters>) => void; onNewCollection: () => void; onManage: (c: Collection) => void; onSettings: () => void; compact?: boolean }) {
  const { stats, collections, tags, domains } = useApp();
  const [allTags, setAllTags] = useState(false);
  const own = collections.filter((c) => c.role === "owner");
  const shared = collections.filter((c) => c.role !== "owner");
  const isView = (id: string) => !filters.c && !filters.t && !filters.d && filters.view === id;
  const count = (k: string) => (stats ? (stats as Record<string, number>)[k] : 0);

  const item = (key: string, active: boolean, onClick: () => void, icon: React.ReactNode, label: string, n?: number, extra?: React.ReactNode, tone?: string) => (
    <li key={key}>
      <button className={`nav-item${active ? " active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined} title={compact ? label : undefined}>
        {icon}
        <span className="nav-label">{label}</span>
        {!!n && <span className={`nav-count${tone ? " " + tone : ""}`}>{n}</span>}
        {extra}
      </button>
    </li>
  );

  return (
    <nav className={`nav${compact ? " compact" : ""}`} aria-label="Navigasi">
      <ul>
        {VIEWS.map((v) => item(v.id, isView(v.id), () => go({ view: v.id, c: null, t: null, d: null }), <Icon name={v.icon} />, v.label, count(v.stat), undefined, v.id === "reminders" && count("due") ? "warn" : v.id === "shared" && count("shared_new") ? "new" : undefined))}
      </ul>

      <div className="nav-section">
        <span>Koleksi</span>
        <button className="icon-btn sm" onClick={onNewCollection} aria-label="Koleksi baru" title="Koleksi baru"><Icon name="plus" size={16} /></button>
      </div>
      <ul>
        {own.length === 0 && !compact && <li className="nav-hint">Kelompokkan link per proyek, topik, atau orang.</li>}
        {own.map((c) =>
          item(
            c.id,
            filters.c === c.id,
            () => go({ c: c.id, view: "all", t: null, d: null }),
            <span className="col-dot" style={{ background: colorOf(c.color) }} />,
            c.name,
            c.linkCount,
            c.memberCount > 0 || c.publicSlug ? <Icon name="users" size={14} className="muted" /> : undefined,
          ),
        )}
        {own.length > 0 && item("none", filters.c === "none", () => go({ c: "none", view: "all", t: null, d: null }), <Icon name="inbox" />, "Tanpa koleksi", count("unsorted"))}
      </ul>

      {shared.length > 0 && (
        <>
          <div className="nav-section"><span>Koleksi dari orang lain</span></div>
          <ul>
            {shared.map((c) => item(c.id, filters.c === c.id, () => go({ c: c.id, view: "all", t: null, d: null }), <span className="col-dot ring" style={{ borderColor: colorOf(c.color) }} />, c.name, c.linkCount, c.isNew ? <span className="new-dot" title="Baru dibagikan" /> : <span className="muted role">{c.role === "editor" ? "edit" : "lihat"}</span>))}
          </ul>
        </>
      )}

      {tags.length > 0 && !compact && (
        <>
          <div className="nav-section"><span>Tag</span></div>
          <div className="tag-cloud">
            {(allTags ? tags : tags.slice(0, 16)).map((t) => (
              <button key={t.id} className={`chip${filters.t === t.name ? " on" : ""}`} onClick={() => go({ t: filters.t === t.name ? null : t.name, c: null, d: null, view: "all" })}>
                #{t.name} <span className="muted">{t.count}</span>
              </button>
            ))}
            {tags.length > 16 && <button className="link-btn" onClick={() => setAllTags(!allTags)}>{allTags ? "Lebih sedikit" : `+${tags.length - 16} lagi`}</button>}
          </div>
        </>
      )}

      {domains.length > 1 && !compact && (
        <details className="nav-domains">
          <summary className="nav-section"><span>Situs</span></summary>
          <ul>
            {domains.slice(0, 12).map((d) => item(d.domain, filters.d === d.domain, () => go({ d: d.domain, c: null, t: null, view: "all" }), <Icon name="globe" size={16} />, d.domain, d.count))}
          </ul>
        </details>
      )}

      <ul className="nav-bottom">
        {MORE_VIEWS.map((v) => item(v.id, isView(v.id), () => go({ view: v.id, c: null, t: null, d: null }), <Icon name={v.icon} />, v.label, count(v.stat), undefined, v.id === "broken" && count("broken") ? "danger" : undefined))}
        {item("settings", false, onSettings, <Icon name="settings" />, "Pengaturan")}
      </ul>
      {filters.c && collections.find((c) => c.id === filters.c) && !compact && (
        <button className="btn sm nav-manage" onClick={() => onManage(collections.find((c) => c.id === filters.c)!)}>
          <Icon name="share" size={15} />Kelola & bagikan koleksi
        </button>
      )}
    </nav>
  );
}
