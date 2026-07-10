import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, ActivityIndicator } from "react-native";
import { CameraView, CameraType, FlashMode } from "expo-camera";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { C, F } from "../theme";
import { Mono } from "../components/ui";
import { GridOverlay, Reticle, LevelIndicator } from "../components/Overlays";
import { saveCapture, listCaptures } from "../store";
import { saveToPhotos } from "../media";

const FLASH_CYCLE: FlashMode[] = ["off", "auto", "on"];
const FLASH_GLYPH: Record<string, string> = { off: "⚡︎off", auto: "⚡︎auto", on: "⚡︎on" };
const ZOOMS = [
  { label: "1×", z: 0 },
  { label: "2×", z: 0.12 },
  { label: "5×", z: 0.35 },
];
const TIMERS = [0, 3, 10];

export default function CaptureScreen() {
  const camRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>("back");
  const [flash, setFlash] = useState<FlashMode>("off");
  const [zoomIdx, setZoomIdx] = useState(0);
  const [grid, setGrid] = useState(true);
  const [level, setLevel] = useState(false);
  const [reticle, setReticle] = useState(true);
  const [timerIdx, setTimerIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flashAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    listCaptures().then((c) => setLastThumb(c[0] ?? null));
  }, []);

  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1600);
  }, []);

  const doCapture = useCallback(async () => {
    if (!camRef.current || busy || !ready) return;
    setBusy(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await camRef.current.takePictureAsync({ quality: 0.95, skipProcessing: false });
      if (!photo?.uri) throw new Error("no uri");
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 1, duration: 40, useNativeDriver: true }),
        Animated.timing(flashAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
      const saved = await saveCapture(photo.uri);
      setLastThumb(saved);
      // best-effort mirror to Photos; silent if not permitted
      saveToPhotos(saved).then((ok) => showToast(ok ? "Saved · in-app + Photos" : "Saved · in-app"));
    } catch (e) {
      showToast("Capture failed");
    } finally {
      setBusy(false);
    }
  }, [busy, ready, flashAnim, showToast]);

  const onShutter = useCallback(() => {
    const t = TIMERS[timerIdx];
    if (t === 0) return doCapture();
    setCountdown(t);
    let n = t;
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(iv);
        setCountdown(0);
        doCapture();
      } else {
        setCountdown(n);
        Haptics.selectionAsync();
      }
    }, 1000);
  }, [timerIdx, doCapture]);

  const cycle = <T,>(arr: T[], cur: number, set: (n: number) => void) => set((cur + 1) % arr.length);

  return (
    <View style={styles.root}>
      <CameraView
        ref={camRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        flash={flash}
        zoom={ZOOMS[zoomIdx].z}
        onCameraReady={() => setReady(true)}
      />

      {/* overlays */}
      {grid && <GridOverlay />}
      {reticle && <Reticle />}
      {level && <LevelIndicator />}

      {/* shutter flash */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "#fff", opacity: flashAnim }]} />

      {/* top readout */}
      <View style={styles.top}>
        <View style={styles.readPill}>
          <View style={styles.recDot} />
          <Mono color={C.ink} size={11}>CAPTURE</Mono>
        </View>
        <Mono color={C.inkSoft} size={11}>ISO AUTO · 1/AUTO · AWB</Mono>
        <Pressable onPress={() => setFlash(FLASH_CYCLE[(FLASH_CYCLE.indexOf(flash) + 1) % 3])} style={styles.readPill}>
          <Mono color={flash === "off" ? C.inkMute : C.red} size={11}>{FLASH_GLYPH[flash]}</Mono>
        </Pressable>
      </View>

      {/* zoom presets */}
      <View style={styles.zoomRow}>
        {ZOOMS.map((z, i) => (
          <Pressable key={z.label} onPress={() => setZoomIdx(i)} style={[styles.zoomBtn, zoomIdx === i && styles.zoomBtnOn]}>
            <Text style={{ color: zoomIdx === i ? "#fff" : C.inkSoft, fontFamily: F.mono, fontSize: 12 }}>{z.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* tool drawer */}
      <View style={styles.tools}>
        <MiniTool glyph="#" label="Grid" on={grid} onPress={() => setGrid((v) => !v)} />
        <MiniTool glyph="⊹" label="Level" on={level} onPress={() => setLevel((v) => !v)} />
        <MiniTool glyph="✛" label="Reticle" on={reticle} onPress={() => setReticle((v) => !v)} />
        <MiniTool glyph="⧗" label={`Timer ${TIMERS[timerIdx]}s`} on={timerIdx > 0} onPress={() => cycle(TIMERS, timerIdx, setTimerIdx)} />
      </View>

      {/* shutter row */}
      <View style={styles.bottom}>
        <Pressable onPress={() => { /* opened via tab, thumbnail is a hint */ showToast("Open Library tab to view"); }} style={styles.thumb}>
          {lastThumb ? <Image source={{ uri: lastThumb }} style={styles.thumbImg} contentFit="cover" /> : <Text style={{ color: C.inkFaint, fontSize: 20 }}>▦</Text>}
        </Pressable>

        <Pressable onPress={onShutter} disabled={busy || !ready} style={styles.shutterOuter}>
          <View style={[styles.shutterInner, busy && { backgroundColor: C.redBright }]}>
            {busy ? <ActivityIndicator color="#fff" /> : null}
          </View>
        </Pressable>

        <Pressable onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))} style={styles.flip}>
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
  zoomRow: { position: "absolute", bottom: 176, alignSelf: "center", flexDirection: "row", gap: 8, backgroundColor: "rgba(0,0,0,0.4)", padding: 5, borderRadius: 40 },
  zoomBtn: { width: 40, height: 30, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  zoomBtnOn: { backgroundColor: "rgba(224,35,28,0.9)" },
  tools: { position: "absolute", bottom: 120, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 22 },
  mini: { alignItems: "center", width: 58 },
  miniIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)", borderWidth: 1, borderColor: C.lineStrong },
  miniLabel: { fontFamily: F.mono, fontSize: 8.5, color: C.inkSoft, marginTop: 5, letterSpacing: 0.3, textTransform: "uppercase" },
  bottom: { position: "absolute", bottom: 24, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 26 },
  thumb: { width: 52, height: 52, borderRadius: 8, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  thumbImg: { width: "100%", height: "100%" },
  shutterOuter: { width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.red },
  flip: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  countWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  count: { color: "#fff", fontSize: 96, fontFamily: F.mono, opacity: 0.9 },
  toast: { position: "absolute", bottom: 108, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.75)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 40, borderWidth: 1, borderColor: C.line },
  loading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
});
