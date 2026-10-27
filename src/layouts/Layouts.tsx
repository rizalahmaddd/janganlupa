import { useRef, useState } from "react";
import type { Collection } from "../../shared/types";
import { AddLink } from "../components/AddLink";
import { CollectionDialog } from "../components/CollectionDialog";
import { Icon } from "../components/Icon";
import { LinkDetail } from "../components/LinkDetail";
import { LinkList } from "../components/LinkList";
import { Nav, type Filters } from "../components/Nav";
import { Settings } from "../components/Settings";
import { Sheet } from "../components/Sheet";
import { useHotkeys } from "../lib/hooks";
import { setParams } from "../lib/router";
import { useApp } from "../lib/state";
import { OfflineBanner, SearchBox, Toolbar, useShell, type Shell } from "./shell";

type SheetVariant = "dialog" | "bottom";

function Dialogs({ shell, variant, onLogout }: { shell: Shell; variant: SheetVariant; onLogout: () => void }) {
  return (
    <>
      <Sheet open={shell.addOpen} onClose={() => shell.setAddOpen(false)} title="Simpan link" variant={variant}>
        <AddLink initial={shell.addInitial} defaultCollection={shell.collection && shell.collection.role !== "viewer" ? shell.collection.id : null} onDone={() => shell.setAddOpen(false)} onOpen={(id) => shell.select(id)} />
      </Sheet>
      <CollectionDialog
        open={shell.collectionDialog.open}
        collection={shell.collectionDialog.collection}
        variant={variant}
        onClose={() => shell.setCollectionDialog({ open: false, collection: null })}
        onCreated={(id) => shell.go({ c: id, view: "all", t: null, d: null })}
      />
      <Sheet open={shell.settingsOpen} onClose={() => shell.setSettingsOpen(false)} title="Pengaturan" variant={variant} wide>
        <Settings onLogout={onLogout} />
      </Sheet>
    </>
  );
}

function navProps(shell: Shell, after?: () => void) {
  return {
    filters: shell.filters,
    go: (f: Partial<Filters>) => {
      shell.go(f);
      after?.();
    },
    onNewCollection: () => {
      shell.setCollectionDialog({ open: true, collection: null });
      after?.();
    },
    onManage: (c: Collection) => {
      shell.setCollectionDialog({ open: true, collection: c });
      after?.();
    },
    onSettings: () => {
      shell.setSettingsOpen(true);
      after?.();
    },
  };
}

function Brand() {
  return (
    <a className="brand" href="/" onClick={(e) => (e.preventDefault(), setParams({ view: null, c: null, t: null, d: null, q: null, link: null, sort: null }))}>
      <span className="brand-mark"><Icon name="link" size={16} /></span>JanganLupa
    </a>
  );
}

function openSelected(id: string | null) {
  if (id) document.querySelector<HTMLAnchorElement>(`[data-id="${id}"] a.open-btn`)?.click();
}

export function DesktopLayout({ onLogout }: { onLogout: () => void }) {
  const shell = useShell("desktop");
  const searchRef = useRef<HTMLInputElement>(null);
  const anyDialog = shell.addOpen || shell.settingsOpen || shell.collectionDialog.open;

  useHotkeys(
    {
      "/": () => searchRef.current?.focus(),
      n: () => shell.setAddOpen(true),
      j: () => shell.move(1),
      k: () => shell.move(-1),
      o: () => openSelected(shell.linkId),
      Escape: () => !anyDialog && shell.linkId && shell.select(null),
    },
    !anyDialog,
  );

  return (
    <div className={`desk${shell.linkId ? " with-detail" : ""}`}>
      <aside className="desk-side">
        <Brand />
        <button className="btn primary block" onClick={() => shell.setAddOpen(true)}>
          <Icon name="plus" />Simpan link <kbd>N</kbd>
        </button>
        <Nav {...navProps(shell)} />
      </aside>
      <main className="desk-main">
        <div className="desk-top">
          <SearchBox inputRef={searchRef} />
          <span className="hint muted small"><kbd>/</kbd> cari · <kbd>J</kbd><kbd>K</kbd> pindah · <kbd>O</kbd> buka</span>
        </div>
        <OfflineBanner />
        <Toolbar shell={shell} />
        <LinkList query={shell.query} mode={shell.mode} activeId={shell.linkId} onSelect={shell.select} onItems={shell.setIds} onAdd={() => shell.setAddOpen(true)} />
      </main>
      {shell.linkId && (
        <aside className="desk-detail">
          <LinkDetail id={shell.linkId} onClose={() => shell.select(null)} onNavigate={shell.select} />
        </aside>
      )}
      <Dialogs shell={shell} variant="dialog" onLogout={onLogout} />
    </div>
  );
}

export function TabletLayout({ onLogout }: { onLogout: () => void }) {
  const shell = useShell("tablet");
  const [drawer, setDrawer] = useState(false);
  const { stats } = useApp();
  const rail = [
    { id: "all", icon: "home", label: "Semua" },
    { id: "shared", icon: "users", label: "Dibagikan", badge: stats?.shared_new },
    { id: "lupa", icon: "sparkle", label: "Terlupa" },
    { id: "pinned", icon: "pin", label: "Sematan" },
  ];
  const isView = (id: string) => !shell.filters.c && !shell.filters.t && !shell.filters.d && shell.filters.view === id;

  useHotkeys({ "/": () => document.querySelector<HTMLInputElement>(".tab-main .search-box input")?.focus(), n: () => shell.setAddOpen(true) }, !shell.addOpen && !drawer);

  return (
    <div className="tab">
      <aside className="tab-rail">
        <button className="rail-btn" onClick={() => setDrawer(true)} aria-label="Buka menu">
          <Icon name="menu" size={22} />
          <span>Menu</span>
        </button>
        <button className="rail-add" onClick={() => shell.setAddOpen(true)} aria-label="Simpan link"><Icon name="plus" size={24} /></button>
        {rail.map((r) => (
          <button key={r.id} className={`rail-btn${isView(r.id) ? " active" : ""}`} onClick={() => shell.go({ view: r.id, c: null, t: null, d: null })}>
            <Icon name={r.icon} size={22} />
            <span>{r.label}</span>
            {!!r.badge && <i className="rail-badge">{r.badge}</i>}
          </button>
        ))}
        <div className="grow" />
        <button className="rail-btn" onClick={() => shell.setSettingsOpen(true)} aria-label="Pengaturan"><Icon name="settings" size={22} /><span>Atur</span></button>
      </aside>
      <main className="tab-main">
        <div className="tab-top">
          <Brand />
          <SearchBox />
        </div>
        <OfflineBanner />
        <Toolbar shell={shell} />
        <LinkList query={shell.query} mode={shell.mode} activeId={shell.linkId} onSelect={shell.select} onItems={shell.setIds} onAdd={() => shell.setAddOpen(true)} />
      </main>
      <Sheet open={drawer} onClose={() => setDrawer(false)} variant="drawer" title={<Brand />}>
        <Nav {...navProps(shell, () => setDrawer(false))} />
      </Sheet>
      <Sheet open={!!shell.linkId} onClose={() => shell.select(null)} variant="side">
        {shell.linkId && <LinkDetail id={shell.linkId} onClose={() => shell.select(null)} onNavigate={shell.select} />}
      </Sheet>
      <Dialogs shell={shell} variant="dialog" onLogout={onLogout} />
    </div>
  );
}

export function MobileLayout({ onLogout }: { onLogout: () => void }) {
  const shell = useShell("mobile");
  const [menu, setMenu] = useState(false);
  const [searching, setSearching] = useState(!!shell.q);
  const { stats } = useApp();
  const isView = (id: string) => !shell.filters.c && !shell.filters.t && !shell.filters.d && !shell.q && shell.filters.view === id;

  const tabs = [
    { id: "all", icon: "home", label: "Beranda", run: () => (setSearching(false), shell.go({ view: "all", c: null, t: null, d: null })) },
    { id: "search", icon: "search", label: "Cari", run: () => setSearching(true) },
    { id: "add", icon: "plus", label: "Simpan", run: () => shell.setAddOpen(true) },
    { id: "lupa", icon: "sparkle", label: "Terlupa", run: () => (setSearching(false), shell.go({ view: "lupa", c: null, t: null, d: null })) },
    { id: "menu", icon: "menu", label: "Menu", run: () => setMenu(true) },
  ];

  return (
    <div className="mob">
      <header className="mob-top">
        {searching ? (
          <div className="mob-search">
            <SearchBox autoFocus={!shell.q} onCancel={() => setSearching(false)} />
            <button className="link-btn" onClick={() => (setSearching(false), setParams({ q: null }))}>Batal</button>
          </div>
        ) : (
          <div className="mob-bar">
            <Brand />
            <div className="grow" />
            <button className={`icon-btn badge-host${isView("shared") ? " on" : ""}`} onClick={() => (setSearching(false), shell.go({ view: "shared", c: null, t: null, d: null }))} aria-label={`Dibagikan ke saya${stats?.shared_new ? `, ${stats.shared_new} baru` : ""}`} title="Dibagikan ke saya">
              <Icon name="users" />
              {!!stats?.shared_new && <i className="dot-badge">{stats.shared_new}</i>}
            </button>
            <button className="icon-btn" onClick={() => setSearching(true)} aria-label="Cari"><Icon name="search" /></button>
          </div>
        )}
      </header>
      <OfflineBanner />
      <main className="mob-main">
        <Toolbar shell={shell} compact />
        <LinkList query={shell.query} mode={shell.mode === "grid" ? "grid" : shell.mode} activeId={shell.linkId} onSelect={shell.select} onItems={shell.setIds} onAdd={() => shell.setAddOpen(true)} />
      </main>
      <nav className="mob-tabs" aria-label="Navigasi utama">
        {tabs.map((t) => (
          <button key={t.id} className={`${t.id === "add" ? "tab-add" : ""}${(t.id === "search" && searching) || (t.id !== "search" && !searching && isView(t.id)) ? " active" : ""}`} onClick={t.run}>
            <span className="tab-icon"><Icon name={t.icon} size={t.id === "add" ? 24 : 22} /></span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <Sheet open={menu} onClose={() => setMenu(false)} variant="bottom" title="Menu">
        <Nav {...navProps(shell, () => setMenu(false))} />
      </Sheet>
      <Sheet open={!!shell.linkId} onClose={() => shell.select(null)} variant="bottom">
        {shell.linkId && <LinkDetail id={shell.linkId} onClose={() => shell.select(null)} onNavigate={shell.select} />}
      </Sheet>
      <Dialogs shell={shell} variant="bottom" onLogout={onLogout} />
    </div>
  );
}
