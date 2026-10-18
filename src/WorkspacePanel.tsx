import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export function WorkspacePanel({
  title,
  subtitle,
  close,
  children,
  wide = false,
  className = "",
  footer,
}: {
  title: string;
  subtitle: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // Move keyboard focus to the pane, without highlighting an action on pointer navigation.
    ref.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"]'))
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      previous?.focus({ preventScroll: true });
    };
  }, []);
  const root = document.getElementById("workspace-panel-root");
  if (!root) return null;
  return createPortal(
    <section
      ref={ref}
      className={`workspace-panel ${wide ? "wide" : ""} ${className}`}
      role="region"
      aria-label={title}
      tabIndex={-1}
    >
      <div className="section-heading modal-heading">
        <button
          className="panel-back toolbar-icon"
          onClick={close}
          aria-label={`Close ${title}`}
          data-hint="Return to the selected device. Running operations and saved results are preserved."
        >
          <Icon name="chevron" size={15} />
        </button>
        <div>
          <h2>{title}</h2>
          <p className="modal-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="modal-content">{children}</div>
      {footer && <footer className="modal-footer">{footer}</footer>}
    </section>,
    root,
  );
}
