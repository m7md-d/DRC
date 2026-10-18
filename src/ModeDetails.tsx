import { useId, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

// Keep controls mounted so changing the presentation cannot clear entered values,
// report filters or a pending operation review.
export function ModeDetails({
  simple = false,
  title,
  children,
  hint,
}: {
  simple?: boolean;
  title: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState<{
    easy?: boolean;
    professional?: boolean;
  }>({});
  const mode = simple ? "easy" : "professional";
  const open = expanded[mode] ?? !simple;
  return (
    <section className="mode-details" data-simple={simple}>
      <button
        className="mode-details-heading"
        aria-expanded={open}
        aria-controls={id}
        data-hint={hint}
        onClick={() => setExpanded((value) => ({ ...value, [mode]: !open }))}
      >
        <Icon name={open ? "chevronDown" : "chevron"} size={12} />
        {title}
      </button>
      <div id={id} hidden={!open} className="mode-details-content">
        {children}
      </div>
    </section>
  );
}
