import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, ActivityIndicator, Modal, ScrollView } from "react-native";
import { CameraView, CameraType, CameraMode, useMicrophonePermissions } from "expo-camera";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { C, F } from "../theme";
import { Mono } from "../components/ui";
import { Slider } from "../components/controls";
import { GridOverlay, Reticle, LevelIndicator } from "../components/Overlays";
import { saveCapture, saveVideo, listMedia, MediaItem } from "../store";
import { saveToPhotos } from "../media";
import { savePictureSizes } from "../caps";
import { PalettePanel, TextResult, SceneResult } from "../components/PalettePanel";
import { extractPalette, extractText, labelScene, Swatch, TextScan, SceneLabel } from "../analyze";
import { useSettings, FlashMode } from "../settings";

const FLASH_CYCLE: FlashMode[] = ["off", "auto", "on"];
const FLASH_GLYPH: Record<string, string> = { off: "⚡ off", auto: "⚡ auto", on: "⚡ on" };
const TIMERS = [0, 3, 10];
const UNLOCK_HOLD_MS = 1200;

// Approximate lens stops. On devices whose camera exposes an ultra-wide through
// the zoom range (e.g. Pixel 9 Pro), zoom 0 reaches ~0.5×. Values are perceptual
// (CameraX linear zoom); precise per-lens calibration lands with the native module.
const STOPS = [
  { label: "0.5×", z: 0 },
  { label: "1×", z: 0.08 },
  { label: "2×", z: 0.2 },
  { label: "5×", z: 0.6 },
];

export default function CaptureScreen({ focused }: { focused: boolean }) {
  const { settings, update } = useSettings();
  const camRef = useRef<CameraView>(null);
  const [micPerm, requestMic] = useMicrophonePermissions();

  const [facing, setFacing] = useState<CameraType>("back");
  const [mode, setMode] = useState<CameraMode>("picture");
  const [zoom, setZoom] = useState(0);
  const [torch, setTorch] = useState(false);
  const [everReady, setEverReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [last, setLast] = useState<MediaItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  // Visual intelligence, folded in from the old separate Lab tab: analysis
  // runs on the most recent photo rather than a throwaway extra capture.
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [palette, setPalette] = useState<Swatch[]>([]);
  const [ocr, setOcr] = useState<TextScan | null>(null);
  const [scene, setScene] = useState<SceneLabel[]>([]);

  const flashAnim = useRef(new Animated.Value(0)).current;
  const unlockAnim = useRef(new Animated.Value(0)).current;
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sizesFetched = useRef(false);

  // Underwater / record lock: once engaged, every control except the
  // hold-to-unlock button ignores touch — a stray droplet or water pressure
  // on the screen can't stop recording, flip the camera, or change modes.
  useEffect(() => {
    if (recording && settings.underwaterLock) setLocked(true);
    if (!recording) setLocked(false);
  }, [recording, settings.underwaterLock]);

  // Keep the screen awake for the whole recording — a locked screen mid-dive
  // is as bad as an accidental stop-touch.
  useEffect(() => {
    if (recording) {
      activateKeepAwakeAsync("lensii-recording").catch(() => {});
      return () => {
        deactivateKeepAwake("lensii-recording").catch(() => {});
      };
    }
  }, [recording]);

  const beginUnlockHold = useCallback(() => {
    unlockAnim.setValue(0);
    Animated.timing(unlockAnim, { toValue: 1, duration: UNLOCK_HOLD_MS, useNativeDriver: false }).start();
    unlockTimer.current = setTimeout(() => {
      setLocked(false);
      unlockAnim.setValue(0);
      if (settings.haptics) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, UNLOCK_HOLD_MS);
  }, [unlockAnim, settings.haptics]);

  const cancelUnlockHold = useCallback(() => {
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    unlockTimer.current = null;
    Animated.timing(unlockAnim, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  }, [unlockAnim]);

  useEffect(() => {
    listMedia().then((m) => setLast(m[0] ?? null));
  }, []);

  // Fallback: never let the init overlay stick permanently.
  useEffect(() => {
    if (!focused || everReady) return;
    const t = setTimeout(() => setEverReady(true), 2500);
    return () => clearTimeout(t);
  }, [focused, everReady]);

  // If we leave the tab mid-recording, stop cleanly.
  useEffect(() => {
    if (!focused && recording) camRef.current?.stopRecording();
  }, [focused, recording]);

  useEffect(() => () => {
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
  }, []);

  /**
   * Runs the three on-device analysers over the last photo. Each is
   * independent, so one failing (no text found, labeller unavailable) still
   * lets the others report.
   */
  const runAnalysis = useCallback(async () => {
    if (!last || last.kind !== "photo") {
      showToast("Take a photo first");
      return;
    }
    setAnalyzeOpen(true);
    setAnalyzing(true);
    setPalette([]);
    setOcr(null);
    setScene([]);
    const uri = last.uri;
    const [p, t, s] = await Promise.all([
      extractPalette(uri).catch(() => []),
      extractText(uri).catch(() => ({ text: "", lines: 0, words: 0 })),
      labelScene(uri).catch(() => []),
    ]);
    setPalette(p);
    setOcr(t);
    setScene(s);
    setAnalyzing(false);
  }, [last]);

  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1600);
  }, []);

  const haptic = useCallback(
    (style: Haptics.ImpactFeedbackStyle) => {
      if (settings.haptics) Haptics.impactAsync(style);
    },
    [settings.haptics]
  );

  const onReady = useCallback(() => {
    setEverReady(true);
    if (!sizesFetched.current) {
      sizesFetched.current = true;
      camRef.current?.getAvailablePictureSizesAsync?.().then((s) => s && savePictureSizes(s)).catch(() => {});
    }
  }, []);

  /* ---------- Photo ---------- */
  const takePhoto = useCallback(async () => {
    if (!camRef.current || busy) return;
    setBusy(true);
    try {
      haptic(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await camRef.current.takePictureAsync({ quality: settings.jpegQuality });
      if (!photo?.uri) throw new Error("no uri");
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 1, duration: 40, useNativeDriver: true }),
        Animated.timing(flashAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
      const saved = await saveCapture(photo.uri);
      setLast({ uri: saved, kind: "photo", name: saved });
      if (settings.autoSaveToPhotos) saveToPhotos(saved).then((ok) => showToast(ok ? "Saved · in-app + Photos" : "Saved · in-app"));
      else showToast("Saved · in-app");
    } catch {
      showToast("Capture failed");
    } finally {
      setBusy(false);
    }
  }, [busy, settings.jpegQuality, settings.autoSaveToPhotos, flashAnim, haptic, showToast]);

  const onShutterPhoto = useCallback(() => {
    const t = settings.timerDefault;
    if (t === 0) return takePhoto();
    setCountdown(t);
    let n = t;
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(iv);
        setCountdown(0);
        takePhoto();
      } else {
        setCountdown(n);
        haptic(Haptics.ImpactFeedbackStyle.Light);
      }
    }, 1000);
  }, [settings.timerDefault, takePhoto, haptic]);

  /* ---------- Video ---------- */
  const startRecording = useCallback(async () => {
    if (!camRef.current || recording) return;
    if (settings.micEnabled && !micPerm?.granted) await requestMic();
    setRecording(true);
    setElapsed(0);
    elapsedTimer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    haptic(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const opts: { maxDuration?: number } = {};
      if (settings.videoMaxSeconds > 0) opts.maxDuration = settings.videoMaxSeconds;
      const video = await camRef.current.recordAsync(opts);
      if (video?.uri) {
        const saved = await saveVideo(video.uri);
        setLast({ uri: saved, kind: "video", name: saved });
        if (settings.autoSaveToPhotos) saveToPhotos(saved).then((ok) => showToast(ok ? "Video saved · in-app + Photos" : "Video saved · in-app"));
        else showToast("Video saved · in-app");
      }
    } catch {
      showToast("Recording failed");
    } finally {
      setRecording(false);
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
      elapsedTimer.current = null;
    }
  }, [recording, settings.micEnabled, settings.videoMaxSeconds, settings.autoSaveToPhotos, micPerm, requestMic, haptic, showToast]);

  const stopRecording = useCallback(() => {
    if (!recording) return;
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    camRef.current?.stopRecording();
  }, [recording, haptic]);

  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const activeStop = STOPS.find((s) => Math.abs(s.z - zoom) < 0.02);
  const resLabel = mode === "picture" ? (settings.pictureSize ? settings.pictureSize.split("x")[0] + "px" : "PHOTO") : settings.videoQuality;

  return (
    <View style={styles.root}>
      <CameraView
        ref={camRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode={mode}
        active={focused}
        flash={settings.flashDefault}
        enableTorch={torch}
        zoom={zoom}
        pictureSize={mode === "picture" && settings.pictureSize ? settings.pictureSize : undefined}
        videoQuality={mode === "video" ? settings.videoQuality : undefined}
        mute={!settings.micEnabled}
        animateShutter={false}
        onCameraReady={onReady}
        onMountError={() => showToast("Camera error — retrying")}
      />

      {settings.grid && <GridOverlay kind={settings.gridType} />}
      {settings.reticle && <Reticle />}
      {settings.level && <LevelIndicator />}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "#fff", opacity: flashAnim }]} />

      {/* Everything below is dead to touch while locked — only the unlock control (rendered
          outside this wrapper) stays live, so a wet screen can't stop recording or change modes. */}
      <View pointerEvents={locked ? "none" : "box-none"} style={StyleSheet.absoluteFill}>
        {/* top readout */}
        <View style={styles.top}>
          <View style={styles.readPill}>
            <View style={[styles.recDot, { backgroundColor: recording ? C.red : C.inkMute }]} />
            <Mono color={C.ink} size={11}>{recording ? "REC " + mmss(elapsed) : mode === "video" ? "VIDEO" : "PHOTO"}</Mono>
          </View>
          <Mono color={C.inkSoft} size={11}>{resLabel} · {settings.micEnabled ? "MIC" : "MUTE"}</Mono>
          {mode === "picture" ? (
            <Pressable onPress={() => update({ flashDefault: FLASH_CYCLE[(FLASH_CYCLE.indexOf(settings.flashDefault) + 1) % 3] })} style={styles.readPill}>
              <Mono color={settings.flashDefault === "off" ? C.inkMute : C.red} size={11}>{FLASH_GLYPH[settings.flashDefault]}</Mono>
            </Pressable>
          ) : (
            <Pressable onPress={() => setTorch((t) => !t)} style={styles.readPill}>
              <Mono color={torch ? C.red : C.inkMute} size={11}>{torch ? "TORCH ON" : "TORCH"}</Mono>
            </Pressable>
          )}
        </View>

        {/* lens stops */}
        <View style={styles.stops}>
          {STOPS.map((s) => {
            const on = activeStop?.label === s.label;
            return (
              <Pressable key={s.label} onPress={() => setZoom(s.z)} style={[styles.stop, on && styles.stopOn]}>
                <Text style={{ color: on ? "#fff" : C.inkSoft, fontFamily: F.mono, fontSize: 12 }}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* fine zoom slider */}
        <View style={styles.zoomWrap}>
          <Slider value={zoom} min={0} max={1} step={0.01} onChange={setZoom} width={210} />
        </View>

        {/* tool drawer */}
        <View style={styles.tools}>
          <MiniTool glyph="#" label={settings.gridType} on={settings.grid} onPress={() => update({ grid: !settings.grid })} />
          <MiniTool glyph="⊹" label="Level" on={settings.level} onPress={() => update({ level: !settings.level })} />
          <MiniTool glyph="✛" label="Reticle" on={settings.reticle} onPress={() => update({ reticle: !settings.reticle })} />
          <MiniTool glyph="⧗" label={settings.timerDefault > 0 ? `Timer ${settings.timerDefault}s` : "Timer off"} on={settings.timerDefault > 0} onPress={() => update({ timerDefault: TIMERS[(TIMERS.indexOf(settings.timerDefault) + 1) % TIMERS.length] })} />
          <MiniTool glyph="⬥" label="Underwater" on={settings.underwaterLock} onPress={() => update({ underwaterLock: !settings.underwaterLock })} />
          <MiniTool glyph="⌬" label="Analyze" onPress={runAnalysis} />
        </View>

        {/* mode switch */}
        <View style={styles.modeRow}>
          <Pressable onPress={() => !recording && setMode("picture")} style={[styles.modeItem, mode === "picture" && styles.modeItemOn]}>
            <Text style={[styles.modeText, mode === "picture" && { color: C.red }]}>PHOTO</Text>
          </Pressable>
          <Pressable onPress={() => !recording && setMode("video")} style={[styles.modeItem, mode === "video" && styles.modeItemOn]}>
            <Text style={[styles.modeText, mode === "video" && { color: C.red }]}>VIDEO</Text>
          </Pressable>
        </View>

        {/* shutter row */}
        <View style={styles.bottom}>
          <Pressable onPress={() => showToast("Open the Library tab to view")} style={styles.thumb}>
            {last?.kind === "photo" ? (
              <Image source={{ uri: last.uri }} style={styles.thumbImg} contentFit="cover" />
            ) : last?.kind === "video" ? (
              <Text style={{ color: C.ink, fontSize: 18 }}>▶</Text>
            ) : (
              <Text style={{ color: C.inkFaint, fontSize: 20 }}>▦</Text>
            )}
          </Pressable>

          {mode === "picture" ? (
            <Pressable onPress={onShutterPhoto} disabled={busy} style={styles.shutterOuter}>
              <View style={[styles.shutterInner, busy && { backgroundColor: C.redBright }]}>{busy ? <ActivityIndicator color="#fff" /> : null}</View>
            </Pressable>
          ) : (
            <Pressable onPress={recording ? stopRecording : startRecording} style={styles.shutterOuter}>
              <View style={recording ? styles.recStop : styles.shutterInner} />
            </Pressable>
          )}

          <Pressable onPress={() => !recording && setFacing((f) => (f === "back" ? "front" : "back"))} style={styles.flip}>
            <Text style={{ color: C.inkSoft, fontSize: 20 }}>⟲</Text>
          </Pressable>
        </View>
      </View>

      {/* manual lock engage — live even when not recording, for e.g. locking before descent */}
      {!locked && (
        <Pressable onPress={() => setLocked(true)} style={styles.lockBtn}>
          <Text style={{ fontSize: 16 }}>🔓</Text>
        </Pressable>
      )}

      {locked && (
        <View pointerEvents="box-none" style={styles.lockedWrap}>
          <View pointerEvents="none" style={styles.lockedBanner}>
            <Mono color="#fff" size={11}>🔒 LOCKED — touch is disabled while recording</Mono>
          </View>
          <Pressable onPressIn={beginUnlockHold} onPressOut={cancelUnlockHold} style={styles.unlockBtn}>
            <Animated.View
              style={[
                styles.unlockFill,
                {
                  transform: [
                    {
                      scale: unlockAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
                    },
                  ],
                },
              ]}
            />
            <Text style={{ fontSize: 20 }}>🔒</Text>
          </Pressable>
          <Mono color="rgba(255,255,255,0.8)" size={10} style={{ marginTop: 8 }}>hold 1.2s to unlock</Mono>
        </View>
      )}

      {countdown > 0 && (
        <View pointerEvents="none" style={styles.countWrap}>
          <Text style={styles.count}>{countdown}</Text>
        </View>
      )}

      {toast && (
        <View pointerEvents="none" style={styles.toast}>
          <Mono color={C.ink} size={12}>{toast}</Mono>
        </View>
      )}

      {!everReady && (
        <View style={styles.loading}>
          <ActivityIndicator color={C.red} />
          <Mono color={C.inkMute} size={11} style={{ marginTop: 10 }}>INITIALISING SENSOR…</Mono>
        </View>
      )}

      <Modal visible={analyzeOpen} transparent animationType="slide" onRequestClose={() => setAnalyzeOpen(false)}>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Mono color={C.ink} size={12}>VISUAL INTELLIGENCE · LAST PHOTO</Mono>
              <Pressable onPress={() => setAnalyzeOpen(false)} hitSlop={10}>
                <Text style={{ color: C.inkMute, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <PalettePanel swatches={palette} loading={analyzing} />
              <TextResult scan={ocr} loading={analyzing} />
              <SceneResult labels={scene} loading={analyzing} />
              <Mono color={C.inkFaint} size={9.5} style={{ marginTop: 14 }}>
                Colour, text (OCR) and scene labels are all computed on-device — nothing is uploaded.
              </Mono>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MiniTool({ glyph, label, on, onPress }: { glyph: string; label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.mini}>
      <View style={[styles.miniIcon, on && { backgroundColor: C.red, borderColor: C.red }]}>
        <Text style={{ color: on ? "#fff" : C.inkSoft, fontSize: 15 }}>{glyph}</Text>
      </View>
      <Text style={styles.miniLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  lockBtn: { position: "absolute", top: 12, right: 14, width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.lineStrong },
  lockedWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.15)" },
  sheetWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { maxHeight: "78%", backgroundColor: C.bg2, borderTopWidth: 1, borderTopColor: C.lineStrong, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 18 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  lockedBanner: { position: "absolute", top: 12, left: 14, right: 14, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 40, paddingVertical: 8, alignItems: "center" },
  unlockBtn: { width: 84, height: 84, borderRadius: 42, borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  unlockFill: { position: "absolute", width: 84, height: 84, borderRadius: 42, backgroundColor: C.red },
  top: { position: "absolute", top: 12, left: 14, right: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  readPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 40 },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.red },
  stops: { position: "absolute", bottom: 250, alignSelf: "center", flexDirection: "row", gap: 6, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 40, padding: 4 },
  stop: { width: 44, height: 32, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  stopOn: { backgroundColor: "rgba(224,35,28,0.9)" },
  zoomWrap: { position: "absolute", bottom: 208, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.3)", paddingHorizontal: 14, borderRadius: 20 },
  tools: { position: "absolute", bottom: 150, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 22 },
  mini: { alignItems: "center", width: 58 },
  miniIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)", borderWidth: 1, borderColor: C.lineStrong },
  miniLabel: { fontFamily: F.mono, fontSize: 8.5, color: C.inkSoft, marginTop: 5, letterSpacing: 0.3, textTransform: "uppercase" },
  modeRow: { position: "absolute", bottom: 112, alignSelf: "center", flexDirection: "row", gap: 6, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 40, padding: 4 },
  modeItem: { paddingHorizontal: 18, paddingVertical: 7, borderRadius: 40 },
  modeItemOn: { backgroundColor: "rgba(255,255,255,0.1)" },
  modeText: { fontFamily: F.mono, fontSize: 12, letterSpacing: 1, color: C.inkMute },
  bottom: { position: "absolute", bottom: 24, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 26 },
  thumb: { width: 52, height: 52, borderRadius: 8, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  thumbImg: { width: "100%", height: "100%" },
  shutterOuter: { width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.red },
  recStop: { width: 34, height: 34, borderRadius: 7, backgroundColor: C.red },
  flip: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  countWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  count: { color: "#fff", fontSize: 96, fontFamily: F.mono, opacity: 0.9 },
  toast: { position: "absolute", bottom: 100, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.75)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 40, borderWidth: 1, borderColor: C.line },
  loading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
});
