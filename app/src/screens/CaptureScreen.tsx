import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, ActivityIndicator } from "react-native";
import { CameraView, CameraType, CameraMode, useMicrophonePermissions } from "expo-camera";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { C, F } from "../theme";
import { Mono } from "../components/ui";
import { Slider } from "../components/controls";
import { GridOverlay, Reticle, LevelIndicator } from "../components/Overlays";
import { saveCapture, saveVideo, listMedia, MediaItem } from "../store";
import { saveToPhotos } from "../media";
import { savePictureSizes } from "../caps";
import { useSettings, FlashMode } from "../settings";

const FLASH_CYCLE: FlashMode[] = ["off", "auto", "on"];
const FLASH_GLYPH: Record<string, string> = { off: "⚡ off", auto: "⚡ auto", on: "⚡ on" };
const TIMERS = [0, 3, 10];

export default function CaptureScreen() {
  const { settings, update } = useSettings();
  const camRef = useRef<CameraView>(null);
  const [micPerm, requestMic] = useMicrophonePermissions();

  const [facing, setFacing] = useState<CameraType>("back");
  const [mode, setMode] = useState<CameraMode>("picture");
  const [zoom, setZoom] = useState(0);
  const [torch, setTorch] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [last, setLast] = useState<MediaItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flashAnim = useRef(new Animated.Value(0)).current;
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    listMedia().then((m) => setLast(m[0] ?? null));
  }, []);

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

  /* ---------- Photo ---------- */
  const takePhoto = useCallback(async () => {
    if (!camRef.current || busy || !ready) return;
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
  }, [busy, ready, settings.jpegQuality, settings.autoSaveToPhotos, flashAnim, haptic, showToast]);

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
  const startElapsed = () => {
    setElapsed(0);
    elapsedTimer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  };
  const stopElapsed = () => {
    if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    elapsedTimer.current = null;
  };

  const startRecording = useCallback(async () => {
    if (!camRef.current || recording || !ready) return;
    if (settings.micEnabled && !micPerm?.granted) {
      await requestMic();
    }
    setRecording(true);
    startElapsed();
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
      stopElapsed();
    }
  }, [recording, ready, settings.micEnabled, settings.videoMaxSeconds, settings.autoSaveToPhotos, micPerm, requestMic, haptic, showToast]);

  const stopRecording = useCallback(() => {
    if (!recording) return;
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    camRef.current?.stopRecording();
  }, [recording, haptic]);

  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const zoomLabel = `${(1 + zoom * 9).toFixed(1)}×`;
  const resLabel = mode === "picture" ? (settings.pictureSize ? settings.pictureSize.split("x")[0] + "px" : settings.cameraRatio) : settings.videoQuality;

  return (
    <View style={styles.root}>
      <CameraView
        ref={camRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode={mode}
        flash={settings.flashDefault}
        enableTorch={torch}
        zoom={zoom}
        ratio={settings.cameraRatio}
        pictureSize={mode === "picture" && settings.pictureSize ? settings.pictureSize : undefined}
        videoQuality={settings.videoQuality}
        mute={!settings.micEnabled}
        animateShutter={false}
        onCameraReady={() => {
          setReady(true);
          camRef.current?.getAvailablePictureSizesAsync?.().then((s) => s && savePictureSizes(s)).catch(() => {});
        }}
      />

      {settings.grid && <GridOverlay kind={settings.gridType} />}
      {settings.reticle && <Reticle />}
      {settings.level && <LevelIndicator />}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "#fff", opacity: flashAnim }]} />

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

      {/* zoom slider */}
      <View style={styles.zoomWrap}>
        <Mono color={C.inkSoft} size={11}>{zoomLabel}</Mono>
        <Slider value={zoom} min={0} max={1} step={0.01} onChange={setZoom} width={200} />
      </View>

      {/* tool drawer */}
      <View style={styles.tools}>
        <MiniTool glyph="#" label={settings.gridType} on={settings.grid} onPress={() => update({ grid: !settings.grid })} />
        <MiniTool glyph="⊹" label="Level" on={settings.level} onPress={() => update({ level: !settings.level })} />
        <MiniTool glyph="✛" label="Reticle" on={settings.reticle} onPress={() => update({ reticle: !settings.reticle })} />
        <MiniTool glyph="⧗" label={`Timer ${settings.timerDefault}s`} on={settings.timerDefault > 0} onPress={() => update({ timerDefault: TIMERS[(TIMERS.indexOf(settings.timerDefault) + 1) % TIMERS.length] })} />
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
          <Pressable onPress={onShutterPhoto} disabled={busy || !ready} style={styles.shutterOuter}>
            <View style={[styles.shutterInner, busy && { backgroundColor: C.redBright }]}>{busy ? <ActivityIndicator color="#fff" /> : null}</View>
          </Pressable>
        ) : (
          <Pressable onPress={recording ? stopRecording : startRecording} disabled={!ready} style={styles.shutterOuter}>
            <View style={recording ? styles.recStop : styles.shutterInner} />
          </Pressable>
        )}

        <Pressable onPress={() => !recording && setFacing((f) => (f === "back" ? "front" : "back"))} style={styles.flip}>
          <Text style={{ color: C.inkSoft, fontSize: 20 }}>⟲</Text>
        </Pressable>
      </View>

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

      {!ready && (
        <View style={styles.loading}>
          <ActivityIndicator color={C.red} />
          <Mono color={C.inkMute} size={11} style={{ marginTop: 10 }}>INITIALISING SENSOR…</Mono>
        </View>
      )}
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
  top: { position: "absolute", top: 12, left: 14, right: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  readPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 40 },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.red },
  zoomWrap: { position: "absolute", bottom: 214, alignSelf: "center", alignItems: "center", gap: 2, backgroundColor: "rgba(0,0,0,0.35)", paddingHorizontal: 14, paddingVertical: 4, borderRadius: 16 },
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
