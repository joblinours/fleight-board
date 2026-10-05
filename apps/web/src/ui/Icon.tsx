import type { SVGProps } from 'react';

/**
 * Icônes au trait (24 × 24, `currentColor`), dessinées pour Fleight Board :
 * pas de dépendance, rendu net à toutes les tailles.
 */
const PATHS = {
  pointer: <path d="M5 3.5 18.5 10l-6 1.6L9.6 17.8z" />,
  lasso: (
    <>
      <path d="M7 17.5c-2.4-1-4-2.9-4-5.1C3 8.3 7 5 12 5s9 3.3 9 7.4-4 7.4-9 7.4c-1 0-1.9-.1-2.8-.3" />
      <path d="M7 17.5c0 1.6 1.2 3 2.7 3 1.2 0 2.1-.8 2.1-1.9 0-1.4-1.6-2.1-4.8-1.1z" />
    </>
  ),
  square: <rect x="4" y="4" width="16" height="16" rx="2.5" />,
  circle: <circle cx="12" cy="12" r="8.5" />,
  pentagon: <path d="M12 3.5 20.5 9.7 17.3 19.5H6.7L3.5 9.7z" />,
  type: (
    <>
      <path d="M5 6.5V5h14v1.5" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </>
  ),
  line: <path d="M5 19 19 5" />,
  arrow: (
    <>
      <path d="M5 19 19 5" />
      <path d="M10 5h9v9" />
    </>
  ),
  connector: (
    <>
      <circle cx="5.5" cy="18.5" r="2" />
      <circle cx="18.5" cy="5.5" r="2" />
      <path d="M5.5 16.5V12h13V7.5" />
    </>
  ),
  pen: (
    <>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
      <path d="m14.5 5.5 3 3" />
    </>
  ),
  highlighter: (
    <>
      <path d="m9 11-5 5v3h6l5-5" />
      <path d="m21 7-7.5 7.5-4.5-4.5L16.5 2.5z" />
    </>
  ),
  eraser: (
    <>
      <path d="m7 20-4-4a1.5 1.5 0 0 1 0-2.1L13.9 3a1.5 1.5 0 0 1 2.1 0l5 5a1.5 1.5 0 0 1 0 2.1L11 20" />
      <path d="M7 20h14" />
      <path d="m9 10 6 6" />
    </>
  ),
  frame: (
    <>
      <path d="M7 3v18" />
      <path d="M17 3v18" />
      <path d="M3 7h18" />
      <path d="M3 17h18" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <circle cx="9" cy="9" r="1.8" />
      <path d="m20.5 15-4.5-4.5L6 20.5" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M5.5 7 6.5 19a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8L18.5 7" />
      <path d="M9 7V4.5h6V7" />
    </>
  ),
  fit: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.7l-1.6-5.5L5 10.6 10.4 9z" />
      <path d="M19 3v4M21 5h-4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18.5 14.5a6.5 6.5 0 0 1 3 5.5" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 4v4h4" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.5a4 4 0 0 0 6 .4l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6" />
      <path d="M14 10.5a4 4 0 0 0-6-.4l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
      <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  login: (
    <>
      <path d="M14 3.5h4a2.5 2.5 0 0 1 2.5 2.5v12a2.5 2.5 0 0 1-2.5 2.5h-4" />
      <path d="m10 16.5 4.5-4.5L10 7.5" />
      <path d="M14.5 12H3.5" />
    </>
  ),
  logout: (
    <>
      <path d="M10 20.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5h4" />
      <path d="m15.5 16.5 4.5-4.5-4.5-4.5" />
      <path d="M20 12H9" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.4 7.5 9.5 4.4-1.1 7.5-4.9 7.5-9.5V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.4-4.4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20.5a8 8 0 0 1 16 0" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.6 5.6A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.2 3" />
      <path d="M6.6 6.6C3.9 8.4 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.9 0 3.5-.6 4.9-1.5" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5" />
    </>
  ),
  hash: <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />,
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  filter: <path d="M4 5h16l-6.5 7.5V19l-3 1.5v-8z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4.5" />
      <path d="m11.2 11.8 8.3-8.3" />
      <path d="m16.5 6.5 2.5 2.5" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
      <path d="M9.5 20.5V14h5v6.5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16 8.5 4.5 8.5-4.5" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="m8.2 10.8 7.6-4M8.2 13.2l7.6 4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3.5h6" />
      <path d="M10 3.5v6L4.6 18.2A1.5 1.5 0 0 0 5.9 20.5h12.2a1.5 1.5 0 0 0 1.3-2.3L14 9.5v-6" />
      <path d="M7.5 15h9" />
    </>
  ),
  pencilLine: (
    <>
      <path d="M12 20h8.5" />
      <path d="M16 3.5a2.1 2.1 0 0 1 3 3L7.5 18 3.5 19l1-4z" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13h5l1.5 2.5h4L15.5 13h5" />
      <path d="M5.5 5.5h13l2 7.5v5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-5z" />
    </>
  ),
  mousePointer: (
    <>
      <path d="m4 4 6.5 16 2.3-6.7L19.5 11z" />
      <path d="m13 13 6 6" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2a1.7 1.7 0 0 1 1.2-2.9H16a4.5 4.5 0 0 0 4.5-4.5c0-3.9-3.8-6.7-8.5-6.7" />
      <circle cx="7.5" cy="11" r="1" />
      <circle cx="10" cy="7.5" r="1" />
      <circle cx="14.5" cy="7.5" r="1" />
    </>
  ),
  minimize: <path d="M5 12h14" />,
  scissors: (
    <>
      <circle cx="6" cy="6.5" r="2.5" />
      <circle cx="6" cy="17.5" r="2.5" />
      <path d="M8.1 8 20 18.5" />
      <path d="M8.1 16 20 5.5" />
    </>
  ),
  clipboard: (
    <>
      <rect x="8.5" y="3" width="7" height="3.5" rx="1" />
      <path d="M15.5 4.5h2a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
      <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
      <path d="M14.5 12v5M12 14.5h5" />
    </>
  ),
  group: (
    <>
      <path d="M3.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2M17 3.5h2A1.5 1.5 0 0 1 20.5 5v2M20.5 17v2a1.5 1.5 0 0 1-1.5 1.5h-2M7 20.5H5A1.5 1.5 0 0 1 3.5 19v-2" />
      <rect x="7" y="7" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </>
  ),
  ungroup: (
    <>
      <rect x="3.5" y="3.5" width="8" height="8" rx="1.5" />
      <rect x="12.5" y="12.5" width="8" height="8" rx="1.5" />
    </>
  ),
  bringFront: (
    <>
      <rect x="8" y="8" width="12.5" height="12.5" rx="2" />
      <path d="M4 15.5V5.5a2 2 0 0 1 2-2h10" strokeDasharray="2.2 2.4" />
    </>
  ),
  sendBack: (
    <>
      <rect x="3.5" y="3.5" width="12.5" height="12.5" rx="2" />
      <path d="M20 8.5v10a2 2 0 0 1-2 2H8" strokeDasharray="2.2 2.4" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  ...props
}: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}
