/**
 * The Editor Studio timeline model — pure data + math, no React, no native.
 *
 * Both the live preview (StudioScreen) and the baked export (the
 * video-exporter Kotlin module) evaluate layers through the same rules
 * defined here. Anything added to this file has to be mirrored in
 * OverlayLayer.kt's LayerParser or the preview and the export will drift
 * apart — that split is the single biggest correctness risk in the editor,
 * so keep this file small and explicit.
 */

export type Easing = "linear" | "in" | "out" | "inOut";

export type Keyframe = {
  /** Absolute timeline seconds (output time, after clip speed is applied). */
  t: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** 0–100. */
  opacity: number;
  /** How the value approaches the NEXT keyframe. */
  easing: Easing;
};

export type LayerKind = "image" | "gif" | "video" | "text";

export type Chroma = {
  keyColor: [number, number, number];
  threshold: number;
  smoothing: number;
};

export type Layer = {
  id: string;
  kind: LayerKind;
  uri?: string;
  text?: string;
  color: string;
  /** Font size in preview points — text layers only. */
  fontSize: number;
  /** Visibility window in timeline seconds — the "pop in / pop out" range. */
  tIn: number;
  tOut: number;
  /** Seconds of opacity ramp just inside tIn / just before tOut. */
  fadeIn: number;
  fadeOut: number;
  keyframes: Keyframe[];
  /** Non-null = cut this key colour out of the layer (video or image). */
  chroma: Chroma | null;
};

export type BaseClip = {
  uri: string;
  /** Source-time trim, in seconds. */
  trimIn: number;
  trimOut: number;
  /** 0.25–4. Output duration = (trimOut - trimIn) / speed. */
  speed: number;
  /** True = correct pitch back to normal after a speed change (chipmunk off). */
  preservePitch: boolean;
  muted: boolean;
};

export const DEFAULT_CHROMA: Chroma = { keyColor: [0.06, 0.72, 0.2], threshold: 0.35, smoothing: 0.15 };

export function makeKeyframe(t: number, over: Partial<Keyframe> = {}): Keyframe {
  return { t, x: 40, y: 40, scale: 1, rotation: 0, opacity: 100, easing: "linear", ...over };
}

/** Output (timeline) duration of a clip once trim + speed are applied. */
export function clipOutputDuration(clip: BaseClip): number {
  const span = Math.max(0, clip.trimOut - clip.trimIn);
  return span / Math.max(0.01, clip.speed);
}

/** Maps a timeline (output) time to the source-video time to sample. */
export function outputTimeToSource(clip: BaseClip, t: number): number {
  return clip.trimIn + t * Math.max(0.01, clip.speed);
}

function ease(p: number, kind: Easing): number {
  const c = Math.max(0, Math.min(1, p));
  switch (kind) {
    case "in":
      return c * c;
    case "out":
      return 1 - (1 - c) * (1 - c);
    case "inOut":
      return c < 0.5 ? 2 * c * c : 1 - 2 * (1 - c) * (1 - c);
    default:
      return c;
  }
}

/** Is this layer on screen at timeline time `t`? */
export function isVisibleAt(layer: Layer, t: number): boolean {
  return t >= layer.tIn && t <= layer.tOut;
}

/**
 * Interpolated transform at timeline time `t`. Holds the first/last keyframe
 * outside the keyframed range (no extrapolation) and eases between
 * neighbours using the EARLIER keyframe's easing.
 */
export function transformAt(layer: Layer, t: number): Keyframe {
  const kfs = layer.keyframes;
  if (kfs.length === 0) return makeKeyframe(t);
  if (kfs.length === 1) return { ...kfs[0], t };
  if (t <= kfs[0].t) return { ...kfs[0], t };
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return { ...last, t };

  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t || 1;
      const p = ease((t - a.t) / span, a.easing);
      return {
        t,
        x: a.x + (b.x - a.x) * p,
        y: a.y + (b.y - a.y) * p,
        scale: a.scale + (b.scale - a.scale) * p,
        rotation: a.rotation + (b.rotation - a.rotation) * p,
        opacity: a.opacity + (b.opacity - a.opacity) * p,
        easing: a.easing,
      };
    }
  }
  return { ...last, t };
}

/**
 * Final 0–1 alpha: the keyframed opacity multiplied by the in/out fade
 * envelope. Returns 0 outside the visibility window so callers can use this
 * alone to decide whether to draw at all.
 */
export function alphaAt(layer: Layer, t: number): number {
  if (!isVisibleAt(layer, t)) return 0;
  const base = transformAt(layer, t).opacity / 100;
  let env = 1;
  if (layer.fadeIn > 0 && t < layer.tIn + layer.fadeIn) {
    env = Math.min(env, (t - layer.tIn) / layer.fadeIn);
  }
  if (layer.fadeOut > 0 && t > layer.tOut - layer.fadeOut) {
    env = Math.min(env, (layer.tOut - t) / layer.fadeOut);
  }
  return Math.max(0, Math.min(1, base * Math.max(0, Math.min(1, env))));
}

/**
 * Dragging model, and the fix for the editor's worst bug: the old code
 * silently discarded a drag unless a keyframe already existed within 0.05s
 * of the playhead, which is why moving anything "didn't work".
 *
 * Now: a layer with a single keyframe is treated as static, so dragging just
 * moves it (whatever the playhead is doing). A layer with several keyframes
 * is animated, so dragging writes a keyframe at the playhead — updating one
 * that's already there, or inserting a new one that inherits the
 * interpolated values for everything the drag didn't touch.
 */
export function writeTransformAt(layer: Layer, t: number, patch: Partial<Keyframe>): Layer {
  const EPS = 0.04;

  if (layer.keyframes.length <= 1) {
    const base = layer.keyframes[0] ?? makeKeyframe(t);
    return { ...layer, keyframes: [{ ...base, ...patch, t: base.t }] };
  }

  const kfs = [...layer.keyframes];
  const idx = kfs.findIndex((k) => Math.abs(k.t - t) < EPS);
  if (idx >= 0) {
    kfs[idx] = { ...kfs[idx], ...patch };
  } else {
    kfs.push({ ...transformAt(layer, t), ...patch, t });
    kfs.sort((a, b) => a.t - b.t);
  }
  return { ...layer, keyframes: kfs };
}

/** Explicitly pins a keyframe at `t`, capturing the current interpolated pose. */
export function addKeyframeAt(layer: Layer, t: number): Layer {
  const EPS = 0.04;
  const pose = transformAt(layer, t);
  const kfs = layer.keyframes.filter((k) => Math.abs(k.t - t) >= EPS);
  kfs.push({ ...pose, t });
  kfs.sort((a, b) => a.t - b.t);
  return { ...layer, keyframes: kfs };
}

export function removeKeyframeAt(layer: Layer, t: number): Layer {
  const EPS = 0.04;
  // Never leave a layer with zero keyframes — it would lose its position.
  if (layer.keyframes.length <= 1) return layer;
  return { ...layer, keyframes: layer.keyframes.filter((k) => Math.abs(k.t - t) >= EPS) };
}

/** Moves an existing keyframe along the time axis (timeline drag). */
export function retimeKeyframe(layer: Layer, from: number, to: number): Layer {
  const EPS = 0.04;
  const clamped = Math.max(0, to);
  const kfs = layer.keyframes
    .map((k) => (Math.abs(k.t - from) < EPS ? { ...k, t: clamped } : k))
    .filter((k, i, arr) => arr.findIndex((o) => Math.abs(o.t - k.t) < EPS) === i)
    .sort((a, b) => a.t - b.t);
  return { ...layer, keyframes: kfs };
}

/** The natural on-screen footprint of a layer at scale 1, in preview points. */
export const IMAGE_BOX = 120;
export const VIDEO_BOX_W = 160;
export const VIDEO_BOX_H = 90;

/** Serializes layers for the native exporter. Field names must match LayerParser.kt. */
export function serializeLayers(layers: Layer[]): string {
  return JSON.stringify(
    layers.map((l) => ({
      kind: l.kind,
      uri: l.uri ?? null,
      text: l.text ?? null,
      color: l.color,
      fontSize: l.fontSize,
      tIn: l.tIn,
      tOut: l.tOut,
      fadeIn: l.fadeIn,
      fadeOut: l.fadeOut,
      keyframes: l.keyframes,
      keyColor: l.chroma ? l.chroma.keyColor : null,
      threshold: l.chroma ? l.chroma.threshold : null,
      smoothing: l.chroma ? l.chroma.smoothing : null,
    }))
  );
}
