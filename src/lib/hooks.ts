import { useEffect, useRef, useState } from "react";

export type LayoutKind = "desktop" | "tablet" | "mobile";

function layoutNow(): LayoutKind {
  const w = window.innerWidth;
  return w >= 1200 ? "desktop" : w >= 768 ? "tablet" : "mobile";
}

export function useLayout(): LayoutKind {
  const [kind, setKind] = useState(layoutNow);
  useEffect(() => {
    const on = () => setKind(layoutNow());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return kind;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      if (e.key === "Escape") return ref.current.Escape?.(e);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const fn = ref.current[e.key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [enabled]);
}

export function storage<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
