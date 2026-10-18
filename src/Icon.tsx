const paths = {
  network: (
    <>
      <rect x="2" y="5" width="20" height="13" rx="2" />
      <path d="M6 5v5h12V5M7 18v3m10-3v3M9 8v2m3-2v2m3-2v2" />
    </>
  ),
  display: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M5.5 8h1M5.5 12h1" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  power: (
    <>
      <path d="M12 2v9M7 5a9 9 0 1 0 10 0" />
    </>
  ),
  usb: (
    <>
      <path d="M12 3v14m-3-11 3-3 3 3M12 13l-6-3V7m6 8 6-4V8" />
      <circle cx="6" cy="6" r="1.5" />
      <rect x="16.5" y="5" width="3" height="3" />
      <circle cx="12" cy="19" r="2" />
    </>
  ),
  hub: (
    <>
      <rect x="8" y="3" width="8" height="5" rx="1" />
      <path d="M12 8v5M4 17v-4h16v4" />
      <rect x="1" y="17" width="6" height="4" rx="1" />
      <rect x="9" y="17" width="6" height="4" rx="1" />
      <rect x="17" y="17" width="6" height="4" rx="1" />
    </>
  ),
  temperature: (
    <>
      <path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0M12 10v8" />
    </>
  ),
  folder: <path d="M3 6h7l2 3h9v11H3z" />,
  drive: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 14h18M7 17h.01M11 17h.01" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 8 4 4-4 4M13 16h4" />
    </>
  ),
  partitions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M9 5v14M16 5v14" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18M6 15l4-7 4 5 6-9" />
    </>
  ),
  link: (
    <>
      <path d="m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />
    </>
  ),
  tools: (
    <>
      <path d="M14 5a6 6 0 0 0-7 7l-5 5a3 3 0 0 0 4 4l5-5a6 6 0 0 0 7-7l-4 3-3-3z" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="1" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  arrow: (
    <>
      <path d="M4 12h16m-5-5 5 5-5 5" />
    </>
  ),
  chevron: <path d="m8 5 7 7-7 7" />,
  chevronDown: <path d="m5 8 7 7 7-7" />,
  close: <path d="m5 5 14 14M5 19 19 5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7v.01" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  file: (
    <>
      <path d="M5 3h9l5 5v13H5zM14 3v6h5M9 13h6M9 17h6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="1" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
};

export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 16,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}
