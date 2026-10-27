import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

type Variant = "dialog" | "side" | "bottom" | "drawer";

let openCount = 0;
const stack: symbol[] = [];

export function Sheet({ open, onClose, title, variant = "dialog", children, footer, wide }: { open: boolean; onClose: () => void; title?: ReactNode; variant?: Variant; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    openCount++;
    const me = Symbol();
    stack.push(me);
    document.body.classList.add("no-scroll");
    const onKey = (e: KeyboardEvent) => {
      // Only the top-most sheet reacts, so Escape in a nested dialog doesn't close its parent too.
      if (e.key === "Escape" && stack[stack.length - 1] === me) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>("[autofocus], input:not([type=hidden]), textarea, select") ?? panel.current;
      target?.focus({ preventScroll: true });
    });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(me), 1);
      if (--openCount === 0) document.body.classList.remove("no-scroll");
      prev?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className={`sheet-root sheet-${variant}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className={`sheet-panel${wide ? " wide" : ""}`} role="dialog" aria-modal="true" tabIndex={-1}>
        {variant === "bottom" && <div className="sheet-grip" aria-hidden="true" />}
        {title !== undefined && (
          <header className="sheet-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Tutup">
              <Icon name="x" />
            </button>
          </header>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Toasts({ items, dismiss }: { items: { id: number; text: string; tone?: string; action?: { label: string; run: () => void } }[]; dismiss: (id: number) => void }) {
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone ?? ""}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}
