import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Collection, Link, Me, Tag } from "../../shared/types";
import { api } from "./api";

export type Stats = Record<"total" | "unread" | "pinned" | "reminders" | "due" | "broken" | "archived" | "trash" | "forgotten" | "unsorted" | "shared" | "shared_new", number>;
export type UiLink = Link & { imageProxy: string | null };

interface Toast {
  id: number;
  text: string;
  tone?: "error" | "ok";
  action?: { label: string; run: () => void };
}

interface AppState {
  me: Me;
  setMe: (m: Me) => void;
  collections: Collection[];
  tags: Tag[];
  stats: Stats | null;
  domains: { domain: string; count: number }[];
  refresh: () => void;
  linksVersion: number;
  bumpLinks: () => void;
  patchLink: (l: UiLink) => void;
  onLinkPatched: (fn: (l: UiLink) => void) => () => void;
  toast: (text: string, opts?: Omit<Toast, "id" | "text">) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

let toastSeq = 0;

export function AppProvider({ me: initialMe, children }: { me: Me; children: ReactNode }) {
  const [me, setMe] = useState(initialMe);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [domains, setDomains] = useState<{ domain: string; count: number }[]>([]);
  const [linksVersion, setLinksVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const patchListeners = useRef(new Set<(l: UiLink) => void>());

  const refresh = useCallback(() => {
    api("/collections").then((r) => setCollections(r.items)).catch(() => {});
    api("/tags").then((r) => setTags(r.items)).catch(() => {});
    api("/stats").then(setStats).catch(() => {});
    api("/domains").then((r) => setDomains(r.items)).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => {
      if (document.visibilityState === "visible") {
        refresh();
        setLinksVersion((v) => v + 1);
      }
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [refresh]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (text: string, opts: Omit<Toast, "id" | "text"> = {}) => {
      const id = ++toastSeq;
      setToasts((t) => [...t.slice(-2), { id, text, ...opts }]);
      setTimeout(() => dismiss(id), opts.action ? 6000 : 3500);
    },
    [dismiss],
  );

  const value = useMemo<AppState>(
    () => ({
      me,
      setMe,
      collections,
      tags,
      stats,
      domains,
      refresh,
      linksVersion,
      bumpLinks: () => {
        setLinksVersion((v) => v + 1);
        refresh();
      },
      patchLink: (l) => patchListeners.current.forEach((fn) => fn(l)),
      onLinkPatched: (fn) => {
        patchListeners.current.add(fn);
        return () => patchListeners.current.delete(fn);
      },
      toast,
      toasts,
      dismiss,
    }),
    [me, collections, tags, stats, domains, refresh, linksVersion, toast, toasts, dismiss],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
