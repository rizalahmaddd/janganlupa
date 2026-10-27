import { useState } from "react";
import { fullDate, reminderPresets, toLocalInput } from "../lib/format";
import { Icon } from "./Icon";

export function ReminderPicker({ value, onChange, disabled }: { value: number | null; onChange: (t: number | null) => void; disabled?: boolean }) {
  const [custom, setCustom] = useState(false);
  const due = value && value <= Date.now();
  return (
    <div className="reminder">
      {value ? (
        <div className={`reminder-set${due ? " due" : ""}`}>
          <Icon name="bell" size={16} />
          <span>{due ? "Waktunya dibuka · " : ""}{fullDate(value)}</span>
          {!disabled && (
            <button type="button" className="link-btn" onClick={() => onChange(null)}>
              {due ? "Selesai" : "Hapus"}
            </button>
          )}
        </div>
      ) : null}
      {!disabled && (
        <div className="preset-row">
          {reminderPresets().map((p) => (
            <button type="button" key={p.label} className={`pill${value === p.at ? " on" : ""}`} onClick={() => onChange(p.at)}>
              {p.label}
            </button>
          ))}
          <button type="button" className={`pill${custom ? " on" : ""}`} onClick={() => setCustom(!custom)}>
            Pilih waktu
          </button>
        </div>
      )}
      {custom && !disabled && (
        <input
          type="datetime-local"
          className="input"
          min={toLocalInput(Date.now())}
          defaultValue={toLocalInput(value)}
          onChange={(e) => {
            const t = new Date(e.target.value).getTime();
            if (Number.isFinite(t)) onChange(t);
          }}
        />
      )}
    </div>
  );
}
