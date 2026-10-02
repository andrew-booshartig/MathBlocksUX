/** One consistent line-icon set for the app chrome (24×24, 1.75 stroke,
 * round caps) — so the toolbar reads as one family instead of mixed emoji. */
const PATHS: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8 7h8",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  home: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10",
  pin: "M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  frame: "M3 8V4h4M17 4h4v4M21 16v4h-4M7 20H3v-4M8 9h8v6H8z",
  lock: "M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11",
  unlock: "M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2",
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z",
  chevron: "M7 10l5 5 5-5",
  // four-way arrows: scrolling moves the canvas
  move: "M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5",
  // magnifier: scrolling zooms
  zoom: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8M10.5 8v5M8 10.5h5",
  zoomOut: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8M8 10.5h5",
  // graph tools
  hand: "M8 11V5.5a1.5 1.5 0 0 1 3 0V10M11 10V4.5a1.5 1.5 0 0 1 3 0V10M14 10V5.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7-6.5 7-3 0-4.5-1.5-6-4l-1.8-3.2a1.5 1.5 0 0 1 2.6-1.5L8 13",
  point: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v3M12 18v3M3 12h3M18 12h3",
  segment: "M5 19 19 5M5 19a1.6 1.6 0 1 0 0 .01M19 5a1.6 1.6 0 1 0 0 .01",
  arrow: "M5 19 19 5M10 5h9v9",
  pen: "M15.5 4.5l4 4L8 20H4v-4zM13.5 6.5l4 4",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  eraser: "M8.5 20H20M4.6 14.6l8.8-8.8a2 2 0 0 1 2.8 0l3.5 3.5a2 2 0 0 1 0 2.8L12.5 19.3a2 2 0 0 1-1.4.7H8.6a2 2 0 0 1-1.4-.6l-2.6-2.6a2 2 0 0 1 0-2.8zM9 10l6 6",
  magnet: "M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4",
  reset: "M4 12a8 8 0 1 0 2.3-5.6M4 4v4.5h4.5",
  download: "M12 4v11M7 10.5l5 5 5-5M5 20h14",
  panel: "M4 5h16v14H4zM10 5v14",
  eye: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M4 4l16 16M9.9 5.7A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.9 3.7M6.3 7.4A17 17 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9.3 9.3 0 0 0 4.1-1M10 10a3 3 0 0 0 4 4",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3l-1.6-1.2 2-3.4 1.9.7a7 7 0 0 1 2-1.2L10.8 3h4l.3 2.4a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z",
  play: "M8 5v14l11-7z",
  pause: "M8 5v14M16 5v14",
  trash: "M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13",
};

export default function Icon({ name, size = 17 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
