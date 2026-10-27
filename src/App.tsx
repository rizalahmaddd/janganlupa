import { useCallback, useEffect, useState } from "react";
import type { Me } from "../shared/types";
import { Toasts } from "./components/Sheet";
import { DesktopLayout, MobileLayout, TabletLayout } from "./layouts/Layouts";
import { api, ApiError } from "./lib/api";
import { useLayout } from "./lib/hooks";
import { flushQueue } from "./lib/queue";
import { navigate, useLocation } from "./lib/router";
import { AppProvider, useApp } from "./lib/state";
import { AddPage } from "./pages/AddPage";
import { Login, Verify } from "./pages/Login";
import { PublicPage } from "./pages/PublicPage";

function applyTheme(theme: string | undefined) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
}

function Main() {
  const kind = useLayout();
  const { path } = useLocation();
  const { me, toasts, dismiss, bumpLinks, toast } = useApp();

  useEffect(() => applyTheme(me.settings.theme), [me.settings.theme]);

  useEffect(() => {
    const flush = () => flushQueue().then((n) => n && (toast(`${n} link offline berhasil dikirim`), bumpLinks()));
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [bumpLinks, toast]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    location.href = "/login";
  }, []);

  return (
    <>
      {path === "/add" ? <AddPage /> : kind === "desktop" ? <DesktopLayout onLogout={logout} /> : kind === "tablet" ? <TabletLayout onLogout={logout} /> : <MobileLayout onLogout={logout} />}
      <Toasts items={toasts} dismiss={dismiss} />
    </>
  );
}

export function App() {
  const { path } = useLocation();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "anon" | "error">("loading");

  const loadMe = useCallback(() => {
    setState("loading");
    api<Me>("/me")
      .then((m) => {
        setMe(m);
        applyTheme(m.settings.theme);
        setState("ready");
      })
      .catch((e) => setState(e instanceof ApiError && e.status === 401 ? "anon" : "error"));
  }, []);

  const isPublic = path.startsWith("/s/") || path === "/auth/verify";

  useEffect(() => {
    if (!isPublic) loadMe();
  }, [isPublic, loadMe]);

  useEffect(() => {
    const on = () => setState("anon");
    window.addEventListener("jl:unauthorized", on);
    return () => window.removeEventListener("jl:unauthorized", on);
  }, []);

  useEffect(() => {
    if (state === "anon" && path !== "/login") {
      const next = location.pathname + location.search;
      navigate(`/login${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`, { replace: true });
    }
    if (state === "ready" && path === "/login") navigate("/", { replace: true });
  }, [state, path]);

  const onLoggedIn = useCallback(
    (redirect: string) => {
      navigate(redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/", { replace: true });
      loadMe();
    },
    [loadMe],
  );

  if (path.startsWith("/s/")) return <PublicPage slug={path.slice(3)} />;
  if (path === "/auth/verify") return <Verify onLoggedIn={onLoggedIn} />;
  if (state === "anon" || path === "/login") return state === "loading" ? <Splash /> : <Login onLoggedIn={onLoggedIn} />;
  if (state === "error")
    return (
      <div className="auth-page">
        <div className="auth-card stack">
          <h1>Tidak bisa terhubung</h1>
          <p className="muted">Periksa koneksi internetmu, lalu coba lagi.</p>
          <button className="btn primary" onClick={loadMe}>Coba lagi</button>
        </div>
      </div>
    );
  if (state === "loading" || !me) return <Splash />;
  return (
    <AppProvider me={me}>
      <Main />
    </AppProvider>
  );
}

function Splash() {
  return <div className="center-fill"><span className="spinner" /></div>;
}
