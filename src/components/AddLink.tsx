import { useEffect, useState } from "react";
import { FEATURES } from "../../shared/features";
import { api, ApiError, isOfflineError } from "../lib/api";
import { titleOf } from "../lib/format";
import { enqueue } from "../lib/queue";
import { useApp, type UiLink } from "../lib/state";
import { Icon } from "./Icon";
import { ReminderPicker } from "./ReminderPicker";
import { TagInput } from "./TagInput";
import { Favicon } from "./Thumb";

const looksLikeUrl = (s: string) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s.trim());

export function AddLink({ initial, defaultCollection, onDone, onOpen }: { initial?: { url?: string; title?: string; text?: string; bulk?: string }; defaultCollection?: string | null; onDone: () => void; onOpen?: (id: string) => void }) {
  const { collections, toast, bumpLinks } = useApp();
  const [tab, setTab] = useState<"single" | "bulk">(initial?.bulk ? "bulk" : "single");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.text && initial.text !== initial.url ? initial.text : "");
  const [tags, setTags] = useState<string[]>([]);
  const [collectionId, setCollectionId] = useState<string>(defaultCollection ?? "");
  const [remindAt, setRemindAt] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [bulkText, setBulkText] = useState(initial?.bulk ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<UiLink | null>(null);
  const writable = collections.filter((c) => c.role !== "viewer");

  useEffect(() => {
    // Share targets often put the URL inside "text" instead of "url".
    if (!initial?.url && initial?.text) {
      const m = initial.text.match(/https?:\/\/\S+/);
      if (m) {
        setUrl(m[0]);
        setNote(initial.text.replace(m[0], "").trim());
      }
    }
  }, [initial]);

  const pasteFromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (looksLikeUrl(text) || /https?:\/\//.test(text)) setUrl(text.match(/https?:\/\/\S+/)?.[0] ?? text);
      else toast("Clipboard tidak berisi link");
    } catch {
      toast("Browser tidak mengizinkan membaca clipboard. Tempel manual dengan Ctrl/⌘+V.");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDuplicate(null);
    if (tab === "bulk") return submitBulk();
    if (!url.trim()) return setError("Tempel link dulu");
    const payload = { url: url.trim(), title: title || undefined, note: note || undefined, tags, collectionId: collectionId || null, remindAt };
    setBusy(true);
    try {
      const r = await api("/links", { method: "POST", json: payload });
      toast(r.restored ? "Link ini pernah dihapus, sekarang dipulihkan" : "Tersimpan", onOpen ? { action: { label: "Lihat", run: () => onOpen(r.link.id) } } : {});
      bumpLinks();
      onDone();
    } catch (err) {
      if (isOfflineError(err)) {
        enqueue(payload);
        toast("Sedang offline. Link disimpan di perangkat dan dikirim otomatis saat online.");
        onDone();
      } else if (err instanceof ApiError && err.status === 409 && err.data?.link) {
        setDuplicate(err.data.link);
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitBulk = async () => {
    if (!bulkText.trim()) return setError("Tempel teks yang berisi link");
    setBusy(true);
    try {
      const r = await api("/links/bulk", { method: "POST", json: { text: bulkText, tags, collectionId: collectionId || null } });
      if (!r.total) setError("Tidak ada link yang terbaca dari teks ini");
      else {
        toast(`${r.added} link tersimpan${r.duplicates ? `, ${r.duplicates} sudah ada sebelumnya` : ""}`);
        bumpLinks();
        onDone();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bulkCount = (bulkText.match(/https?:\/\/\S+|www\.\S+/gi) ?? []).length;

  return (
    <form className="add-form" onSubmit={submit}>
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "single"} className={tab === "single" ? "on" : ""} onClick={() => setTab("single")}>Satu link</button>
        <button type="button" role="tab" aria-selected={tab === "bulk"} className={tab === "bulk" ? "on" : ""} onClick={() => setTab("bulk")}>Banyak sekaligus</button>
      </div>

      {tab === "single" ? (
        <>
          <div className="url-field">
            <Icon name="link" />
            <input
              className="input bare"
              value={url}
              onChange={(e) => (setUrl(e.target.value), setDuplicate(null))}
              placeholder="Tempel link di sini"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              enterKeyHint="done"
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                const many = text.match(/https?:\/\/\S+/g);
                if (many && many.length > 1) {
                  e.preventDefault();
                  setBulkText(text);
                  setTab("bulk");
                }
              }}
            />
            {"clipboard" in navigator && "readText" in navigator.clipboard && !url && (
              <button type="button" className="btn sm" onClick={pasteFromClipboard}>Tempel</button>
            )}
          </div>

          {duplicate && (
            <div className="notice">
              <div className="dup">
                <Favicon src={duplicate.favicon} domain={duplicate.domain} />
                <span>Sudah tersimpan {duplicate.archivedAt ? "di arsip" : ""}: <b>{titleOf(duplicate)}</b></span>
              </div>
              {onOpen && <button type="button" className="btn sm" onClick={() => (onOpen(duplicate.id), onDone())}>Buka yang lama</button>}
            </div>
          )}

          <label className="field">
            <span>Catatan <span className="muted">· konteks supaya tidak lupa</span></span>
            <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Untuk apa link ini? Dari siapa?" />
          </label>
        </>
      ) : (
        <label className="field">
          <span>Tempel teks berisi banyak link <span className="muted">· chat, catatan, daftar</span></span>
          <textarea className="input" rows={7} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={"https://contoh.com/a\nhttps://contoh.com/b\nAtau tempel isi chat apa pun"} autoFocus />
          {bulkCount > 0 && <span className="muted">Terdeteksi sekitar {bulkCount} link. Duplikat dilewati otomatis.</span>}
        </label>
      )}

      <div className="two">
        <div className="field">
          <span>Tag</span>
          <TagInput value={tags} onChange={setTags} />
        </div>
        <label className="field">
          <span>Koleksi</span>
          <select className="input" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            <option value="">Tanpa koleksi</option>
            {writable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      {tab === "single" && (
        more ? (
          <>
            <label className="field">
              <span>Judul <span className="muted">· kosongkan untuk otomatis</span></span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            {FEATURES.reminders && (
              <div className="field">
                <span>Ingatkan saya</span>
                <ReminderPicker value={remindAt} onChange={setRemindAt} />
              </div>
            )}
          </>
        ) : (
          <button type="button" className="link-btn" onClick={() => setMore(true)}>{FEATURES.reminders ? "+ Judul & pengingat" : "+ Judul sendiri"}</button>
        )
      )}

      {error && <div className="notice error">{error}</div>}

      <div className="row-end">
        <button type="button" className="btn" onClick={onDone}>Batal</button>
        <button className="btn primary" disabled={busy}>{busy ? "Menyimpan…" : tab === "bulk" ? "Simpan semua" : "Simpan"}</button>
      </div>
    </form>
  );
}
