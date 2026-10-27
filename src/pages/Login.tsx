import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useLocation } from "../lib/router";
import { Icon } from "../components/Icon";

function mailApp(email: string): { name: string; url: string } | null {
  const domain = email.split("@")[1] ?? "";
  if (/^(gmail|googlemail)\.com$/.test(domain)) return { name: "Gmail", url: "https://mail.google.com/mail/u/0/#search/from%3Ajanganlupa+newer_than%3A1d" };
  if (/^(outlook|hotmail|live|msn)\./.test(domain)) return { name: "Outlook", url: "https://outlook.live.com/mail/0/" };
  if (/^(yahoo|ymail)\./.test(domain)) return { name: "Yahoo Mail", url: "https://mail.yahoo.com/" };
  return null;
}

const RESEND_COOLDOWN = 5 * 60;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function Login({ onLoggedIn }: { onLoggedIn: (redirect: string) => void }) {
  const { params } = useLocation();
  const [email, setEmail] = useState(() => localStorage.getItem("jl:email") ?? "");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [dev, setDev] = useState<{ devLink?: string; devCode?: string } | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const redirect = params.get("next") || "/";

  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // The magic link tab can tell this tab that sign-in happened elsewhere.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === "jl:signed-in" && onLoggedIn(redirect);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [onLoggedIn, redirect]);

  const request = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api("/auth/request", { method: "POST", json: { email, redirect } });
      try {
        localStorage.setItem("jl:email", r.email);
      } catch {}
      setEmail(r.email);
      setSent(true);
      setCooldown(RESEND_COOLDOWN);
      setDev(r.devLink ? r : null);
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      // A link already went out recently (e.g. before a reload), so go straight to the "check your email" step.
      if (err instanceof ApiError && err.code === "login_cooldown") {
        setSent(true);
        setCooldown(Number(err.data?.retryAfter) || RESEND_COOLDOWN);
        setTimeout(() => codeRef.current?.focus(), 50);
        return;
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (value: string) => {
    setError(null);
    setBusy(true);
    try {
      const r = await api("/auth/code", { method: "POST", json: { email, code: value } });
      onLoggedIn(r.redirect || redirect);
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand"><span className="brand-mark"><Icon name="link" size={18} /></span>JanganLupa</div>
        {!sent ? (
          <form onSubmit={request} className="stack">
            <h1>Simpan link, ingat konteksnya.</h1>
            <p className="muted">Masuk atau daftar dengan email. Kami kirim link masuk, tanpa password.</p>
            <label className="field">
              <span>Email</span>
              <input className="input lg" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kamu@email.com" required autoFocus />
            </label>
            {error && <div className="notice error">{error}</div>}
            <button className="btn primary lg" disabled={busy}>{busy ? "Mengirim…" : "Kirim link masuk"}</button>
          </form>
        ) : (
          <div className="stack">
            <h1>Cek emailmu</h1>
            <p>Link masuk dikirim ke <b>{email}</b>. Buka di perangkat ini, atau ketik kode 6 digit dari email.</p>
            <div className="notice tip">
              <Icon name="inbox" size={18} />
              <span><b>Belum ada di kotak masuk?</b> Cek folder Spam, Promosi, atau Semua Email. Kalau ketemu di Spam, tandai "Bukan spam" supaya email berikutnya langsung masuk inbox.</span>
            </div>
            {mailApp(email) && (
              <div className="mail-apps">
                <a className="btn" href={mailApp(email)!.url} target="_blank" rel="noopener noreferrer"><Icon name="mail" size={16} />Buka {mailApp(email)!.name}</a>
              </div>
            )}
            <input
              ref={codeRef}
              className="input lg code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              placeholder="••••••"
              aria-label="Kode 6 digit"
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                if (v.length === 6) verifyCode(v);
              }}
            />
            {error && <div className="notice error">{error}</div>}
            {dev && (
              <div className="notice">
                Mode lokal: email tidak dikirim. <a href={dev.devLink}>Buka link masuk</a> atau pakai kode <b>{dev.devCode}</b>.
              </div>
            )}
            <p className="muted small">Link dan kode berlaku 15 menit.</p>
            <div className="row-between">
              <button className="link-btn" onClick={() => (setSent(false), setCode(""), setError(null), setCooldown(0))}>Ganti email</button>
              <button className="link-btn" disabled={cooldown > 0 || busy} onClick={() => request()}>{cooldown > 0 ? `Kirim ulang (${clock(cooldown)})` : "Kirim ulang"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Verify({ onLoggedIn }: { onLoggedIn: (redirect: string) => void }) {
  const { params } = useLocation();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState("");

  const go = async () => {
    setState("busy");
    try {
      const r = await api("/auth/verify", { method: "POST", json: { token } });
      try {
        localStorage.setItem("jl:signed-in", String(Date.now()));
      } catch {}
      onLoggedIn(r.redirect || "/");
    } catch (err) {
      setError((err as Error).message);
      setState("error");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card stack">
        <div className="brand"><span className="brand-mark"><Icon name="link" size={18} /></span>JanganLupa</div>
        {state === "error" ? (
          <>
            <h1>Link tidak bisa dipakai</h1>
            <div className="notice error">{error}</div>
            <a className="btn primary lg" href="/login">Minta link baru</a>
          </>
        ) : (
          <>
            <h1>Satu langkah lagi</h1>
            <p className="muted">Tekan tombol untuk masuk. Langkah ini mencegah link dipakai otomatis oleh pemindai email.</p>
            <button className="btn primary lg" onClick={go} disabled={!token || state === "busy"} autoFocus>
              {state === "busy" ? "Masuk…" : "Lanjut masuk"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
