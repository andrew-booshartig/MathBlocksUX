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
  ray: "M5 19 20 4M20 4h-5.5M20 4v5.5M5 19a1.6 1.6 0 1 0 0 .01",
  circle: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 12l5.6-5.6M12 12h.01",
  polygon: "M5 18 7.5 6 18 8.5 19.5 17.5z",
  rectangle: "M4 6.5h16v11H4z",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  ruler: "M3 16.5 16.5 3 21 7.5 7.5 21zM7 12.5l2 2M10 9.5l2 2M13 6.5l2 2",
  angle: "M4 19h16M4 19 14.5 5M10.5 19a6.5 6.5 0 0 0-2.6-5.2",
  perpendicular: "M4 20h16M11 20V4M11 15.5h4.5V20",
  parallel: "M4 18 12 6M12 18l8-12",
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
  copy: "M9 9h11v11H9zM5 15V4h11",
  toWork: "M4 12h13M12 6l6 6-6 6M20 5v14",
  // the calculator app's tiles
  calc: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 6.5h7v3h-7zM9 13.5h.01M12 13.5h.01M15 13.5h.01M9 17h.01M12 17h.01M15 17h.01",
  work: "M4 6h9M4 11h6M4 16h4M14 19.5l.6-3.1 5.4-5.4a1.7 1.7 0 0 1 2.5 2.5L17.1 19z",
  graph: "M4 4v16h16M7.5 15.5l3.5-4 3 2.5 5-6.5",
  assignment: "M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v5h5M9 13h6M9 17h4",
  reference: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8.5 7.5h7M8.5 11h5",
  variables: "M4 7.5l6 9M10 7.5l-6 9M14 10h6M14 14h6",
  equations: "M14.5 4.2c-1.9-.7-3.6.1-4 2L8.6 17.8c-.4 1.9-2 2.7-4 2M6.5 10h7M15 13l4.5 5.5M19.5 13 15 18.5",
  notebook: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7zM7 3v18M10.5 8h5M10.5 12h5M10.5 16h3M5 7h2M5 12h2M5 17h2",
  run: "M8 5.5v13l10.5-6.5z",
  print: "M7 9V4h10v5M7 17H5a1.5 1.5 0 0 1-1.5-1.5V10.5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2M7 14h10v6H7z",
  source: "M9 7l-5 5 5 5M15 7l5 5-5 5",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  line: "M3 21 21 3M8.5 15.5h.01M15.5 8.5h.01",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  // zones
  close: "M7 7l10 10M17 7 7 17",
  maximize: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  restore: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  splitRight: "M4 5h16v14H4zM12 5v14",
  splitDown: "M4 5h16v14H4zM4 12h16",
  float: "M9 9h11v11H9zM5 15V5a1 1 0 0 1 1-1h10",
  dock: "M4 5h16v14H4zM4 9h16M12 13v4M10 15l2 2 2-2",
  layout: "M4 5h16v14H4zM10 5v14M10 12h10",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  // a picture (an object) in a page: where it sits, how text goes around it
  alignLeft: "M4 6h16M4 10h9M4 14h16M4 18h9",
  alignCenter: "M4 6h16M7.5 10h9M4 14h16M7.5 18h9",
  alignRight: "M4 6h16M11 10h9M4 14h16M11 18h9",
  wrapLeft: "M4 5h7v7H4zM14 6h6M14 10h6M4 15.5h16M4 19.5h11",
  wrapRight: "M13 5h7v7h-7zM4 6h6M4 10h6M4 15.5h16M4 19.5h11",
  wide: "M3 12h18M3 12l3.5-3.5M3 12l3.5 3.5M21 12l-3.5-3.5M21 12l-3.5 3.5",
  grip: "M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01",
  bolt: "M13 3 5 14h6l-1 7 8-11h-6z",
  electrical: "M13 3 5 14h6l-1 7 8-11h-6z",
  paper: "M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h4",
  sliderule: "M2 7h20v10H2zM2 10h20M2 14h20M6 7v2M10 7v3M14 7v2M18 7v3M12 4v16",
  facts: "M4 7h12v13H4zM8 7V4h12v13h-4M8 12l4 4M12 12l-4 4",
  check: "M5 12.5l4.5 4.5L19 7",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14",
  gridpaper: "M4 4h16v16H4zM4 8h16M4 12h16M4 16h16M8 4v16M12 4v16M16 4v16",
  // graph paper's tools
  psCross: "M8 6h8l-5 12M5 19 19 5",
  psCircle: "M12 19.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM10.5 9.5 12.5 8v8",
  psBox: "M4.5 4.5h15v15h-15zM10.5 9.5 12.5 8v8",
  psUnder: "M7 4v7a5 5 0 0 0 10 0V4M5 20h14",
  psWall: "M7 20V4.5h12",
  psEdge: "M4 4v16h16M8 16h.01M12 12h.01",
  psDot: "M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM4 4h16v16H4z",
  psCurve: "M3.5 6c3 13 14 13 17 0M3.5 6h.01M20.5 6h.01",
  psMarker: "M14.5 4.5l5 5-7.5 7.5H7v-5zM4 21h9",
  psDash: "M3.5 12h3.5M10.25 12h3.5M17 12h3.5",
  image: "M4 5h16v14H4zM8.5 10a1.5 1.5 0 1 0 0-.01M20 15l-5-5-8 9",
  // Extensions: a puzzle piece
  puzzle: "M10 4.5a2 2 0 1 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 1 0 0 4H19v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 1 0-4 0V20H6a1 1 0 0 1-1-1v-4h1.5a2 2 0 1 0 0-4H5V7a1 1 0 0 1 1-1h4z",
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
