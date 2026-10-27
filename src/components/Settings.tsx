import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { useApp } from "../lib/state";
import { Icon } from "./Icon";

function deviceName(ua: string) {
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Perangkat";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} · ${os}`;
}

export function Settings({ onLogout }: { onLogout: () => void }) {
  const { me, setMe, toast, bumpLinks } = useApp();
  const [name, setName] = useState(me.name ?? "");
  const [sessions, setSessions] = useState<{ id: string; userAgent: string; lastSeenAt: number; current: boolean }[]>([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bookmarklet = `javascript:(()=>{const u=encodeURIComponent(location.href),t=encodeURIComponent(document.title),s=encodeURIComponent(String(getSelection()||'').slice(0,500));window.open('${location.origin}/add?url='+u+'&title='+t+'&text='+s+'&popup=1','janganlupa','width=520,height=640')})()`;
  const bmRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    api("/sessions").then((r) => setSessions(r.items)).catch(() => {});
    // React refuses javascript: hrefs, so the bookmarklet is set directly on the element.
    bmRef.current?.setAttribute("href", bookmarklet);
  }, [bookmarklet]);

  const saveSettings = async (patch: Record<string, unknown>) => {
    try {
      setMe(await api("/me", { method: "PATCH", json: patch }));
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
  };

  const importFile = async (file: File) => {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api("/import", { method: "POST", body: fd });
      toast(`${r.added} link diimpor${r.duplicates ? `, ${r.duplicates} duplikat dilewati` : ""}. Thumbnail dimuat bertahap.`);
      bumpLinks();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const revoke = async (id: string) => {
    await api(`/sessions/${id}`, { method: "DELETE" }).catch(() => {});
    setSessions((s) => (id === "others" ? s.filter((x) => x.current) : s.filter((x) => x.id !== id)));
  };

  const deleteAccount = async () => {
    const confirmEmail = prompt(`Semua link, koleksi, dan tag akan dihapus permanen.\nKetik emailmu (${me.email}) untuk konfirmasi:`);
    if (confirmEmail === null) return;
    try {
      await api("/me", { method: "DELETE", json: { confirm: confirmEmail.trim().toLowerCase() } });
      onLogout();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
  };

  return (
    <div className="settings stack">
      <section>
        <h3>Akun</h3>
        <p className="muted">Masuk sebagai <b>{me.email}</b></p>
        <label className="field">
          <span>Nama tampilan <span className="muted">· terlihat saat kamu berbagi koleksi</span></span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== (me.name ?? "") && saveSettings({ name })} placeholder="Namamu" />
        </label>
      </section>

      <section>
        <h3>Tampilan</h3>
        <div className="field">
          <span>Tema</span>
          <div className="seg">
            {(["system", "light", "dark"] as const).map((t) => (
              <button key={t} className={(me.settings.theme ?? "system") === t ? "on" : ""} onClick={() => saveSettings({ settings: { theme: t } })}>
                {t === "system" ? "Ikut sistem" : t === "light" ? "Terang" : "Gelap"}
              </button>
            ))}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={me.settings.digest !== false} onChange={(e) => saveSettings({ settings: { digest: e.target.checked } })} />
          Kirim email saat pengingat jatuh tempo
        </label>
      </section>

      <section>
        <h3>Simpan dari mana saja</h3>
        <p className="muted small">Seret tombol ini ke bookmark bar browser. Klik saat membuka halaman apa pun untuk langsung menyimpannya.</p>
        <a ref={bmRef} className="btn bookmarklet" onClick={(e) => e.preventDefault()} draggable>
          <Icon name="plus" size={16} />Simpan ke JanganLupa
        </a>
        <p className="muted small">Di HP: buka menu browser → <b>Tambahkan ke layar utama</b>. Setelah terpasang, JanganLupa muncul di menu <b>Bagikan</b> (Android).</p>
      </section>

      <section>
        <h3>Impor & ekspor</h3>
        <p className="muted small">Impor bookmark dari Chrome, Firefox, Safari, Edge (file .html), JSON dari aplikasi lain, atau file teks berisi link. Folder bookmark menjadi tag.</p>
        <div className="row-wrap">
          <input ref={fileRef} type="file" accept=".html,.htm,.json,.txt,.csv,text/html,application/json,text/plain" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          <button className="btn" disabled={importing} onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} />{importing ? "Mengimpor…" : "Impor file"}</button>
          <a className="btn" href="/api/export?format=html" download><Icon name="download" size={16} />HTML</a>
          <a className="btn" href="/api/export?format=json" download><Icon name="download" size={16} />JSON</a>
          <a className="btn" href="/api/export?format=csv" download><Icon name="download" size={16} />CSV</a>
        </div>
      </section>

      <section>
        <h3>Perangkat yang masuk</h3>
        <ul className="sessions">
          {sessions.map((s) => (
            <li key={s.id}>
              <span className="grow">
                {deviceName(s.userAgent)} {s.current && <span className="badge soft">perangkat ini</span>}
                <span className="muted small block">aktif {ago(s.lastSeenAt)}</span>
              </span>
              {!s.current && <button className="btn sm" onClick={() => revoke(s.id)}>Keluarkan</button>}
            </li>
          ))}
        </ul>
        {sessions.length > 1 && <button className="link-btn" onClick={() => revoke("others")}>Keluarkan semua perangkat lain</button>}
      </section>

      <section className="row-between">
        <button className="btn" onClick={onLogout}><Icon name="logout" size={16} />Keluar</button>
        <button className="link-btn danger" onClick={deleteAccount}>Hapus akun</button>
      </section>
    </div>
  );
}
