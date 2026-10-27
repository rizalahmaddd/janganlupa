import { useMemo, useRef, useState } from "react";
import { useApp } from "../lib/state";
import { Icon } from "./Icon";

const clean = (s: string) =>
  s.trim().toLowerCase().replace(/^#+/, "").replace(/[^\p{L}\p{N}_./+-]+/gu, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function TagInput({ value, onChange, placeholder = "Tambah tag…", disabled }: { value: string[]; onChange: (tags: string[]) => void; placeholder?: string; disabled?: boolean }) {
  const { tags } = useApp();
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    const q = clean(text);
    return tags.filter((t) => !value.includes(t.name) && (!q || t.name.includes(q))).slice(0, 6);
  }, [tags, text, value]);

  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map(clean).filter(Boolean);
    const next = [...new Set([...value, ...parts])].slice(0, 30);
    if (next.length !== value.length) onChange(next);
    setText("");
    setActive(0);
  };

  return (
    <div className={`tag-input${focus ? " focus" : ""}${disabled ? " disabled" : ""}`} onClick={() => input.current?.focus()}>
      {value.map((t) => (
        <span key={t} className="chip">
          #{t}
          {!disabled && (
            <button type="button" aria-label={`Hapus tag ${t}`} onClick={(e) => (e.stopPropagation(), onChange(value.filter((x) => x !== t)))}>
              <Icon name="x" size={12} />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          ref={input}
          value={text}
          placeholder={value.length ? "" : placeholder}
          enterKeyHint="done"
          onFocus={() => setFocus(true)}
          onBlur={() => {
            setTimeout(() => setFocus(false), 150);
            if (text.trim()) add(text);
          }}
          onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Tab") {
              if (focus && text && suggestions[active] && suggestions[active].name.startsWith(clean(text)) && e.key === "Tab") {
                e.preventDefault();
                add(suggestions[active].name);
              } else if (text.trim()) {
                e.preventDefault();
                add(text);
              }
            } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
            else if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, suggestions.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          }}
        />
      )}
      {focus && suggestions.length > 0 && (
        <div className="suggest" role="listbox">
          {suggestions.map((s, i) => (
            <button type="button" key={s.id} className={i === active ? "active" : ""} onMouseDown={(e) => (e.preventDefault(), add(s.name))}>
              #{s.name} <span className="muted">{s.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
