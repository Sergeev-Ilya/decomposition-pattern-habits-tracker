import type { CSSProperties, ReactNode } from 'react';
export function Icon({ name, className = 'h-5 w-5', style }: { name: string; className?: string; style?: CSSProperties }) {
  const paths: Record<string, ReactNode> = {
    leaf: <><path d="M19 4C9 3 4 7 5 13c1 5 7 6 10 2 3-4 4-11 4-11Z"/><path d="M5 20 15 9"/></>,
    book: <><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Z"/><path d="M12 6v14"/></>,
    water: <path d="M12 3C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-12Z"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/></>,
    moon: <path d="M20 15A9 9 0 0 1 9 4 9 9 0 1 0 20 15Z"/>,
    walk: <><circle cx="14" cy="4" r="2"/><path d="m7 21 4-7m5 7-3-8 1-6-4 2-3 5m7-6 3 5h4"/></>,
    flame: <path d="M13 2c2 6-2 7-2 10-2-1-3-3-2-5-5 4-6 9-3 12a8 8 0 0 0 12-1c3-4 0-8-1-9 0 4-2 5-2 5 1-6-2-12-2-12Z"/>,
    check: <path d="m5 12 4 4L19 6"/>, plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>, back: <path d="M19 12H5m5-5-5 5 5 5"/>, left: <path d="m14 5-7 7 7 7"/>, right: <path d="m10 5 7 7-7 7"/>,
    edit: <path d="m14 5 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z"/>, trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>, close: <path d="m6 6 12 12M6 18 18 6"/>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    exit: <path d="M9 4H4v16h5m5-12 4 4-4 4m-6-4h13"/>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>{paths[name] || paths.leaf}</svg>;
}
