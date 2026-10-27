import { api, isOfflineError } from "./api";
import { storage, store } from "./hooks";

export interface QueuedLink {
  url: string;
  title?: string;
  note?: string;
  tags?: string[];
  collectionId?: string | null;
  queuedAt: number;
}

const KEY = "jl:queue";

export const queued = () => storage<QueuedLink[]>(KEY, []);

export function enqueue(item: Omit<QueuedLink, "queuedAt">) {
  store(KEY, [...queued(), { ...item, queuedAt: Date.now() }]);
  window.dispatchEvent(new Event("jl:queue"));
}

let flushing = false;

export async function flushQueue(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of queued()) {
      try {
        await api("/links", { method: "POST", json: item });
      } catch (e) {
        if (isOfflineError(e)) break;
        // Duplicates and invalid URLs are dropped; retrying them would never succeed.
      }
      store(KEY, queued().filter((q) => q.queuedAt !== item.queuedAt));
      sent++;
    }
  } finally {
    flushing = false;
    window.dispatchEvent(new Event("jl:queue"));
  }
  return sent;
}
