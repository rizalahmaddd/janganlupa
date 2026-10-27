import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
window.addEventListener("popstate", notify);

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const snapshot = () => location.pathname + location.search;

export function useLocation() {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, location.origin);
  return { path: url.pathname, params: url.searchParams };
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === snapshot()) return;
  history[opts.replace ? "replaceState" : "pushState"](null, "", to);
  notify();
}

export function setParams(patch: Record<string, string | null | undefined>, opts: { replace?: boolean } = {}) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  navigate(url.pathname + url.search, opts);
}
