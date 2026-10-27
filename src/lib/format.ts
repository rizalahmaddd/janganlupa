const rtf = new Intl.RelativeTimeFormat("id", { numeric: "auto" });
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export function ago(t: number | null | undefined): string {
  if (!t) return "";
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  if (abs < MIN) return diff < 0 ? "baru saja" : "sebentar lagi";
  if (abs < HOUR) return rtf.format(Math.round(diff / MIN), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  if (abs < 30 * DAY) return rtf.format(Math.round(diff / DAY), "day");
  if (abs < 365 * DAY) return rtf.format(Math.round(diff / (30 * DAY)), "month");
  return rtf.format(Math.round(diff / (365 * DAY)), "year");
}

export function fullDate(t: number | null | undefined): string {
  if (!t) return "";
  return new Date(t).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export function toLocalInput(t: number | null | undefined): string {
  if (!t) return "";
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function reminderPresets(): { label: string; at: number }[] {
  const d = new Date();
  const at = (days: number, hour: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    x.setHours(hour, 0, 0, 0);
    return x.getTime();
  };
  const tonight = d.getHours() < 19 ? at(0, 20) : at(1, 8);
  const daysToSat = (6 - d.getDay() + 7) % 7 || 7;
  return [
    { label: d.getHours() < 19 ? "Nanti malam" : "Besok pagi", at: tonight },
    { label: "Besok", at: at(1, 9) },
    { label: "Akhir pekan", at: at(daysToSat, 9) },
    { label: "Minggu depan", at: at(7, 9) },
    { label: "Bulan depan", at: at(30, 9) },
  ];
}

export function titleOf(l: { title: string | null; domain: string; url: string }): string {
  if (l.title) return l.title;
  try {
    const u = new URL(l.url);
    const path = decodeURIComponent(u.pathname).replace(/\/$/, "");
    return path && path !== "/" ? `${l.domain}${path}` : l.domain;
  } catch {
    return l.domain;
  }
}

export const COLLECTION_COLORS: Record<string, string> = {
  teal: "#138a76",
  amber: "#c98a12",
  rose: "#c4475f",
  sky: "#2f7fc1",
  violet: "#7a5bc7",
  lime: "#5f9a1f",
  slate: "#64707d",
  orange: "#d0642a",
};

export const colorOf = (c: string | null | undefined) => COLLECTION_COLORS[c || "teal"] ?? COLLECTION_COLORS.teal;
