import { Platform } from "react-native";

/**
 * Lensii — app design tokens.
 * Mirrors the marketing site's system so app and web read as one instrument.
 */
export const C = {
  bg: "#0B0B0C",
  bg2: "#0E0F11",
  surface: "#141518",
  surface2: "#191B1F",
  raised: "#1F2228",

  ink: "#F2F3F5",
  inkSoft: "#C2C7CD",
  inkMute: "#8B9298",
  inkFaint: "#626870",

  line: "#26282D",
  lineSoft: "#1C1E22",
  lineStrong: "#33363D",

  red: "#E0231C",
  redBright: "#FF3B30",
  redGlow: "rgba(224,35,28,0.30)",

  // capability tones (match the site's honest limitation map)
  go: "#37B36B",
  device: "#E0A62A",
  native: "#4C8DFF",
  attach: "#9A6CFF",
  stop: "#E0231C",

  overlay: "rgba(255,255,255,0.5)",
} as const;

/** Grotesk + mono stacks — the closest system faces to the Swiss look. */
export const F = {
  sans: Platform.select({ android: "sans-serif", ios: "Helvetica Neue", default: "System" }) as string,
  sansMed: Platform.select({ android: "sans-serif-medium", ios: "Helvetica Neue", default: "System" }) as string,
  mono: Platform.select({ android: "monospace", ios: "Menlo", default: "monospace" }) as string,
};

export const RADIUS = 6;
