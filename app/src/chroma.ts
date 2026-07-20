// Imported from the "skia" subpath, not the package's main barrel — the
// barrel also re-exports Canvas/video-hooks internals that unconditionally
// touch an optional react-native-reanimated proxy at module-load time (even
// though we never render a <Canvas> or use Skia video here), which throws
// and crashes the whole app on launch since reanimated isn't installed.
// NativeSetup is the barrel's actual first import (it installs the native
// JSI bridge, global.SkiaApi) — it has no reanimated dependency of its own,
// so it must be imported explicitly here since the narrower "./skia" subpath
// below doesn't pull it in itself.
import "@shopify/react-native-skia/src/skia/NativeSetup";
import { Skia, TileMode, FilterMode, MipmapMode, ImageFormat } from "@shopify/react-native-skia/src/skia";
import * as FileSystem from "expo-file-system/legacy";

/**
 * Real GPU chroma key — an SkSL shader compiled and run on-device via Skia's
 * offscreen renderer. Compares each pixel to a key colour in RGB space and
 * cuts alpha smoothly across a threshold band, producing a transparent PNG.
 */
const CHROMA_SKSL = `
uniform shader image;
uniform vec3 keyColor;
uniform float threshold;
uniform float smoothing;

half4 main(vec2 xy) {
  vec4 c = image.eval(xy);
  float dist = distance(c.rgb, keyColor);
  float alpha = smoothstep(threshold, threshold + smoothing, dist);
  float outAlpha = alpha * c.a;
  return half4(c.rgb * outAlpha, outAlpha);
}
`;

let cachedEffect: ReturnType<typeof Skia.RuntimeEffect.Make> | null = null;
function getEffect() {
  if (!cachedEffect) cachedEffect = Skia.RuntimeEffect.Make(CHROMA_SKSL);
  if (!cachedEffect) throw new Error("Chroma key shader failed to compile");
  return cachedEffect;
}

export type ChromaKeyOptions = {
  /** Key colour as 0..1 RGB, e.g. [0.05, 0.85, 0.25] for a typical green screen. */
  keyColor: [number, number, number];
  /** How close a pixel must be to the key colour (in normalised RGB distance) to be cut. */
  threshold: number;
  /** Width of the soft edge between "kept" and "cut" pixels. */
  smoothing: number;
};

export const KEY_PRESETS: Record<string, [number, number, number]> = {
  green: [0.06, 0.72, 0.2],
  blue: [0.05, 0.35, 0.75],
};

/** Runs the chroma-key shader on an image URI, returns a URI to a transparent PNG. */
export async function chromaKeyImage(uri: string, opts: ChromaKeyOptions): Promise<string> {
  const effect = getEffect();

  const data = await Skia.Data.fromURI(uri);
  const img = Skia.Image.MakeImageFromEncoded(data);
  if (!img) throw new Error("Could not decode image");

  const w = img.width();
  const h = img.height();
  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) throw new Error("Could not allocate offscreen surface");

  const canvas = surface.getCanvas();
  const imageShader = img.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None);
  const shader = effect.makeShaderWithChildren(
    [opts.keyColor[0], opts.keyColor[1], opts.keyColor[2], opts.threshold, opts.smoothing],
    [imageShader]
  );

  const paint = Skia.Paint();
  paint.setShader(shader);
  canvas.drawPaint(paint);
  surface.flush();

  const snapshot = surface.makeImageSnapshot();
  const base64 = snapshot.encodeToBase64(ImageFormat.PNG, 100);

  const dest = (FileSystem.cacheDirectory ?? "") + `chroma_${Date.now()}.png`;
  await FileSystem.writeAsStringAsync(dest, base64, { encoding: FileSystem.EncodingType.Base64 });
  return dest;
}
