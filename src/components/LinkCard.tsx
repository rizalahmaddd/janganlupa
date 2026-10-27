import { memo, useRef } from "react";
import { FEATURES } from "../../shared/features";
import { ago, colorOf, titleOf } from "../lib/format";
import { useApp, type UiLink } from "../lib/state";
import { api } from "../lib/api";
import { Icon } from "./Icon";
import { Favicon, Thumb } from "./Thumb";

export type ViewMode = "grid" | "list" | "compact";

export function trackOpen(id: string) {
  fetch(`/api/links/${id}/open`, { method: "POST", keepalive: true, credentials: "same-origin" }).catch(() => {});
}

function Badges({ link }: { link: UiLink }) {
  const { collections } = useApp();
  const col = link.collectionId ? collections.find((c) => c.id === link.collectionId) : null;
  return (
    <>
      {link.shareNew && <span className="badge new">Baru</span>}
      {link.pinned && link.mine && <span className="badge pin" title="Disematkan"><Icon name="pin" size={12} /></span>}
      {link.mine && link.shareCount > 0 && <span className="badge soft" title={`Dibagikan ke ${link.shareCount} orang`}><Icon name="users" size={12} />{link.shareCount}</span>}
      {!link.mine && link.sharedBy && <span className="badge soft" title={`Dari ${link.sharedBy}`}>dari {link.sharedBy.split("@")[0]}</span>}
      {link.status === "broken" && <span className="badge danger">Rusak</span>}
      {link.status === "pending" && <span className="badge soft">Memuat…</span>}
      {FEATURES.reminders && link.remindAt && <span className={`badge ${link.remindAt <= Date.now() ? "warn" : "soft"}`}><Icon name="bell" size={12} />{link.remindAt <= Date.now() ? "Waktunya" : ago(link.remindAt)}</span>}
      {col && (
        <span className="badge col" style={{ ["--c" as string]: colorOf(col.color) }}>
          {col.name}
        </span>
      )}
    </>
  );
}

export const LinkCard = memo(function LinkCard({
  link,
  mode,
  selected,
  active,
  selecting,
  onSelect,
  onToggle,
}: {
  link: UiLink;
  mode: ViewMode;
  selected: boolean;
  active: boolean;
  selecting: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, range: boolean) => void;
}) {
  const { patchLink, toast } = useApp();
  const title = titleOf(link);
  const unread = !link.readAt && link.mine;

  const togglePin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const r = await api(`/links/${link.id}`, { method: "PATCH", json: { pinned: !link.pinned } });
      patchLink(r.link);
    } catch (err) {
      toast((err as Error).message, { tone: "error" });
    }
  };

  const check = (
    <label className="select-box" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={selected} onChange={(e) => onToggle(link.id, (e.nativeEvent as MouseEvent).shiftKey)} aria-label={`Pilih ${title}`} />
    </label>
  );

  const open = (
    <a
      className="icon-btn open-btn"
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title="Buka link"
      aria-label={`Buka ${title}`}
      onClick={(e) => {
        e.stopPropagation();
        trackOpen(link.id);
      }}
    >
      <Icon name="external" size={16} />
    </a>
  );

  const press = useRef<{ timer: number; fired: boolean; x: number; y: number } | null>(null);
  const onClick = (e: React.MouseEvent) => {
    if (press.current?.fired) {
      press.current = null;
      return;
    }
    if (selecting || e.shiftKey) onToggle(link.id, e.shiftKey);
    else onSelect(link.id);
  };
  // Long-press on touch starts multi-select, since phones have no hover checkbox or shift key.
  const touch = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const p = { timer: 0, fired: false, x: e.clientX, y: e.clientY };
      p.timer = window.setTimeout(() => {
        p.fired = true;
        navigator.vibrate?.(15);
        onToggle(link.id, false);
      }, 480);
      press.current = p;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = press.current;
      if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) clearTimeout(p.timer);
    },
    onPointerUp: () => press.current && !press.current.fired && clearTimeout(press.current.timer),
    onPointerCancel: () => press.current && clearTimeout(press.current.timer),
    onContextMenu: (e: React.MouseEvent) => press.current?.fired && e.preventDefault(),
  };

  const cls = `card card-${mode}${active ? " active" : ""}${selected ? " selected" : ""}${unread ? " unread" : ""}`;

  if (mode === "compact") {
    return (
      <article className={cls} onClick={onClick} data-id={link.id} {...touch}>
        {check}
        <Favicon src={link.favicon} domain={link.domain} />
        <div className="card-main">
          <h3 className="card-title">{title}</h3>
          <span className="card-domain">{link.domain}</span>
        </div>
        <div className="card-badges"><Badges link={link} /></div>
        <time className="card-time">{ago(link.createdAt)}</time>
        {open}
      </article>
    );
  }

  return (
    <article className={cls} onClick={onClick} data-id={link.id} {...touch}>
      <div className="card-media">
        <Thumb link={link} />
        {check}
        {link.mine && (
          <button className={`icon-btn pin-btn${link.pinned ? " on" : ""}`} onClick={togglePin} aria-label={link.pinned ? "Lepas sematan" : "Sematkan"} title={link.pinned ? "Lepas sematan" : "Sematkan"}>
            <Icon name="pin" size={15} />
          </button>
        )}
      </div>
      <div className="card-body">
        <div className="card-meta">
          <Favicon src={link.favicon} domain={link.domain} size={14} />
          <span className="card-domain">{link.siteName || link.domain}</span>
          <span className="dot" />
          <time className="card-time" title={new Date(link.createdAt).toLocaleString("id-ID")}>{ago(link.createdAt)}</time>
        </div>
        <h3 className="card-title">{title}</h3>
        {link.note ? <p className="card-note">{link.note}</p> : link.description ? <p className="card-desc">{link.description}</p> : null}
        <div className="card-foot">
          <div className="card-badges"><Badges link={link} /></div>
          {link.tags.length > 0 && (
            <div className="card-tags">
              {link.tags.slice(0, 4).map((t) => <span key={t}>#{t}</span>)}
              {link.tags.length > 4 && <span>+{link.tags.length - 4}</span>}
            </div>
          )}
        </div>
      </div>
      {open}
    </article>
  );
});
