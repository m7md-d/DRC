import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Icon } from "./Icon";

export function Select({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; detail?: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [placement, setPlacement] = useState({ above: false, maxHeight: 260 });
  const [open, setOpen] = useState(false);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [active, setActive] = useState(selected);
  const typeahead = useRef({ text: "", at: 0 });
  useLayoutEffect(() => {
    if (!open || !root.current || !list.current) return;
    const measure = () => {
      const rect = root.current!.getBoundingClientRect();
      const boundary = root
        .current!.closest(".modal-content")
        ?.getBoundingClientRect();
      const below =
        Math.min(window.innerHeight, boundary?.bottom ?? window.innerHeight) -
        rect.bottom -
        8;
      const above = rect.top - Math.max(0, boundary?.top ?? 0) - 8;
      const desired = Math.min(260, list.current!.scrollHeight);
      const upward = below < desired && above > below;
      setPlacement({
        above: upward,
        maxHeight: Math.max(60, Math.min(260, upward ? above : below)),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);
  useEffect(() => {
    if (!open || !list.current) return;
    const option = list.current.children[active] as HTMLElement | undefined;
    if (!option) return;
    if (option.offsetTop < list.current.scrollTop)
      list.current.scrollTop = option.offsetTop;
    else if (
      option.offsetTop + option.offsetHeight >
      list.current.scrollTop + list.current.clientHeight
    )
      list.current.scrollTop =
        option.offsetTop + option.offsetHeight - list.current.clientHeight;
  }, [active, open, placement]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  function choose(index: number) {
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }
  function key(event: KeyboardEvent<HTMLButtonElement>) {
    const name = event.key;
    if (name === "Tab") {
      setOpen(false);
      return;
    }
    if (name === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(name)) {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(
          name === "Home" ? 0 : name === "End" ? options.length - 1 : selected,
        );
      } else
        setActive(
          name === "Home"
            ? 0
            : name === "End"
              ? options.length - 1
              : (active + (name === "ArrowDown" ? 1 : -1) + options.length) %
                options.length,
        );
    } else if (name === "Enter" || name === " ") {
      event.preventDefault();
      if (open) choose(active);
      else {
        setActive(selected);
        setOpen(true);
      }
    } else if (
      name.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const now = Date.now();
      typeahead.current = {
        text:
          (now - typeahead.current.at < 700 ? typeahead.current.text : "") +
          name.toLowerCase(),
        at: now,
      };
      const match = options.findIndex((o) =>
        o.label.toLowerCase().startsWith(typeahead.current.text),
      );
      if (match >= 0) {
        setActive(match);
        setOpen(true);
      }
    }
  }
  return (
    <div
      ref={root}
      className="brand-select"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        className="select-trigger"
        disabled={disabled}
        onKeyDown={key}
        onClick={() => {
          setActive(selected);
          setOpen(!open);
        }}
      >
        <span>{options.find((o) => o.value === value)?.label ?? value}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className="select-options"
          data-placement={placement.above ? "above" : "below"}
          style={{ maxHeight: placement.maxHeight }}
        >
          {options.map((option, index) => (
            <li
              id={`${id}-${index}`}
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              data-active={active === index}
              onPointerMove={() => setActive(index)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>
                <strong>{option.label}</strong>
                {option.detail && <small>{option.detail}</small>}
              </span>
              {option.value === value && (
                <svg
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  aria-hidden="true"
                >
                  <path
                    d="m3 8 3 3 7-7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
