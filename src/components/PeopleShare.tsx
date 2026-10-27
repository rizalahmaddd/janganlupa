import { useEffect, useState } from "react";
import type { Member } from "../../shared/types";
import { api } from "../lib/api";
import { useApp } from "../lib/state";
import { Icon } from "./Icon";

const splitEmails = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

export function PeopleShare({ base, withMessage, onChange }: { base: string; withMessage?: boolean; onChange?: () => void }) {
  const { toast, me } = useApp();
  const [people, setPeople] = useState<Member[]>([]);
  const [text, setText] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = () =>
    api(base)
      .then((r) => setPeople(r.items))
      .catch(() => {})
      .finally(() => setLoaded(true));

  useEffect(() => {
    load();
  }, [base]);

  const emails = splitEmails(text);
  const invalid = emails.filter((e) => !validEmail(e));

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emails.length) return;
    if (invalid.length) return toast(`Email tidak valid: ${invalid.join(", ")}`, { tone: "error" });
    if (emails.includes(me.email)) return toast("Tidak perlu membagikan ke diri sendiri", { tone: "error" });
    setBusy(true);
    try {
      // Collections take one email per request; links accept a list.
      if (withMessage) await api(base, { method: "POST", json: { emails, role, message: message || undefined } });
      else for (const email of emails) await api(base, { method: "POST", json: { email, role } });
      toast(emails.length === 1 ? `Dibagikan ke ${emails[0]}` : `Dibagikan ke ${emails.length} orang`);
      setText("");
      setMessage("");
      load();
      onChange?.();
    } catch (err) {
      toast((err as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: Member) => {
    if (!confirm(`Cabut akses ${m.email}?`)) return;
    try {
      await api(`${base}/${encodeURIComponent(m.email)}`, { method: "DELETE" });
      load();
      onChange?.();
    } catch (err) {
      toast((err as Error).message, { tone: "error" });
    }
  };

  const changeRole = async (m: Member, r: "viewer" | "editor") => {
    try {
      await api(base, { method: "POST", json: withMessage ? { emails: [m.email], role: r } : { email: m.email, role: r } });
      load();
    } catch (err) {
      toast((err as Error).message, { tone: "error" });
    }
  };

  return (
    <div className="people">
      <form className="invite" onSubmit={invite}>
        <input
          className="input"
          type="text"
          inputMode="email"
          autoComplete="email"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Email, pisahkan dengan koma"
          aria-label="Email penerima"
        />
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as "viewer" | "editor")} aria-label="Hak akses">
          <option value="viewer">Bisa lihat</option>
          <option value="editor">Bisa edit</option>
        </select>
        <button className="btn primary" disabled={busy || !emails.length}>{busy ? "Mengirim…" : "Bagikan"}</button>
      </form>
      {withMessage && emails.length > 0 && (
        <textarea className="input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Pesan singkat (opsional), ikut di email" maxLength={300} />
      )}
      <p className="muted small">Penerima dapat email. Yang belum punya akun cukup masuk memakai email itu, lalu item ini muncul di "Dibagikan ke saya".</p>

      <ul className="members">
        <li>
          <span className="avatar">{me.email[0].toUpperCase()}</span>
          <span className="grow">{me.name || me.email} <span className="muted small">(kamu)</span></span>
          <span className="muted small">Pemilik</span>
        </li>
        {people.map((m) => (
          <li key={m.email}>
            <span className="avatar">{m.email[0].toUpperCase()}</span>
            <span className="grow">
              {m.email}
              {!m.joined && <span className="badge soft" title="Belum masuk ke JanganLupa">menunggu</span>}
            </span>
            <select className="input sm" value={m.role} onChange={(e) => changeRole(m, e.target.value as "viewer" | "editor")} aria-label={`Akses ${m.email}`}>
              <option value="viewer">Lihat</option>
              <option value="editor">Edit</option>
            </select>
            <button className="icon-btn" onClick={() => remove(m)} aria-label={`Cabut akses ${m.email}`} title="Cabut akses"><Icon name="x" size={16} /></button>
          </li>
        ))}
        {loaded && people.length === 0 && <li className="muted small">Belum dibagikan ke siapa pun.</li>}
      </ul>
    </div>
  );
}
