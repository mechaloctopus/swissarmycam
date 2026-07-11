import { getColors } from "react-native-image-colors";
import TextRecognition from "@react-native-ml-kit/text-recognition";
import ImageLabeling from "@react-native-ml-kit/image-labeling";

export type Swatch = { label: string; hex: string };
export type TextScan = { text: string; lines: number; words: number };
export type SceneLabel = { text: string; confidence: number };

/** On-device OCR — extract text from an image URI (MLKit, offline). */
export async function extractText(uri: string): Promise<TextScan> {
  const r = await TextRecognition.recognize(uri);
  const lines = r.blocks.reduce((a, b) => a + b.lines.length, 0);
  const words = r.blocks.reduce((a, b) => a + b.lines.reduce((x, l) => x + l.elements.length, 0), 0);
  return { text: (r.text ?? "").trim(), lines, words };
}

/** On-device scene / object labeling — what's in the frame (MLKit, offline). */
export async function labelScene(uri: string): Promise<SceneLabel[]> {
  const labels = await ImageLabeling.label(uri);
  return labels
    .filter((l) => l.confidence >= 0.4)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12)
    .map((l) => ({ text: l.text, confidence: l.confidence }));
}

/** Extract a colour palette from an image URI. Works across platforms. */
export async function extractPalette(uri: string): Promise<Swatch[]> {
  const r = await getColors(uri, { cache: true, quality: "high", fallback: "#0B0B0C" });
  if (r.platform === "android") {
    return [
      { label: "Dominant", hex: r.dominant },
      { label: "Vibrant", hex: r.vibrant },
      { label: "Dark vibrant", hex: r.darkVibrant },
      { label: "Light vibrant", hex: r.lightVibrant },
      { label: "Muted", hex: r.muted },
      { label: "Dark muted", hex: r.darkMuted },
      { label: "Light muted", hex: r.lightMuted },
      { label: "Average", hex: r.average },
    ];
  }
  if (r.platform === "ios") {
    return [
      { label: "Background", hex: r.background },
      { label: "Primary", hex: r.primary },
      { label: "Secondary", hex: r.secondary },
      { label: "Detail", hex: r.detail },
    ];
  }
  return [
    { label: "Dominant", hex: r.dominant },
    { label: "Vibrant", hex: r.vibrant },
    { label: "Dark vibrant", hex: r.darkVibrant },
    { label: "Light vibrant", hex: r.lightVibrant },
    { label: "Muted", hex: r.muted },
    { label: "Dark muted", hex: r.darkMuted },
    { label: "Light muted", hex: r.lightMuted },
  ];
}

/** Relative luminance → pick readable ink colour over a swatch. */
export function readableInk(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? "#0B0B0C" : "#FFFFFF";
}
