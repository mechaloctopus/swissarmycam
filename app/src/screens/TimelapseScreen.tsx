import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { CameraView } from "expo-camera";
import * as Haptics from "expo-haptics";
import { C, F } from "../theme";
import { Label, Mono } from "../components/ui";
import { GridOverlay } from "../components/Overlays";
import { newTimelapseSession, saveTimelapseFrame } from "../store";

const INTERVALS = [1, 2, 5, 10, 30];

export default function TimelapseScreen() {
  const camRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [interval, setIntervalSec] = useState(2);
  const [running, setRunning] = useState(false);
  const [frames, setFrames] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const sessionRef = useRef<string | null>(null);
  const idxRef = useRef(0);
  const capturingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const grab = useCallback(async () => {
    if (!camRef.current || capturingRef.current || !sessionRef.current) return;
    capturingRef.current = true;
    try {
      const p = await camRef.current.takePictureAsync({ quality: 0.8, skipProcessing: true });
      if (p?.uri) {
        await saveTimelapseFrame(sessionRef.current, p.uri, idxRef.current++);
        setFrames(idxRef.current);
        Haptics.selectionAsync();
      }
    } catch {
      // drop this frame, keep rolling
    } finally {
      capturingRef.current = false;
    }
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    timerRef.current = null;
    elapsedRef.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    if (!ready) return;
    sessionRef.current = newTimelapseSession();
    idxRef.current = 0;
    setFrames(0);
    setElapsed(0);
    setRunning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    grab(); // first frame immediately
    timerRef.current = setInterval(grab, interval * 1000);
    elapsedRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  }, [ready, interval, grab]);

  useEffect(() => () => stop(), [stop]);

  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  // at 24fps, saved frames yield this much finished footage
  const outSec = (frames / 24).toFixed(1);

  return (
    <View style={styles.root}>
      <View style={styles.viewport}>
        <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} />
        <GridOverlay />
        <View style={styles.hud}>
          <View style={[styles.recPill, running && { borderColor: C.red }]}>
            <View style={[styles.recDot, { backgroundColor: running ? C.red : C.inkMute }]} />
            <Mono color={running ? C.red : C.inkMute} size={11}>{running ? "RECORDING" : "STANDBY"}</Mono>
          </View>
          <Mono color={C.inkSoft} size={11}>{mmss(elapsed)} · {frames} FR</Mono>
        </View>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
        <Label>§ Timelapse · Intervalometer</Label>

        <View style={styles.stats}>
          <Stat k="Frames" v={String(frames)} />
          <Stat k="Interval" v={`${interval}s`} />
          <Stat k="Output @24fps" v={`${outSec}s`} accent />
        </View>

        <Text style={styles.sub}>Interval</Text>
        <View style={styles.chips}>
          {INTERVALS.map((s) => (
            <Pressable key={s} disabled={running} onPress={() => setIntervalSec(s)} style={[styles.chip, interval === s && styles.chipOn, running && { opacity: 0.4 }]}>
              <Text style={{ color: interval === s ? "#fff" : C.inkSoft, fontFamily: F.mono, fontSize: 13 }}>{s}s</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={running ? stop : start} disabled={!ready} style={[styles.action, running ? styles.actionStop : styles.actionGo, !ready && { opacity: 0.5 }]}>
          <Text style={styles.actionText}>{running ? "■  Stop capture" : "●  Start timelapse"}</Text>
        </Pressable>

        <View style={styles.note}>
          <Mono color={C.device} size={10}>DEVICE-DEPENDENT</Mono>
          <Text style={styles.noteText}>
            Frames are saved locally as a set. Stitching frames into a finished MP4 (with easing and
            deflicker) ships with the native video module — Phase 3 on the roadmap. Your frames are safe until then.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Mono color={C.inkMute} size={10}>{k.toUpperCase()}</Mono>
      <Text style={{ color: accent ? C.red : C.ink, fontFamily: F.mono, fontSize: 22, marginTop: 4 }}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  viewport: { height: "42%", backgroundColor: "#000" },
  hud: { position: "absolute", top: 12, left: 14, right: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  recPill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(0,0,0,0.45)", borderWidth: 1, borderColor: C.line, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 40 },
  recDot: { width: 8, height: 8, borderRadius: 4 },
  panel: { flex: 1 },
  stats: { flexDirection: "row", gap: 10, marginTop: 18, marginBottom: 8 },
  stat: { flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 14 },
  sub: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 18, marginBottom: 10 },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 40, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  action: { marginTop: 22, borderRadius: 8, paddingVertical: 16, alignItems: "center" },
  actionGo: { backgroundColor: C.red },
  actionStop: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.red },
  actionText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 15 },
  note: { marginTop: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: C.device, borderRadius: 8, padding: 16, gap: 8 },
  noteText: { color: C.inkMute, fontSize: 13, lineHeight: 19 },
});
