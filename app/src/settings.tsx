import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Persistent, app-wide preferences — the backbone of "everything customizable".
 * Every screen reads and writes here; values survive app restarts.
 */
export type FlashMode = "off" | "on" | "auto";
export type Ratio = "4:3" | "16:9" | "1:1";
export type VideoQuality = "2160p" | "1080p" | "720p" | "480p";
export type GridType = "thirds" | "golden" | "square";

export type Settings = {
  // Photo
  cameraRatio: Ratio;
  pictureSize: string | null; // null = auto (highest available)
  jpegQuality: number; // 0.3–1.0

  // Video
  videoQuality: VideoQuality;
  videoBitrateMbps: number; // 0 = auto
  videoMaxSeconds: number; // 0 = unlimited

  // Audio
  micEnabled: boolean;
  micGain: number; // 0–100 (stored; input-gain applies with the native audio pipeline)

  // Capture defaults
  flashDefault: FlashMode;
  grid: boolean;
  gridType: GridType;
  level: boolean;
  reticle: boolean;
  timerDefault: number; // 0 / 3 / 10
  autoSaveToPhotos: boolean;
  haptics: boolean;
  shutterVolume: number; // 0–100 (feedback volume; stored)

  // Timelapse
  tlInterval: number; // seconds
  tlOutputFps: number; // for the output-length estimate
};

export const DEFAULTS: Settings = {
  cameraRatio: "16:9",
  pictureSize: null,
  jpegQuality: 0.95,

  videoQuality: "1080p",
  videoBitrateMbps: 0,
  videoMaxSeconds: 0,

  micEnabled: true,
  micGain: 70,

  flashDefault: "off",
  grid: true,
  gridType: "thirds",
  level: false,
  reticle: true,
  timerDefault: 0,
  autoSaveToPhotos: false,
  haptics: true,
  shutterVolume: 60,

  tlInterval: 2,
  tlOutputFps: 24,
};

const KEY = "sac.settings.v2";

type Ctx = {
  settings: Settings;
  ready: boolean;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
};

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
      } catch {
        // ignore — fall back to defaults
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persist = useCallback((next: Settings) => {
    setSettings(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const reset = useCallback(() => persist(DEFAULTS), [persist]);

  const value = useMemo(() => ({ settings, ready, update, reset }), [settings, ready, update, reset]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
