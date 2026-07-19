import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import { createElement, useEffect } from "react";
import type { ComponentType } from "react";
import { View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

type NativeArTraceModule = {
  isAvailable(): boolean;
  checkAvailability(): Promise<string>;
  requestInstall(): Promise<string>;
};

let native: NativeArTraceModule | null = null;
function getNative(): NativeArTraceModule | null {
  if (native) return native;
  try {
    native = requireNativeModule<NativeArTraceModule>("ArTrace");
  } catch {
    native = null;
  }
  return native;
}

/** Android only — false on any other platform or if linking somehow failed. */
export function isArTraceAvailable(): boolean {
  try {
    return getNative()?.isAvailable() ?? false;
  } catch {
    return false;
  }
}

export type ArAvailability =
  | "SUPPORTED_INSTALLED"
  | "SUPPORTED_APK_TOO_OLD"
  | "SUPPORTED_NOT_INSTALLED"
  | "UNSUPPORTED_DEVICE_NOT_CAPABLE"
  | "UNKNOWN_CHECKING"
  | "UNKNOWN_ERROR"
  | "UNKNOWN_TIMED_OUT"
  | "UNAVAILABLE";

/** Whether this device can run ARCore, and whether Google Play Services for AR is installed. */
export async function checkArAvailability(): Promise<ArAvailability> {
  const mod = getNative();
  if (!mod) return "UNAVAILABLE";
  try {
    return (await mod.checkAvailability()) as ArAvailability;
  } catch {
    return "UNAVAILABLE";
  }
}

/** Launches Google's own consent/install flow for Google Play Services for AR. */
export async function requestArInstall(): Promise<string> {
  const mod = getNative();
  if (!mod) throw new Error("AR Trace is not available on this build");
  return mod.requestInstall();
}

export type ArTrackingState = "TRACKING" | "PAUSED" | "STOPPED";

export type ArTraceViewProps = {
  style?: StyleProp<ViewStyle>;
  /** file:// URI (or content URI) of the reference image to trace/project. Null clears it. */
  imageUri?: string | null;
  overlayOpacity?: number;
  /** Multiplier on the traced quad's physical size — does not move or resize the anchor. */
  overlayScale?: number;
  /** Degrees, rotates the overlay around the anchor's surface normal. */
  overlayRotation?: number;
  /** Metres, offsets the overlay from the anchor within the locked surface's plane. */
  overlayOffsetX?: number;
  overlayOffsetY?: number;
  /** Digital zoom (>= 1) applied to the rendered camera feed AND overlay together. Never touches the anchor. */
  cameraZoom?: number;
  /** Normalized [0,1] tap location within the view; read when placeAnchorTrigger changes. */
  placeAnchorX?: number;
  placeAnchorY?: number;
  /** Bump this (e.g. an incrementing counter) to hit-test at placeAnchorX/Y and (re)lock the anchor there. */
  placeAnchorTrigger?: number;
  /** Bump this to detach the current anchor so the next tap can place a new one. */
  resetTrigger?: number;
  /** Pauses the AR session (e.g. screen not focused) without tearing down the view. */
  paused?: boolean;
  onTrackingStateChange?: (e: { nativeEvent: { state: ArTrackingState } }) => void;
  onAnchorPlaced?: (e: { nativeEvent: { success: boolean } }) => void;
  onArError?: (e: { nativeEvent: { message: string } }) => void;
};

// Resolved lazily (on first render) rather than at module-load time — this is
// the first native View component in this codebase, and a failure to resolve
// it must not be able to crash the whole JS bundle before anything renders.
let resolvedNativeView: ComponentType<any> | null | undefined;
function resolveNativeView(): ComponentType<any> | null {
  if (resolvedNativeView !== undefined) return resolvedNativeView;
  try {
    resolvedNativeView = requireNativeViewManager("ArTrace");
  } catch {
    resolvedNativeView = null;
  }
  return resolvedNativeView;
}

/**
 * Native ARCore view: camera background + a world-anchored overlay image.
 * Tap-to-place is driven by props (placeAnchorX/Y + placeAnchorTrigger)
 * rather than native touch handling, so JS gesture code (pan for offset,
 * pinch for scale/rotation) stays free to own the touch surface.
 */
export const ArTraceView: ComponentType<ArTraceViewProps> = (props: ArTraceViewProps) => {
  const Native = resolveNativeView();
  useEffect(() => {
    if (!Native) props.onArError?.({ nativeEvent: { message: "AR view could not be created on this build" } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Native]);
  if (!Native) return createElement(View, { style: props.style });
  return createElement(Native, props);
};
