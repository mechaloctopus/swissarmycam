import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, PermissionsAndroid, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { C, F } from "../theme";
import { Label, Mono, StatusPill } from "../components/ui";
import { newVideoOutputPath } from "../store";
import { saveToPhotos } from "../media";
import { useSettings } from "../settings";
import { isScreenRecorderAvailable, isRecording as nativeIsRecording, startRecording, stopRecording } from "screen-recorder";

export default function ScreenRecordScreen() {
  const { settings } = useSettings();
  const available = isScreenRecorderAvailable();
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [withMic, setWithMic] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outputUriRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1800);
  };

  const start = async () => {
    if (!available || starting || recording) return;
    setStarting(true);
    try {
      // Android 13+ requires this to actually show the persistent recording
      // notification the foreground service depends on — best-effort: the
      // service still starts either way, this just governs whether the
      // "tap to stop" notification is visible.
      if (Platform.OS === "android" && Platform.Version >= 33) {
        try {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        } catch {
          // ignore — proceed regardless of grant result
        }
      }
      const { uri, path } = await newVideoOutputPath();
      outputUriRef.current = uri;
      const ok = await startRecording(path, withMic);
      if (ok) {
        setRecording(true);
        setElapsed(0);
        if (settings.haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
        flash("Recording — check the notification to stop anytime");
      } else {
        flash("Permission declined or already recording");
      }
    } catch {
      flash("Couldn't start recording");
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (!recording) return;
    if (timerRef.current) clearInterval(timerRef.current);
    if (settings.haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const path = await stopRecording();
      setRecording(false);
      if (path) {
        flash("Saved to Library");
        if (settings.autoSaveToPhotos && outputUriRef.current) saveToPhotos(outputUriRef.current);
      } else {
        flash("Recording stopped");
      }
    } catch {
      setRecording(false);
      flash("Recording stopped");
    }
  };

  // Reconcile with native state if this screen re-mounts mid-recording.
  useEffect(() => {
    if (available) setRecording(nativeIsRecording());
  }, [available]);

  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  if (!available) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Label>§ Screen · Recording studio</Label>
        <Text style={styles.title}>Not available on this build</Text>
        <View style={{ marginVertical: 14 }}>
          <StatusPill label="Requires native module" tone={C.native} />
        </View>
        <Text style={styles.body}>
          Screen recording needs the Android MediaProjection native module, which ships with the
          Android build of Lensii. If you're seeing this, the module didn't link into this build —
          check Settings for the build version.
        </Text>
      </ScrollView>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <View style={[styles.indicator, recording && styles.indicatorOn]}>
          <View style={[styles.dot, recording && styles.dotOn]} />
        </View>
        <Text style={styles.big}>{recording ? mmss(elapsed) : "Ready"}</Text>
        <Mono color={recording ? C.red : C.inkMute} size={12} style={{ marginTop: 6, letterSpacing: 1.5 }}>
          {recording ? "RECORDING · SYSTEM-WIDE" : "STANDBY"}
        </Mono>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
        <Label>§ Screen · Recording studio</Label>

        <View style={styles.micRow}>
          <Text style={styles.micLabel}>Record microphone</Text>
          <Pressable onPress={() => !recording && setWithMic((v) => !v)} style={[styles.micToggle, withMic && styles.micToggleOn]}>
            <Text style={{ color: withMic ? "#fff" : C.inkSoft, fontFamily: F.mono, fontSize: 12 }}>{withMic ? "ON" : "OFF"}</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={recording ? stop : start}
          disabled={starting}
          style={[styles.action, recording ? styles.actionStop : styles.actionGo, starting && { opacity: 0.6 }]}
        >
          <Text style={styles.actionText}>
            {starting ? "Waiting for permission…" : recording ? "■  Stop recording" : "●  Start screen recording"}
          </Text>
        </Pressable>

        <View style={styles.note}>
          <Mono color={C.go} size={10}>REAL · MEDIAPROJECTION</Mono>
          <Text style={styles.noteText}>
            Starting shows Android's own screen-share consent — this app can't skip or pre-approve
            it. While recording, Android keeps a persistent notification and status-bar indicator
            visible the whole time; tapping it also stops the recording. Nothing is captured
            without that system-level, user-visible consent. The finished video saves straight to
            Library.
          </Text>
        </View>

        <View style={[styles.note, { borderLeftColor: C.native }]}>
          <Mono color={C.native} size={10}>PLANNED</Mono>
          <Text style={styles.noteText}>
            Facecam bubble (picture-in-picture), game mode, tutorial mode and export presets are
            the next layer on top of this — the capture pipeline underneath is real and working.
          </Text>
        </View>
      </ScrollView>

      {toast && (
        <View pointerEvents="none" style={styles.toast}>
          <Mono color={C.ink} size={12}>{toast}</Mono>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  stage: { alignItems: "center", justifyContent: "center", paddingVertical: 36, backgroundColor: C.bg2, borderBottomWidth: 1, borderBottomColor: C.line },
  indicator: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center" },
  indicatorOn: { borderColor: C.red },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.lineStrong },
  dotOn: { backgroundColor: C.red },
  big: { color: C.ink, fontFamily: F.mono, fontSize: 34, marginTop: 16, fontVariant: ["tabular-nums"] },
  panel: { flex: 1 },
  title: { color: C.ink, fontFamily: F.sansMed, fontSize: 24, fontWeight: "700", marginTop: 10 },
  body: { color: C.inkSoft, fontSize: 14, lineHeight: 21, marginTop: 6 },
  micRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 16, marginTop: 18 },
  micLabel: { color: C.ink, fontSize: 14.5, fontWeight: "500" },
  micToggle: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 40, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.bg2 },
  micToggleOn: { backgroundColor: C.red, borderColor: C.red },
  action: { marginTop: 20, borderRadius: 8, paddingVertical: 16, alignItems: "center" },
  actionGo: { backgroundColor: C.red },
  actionStop: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.red },
  actionText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 15 },
  note: { marginTop: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: C.go, borderRadius: 8, padding: 16, gap: 8 },
  noteText: { color: C.inkMute, fontSize: 13, lineHeight: 19 },
  toast: { position: "absolute", bottom: 24, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.85)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 40, borderWidth: 1, borderColor: C.line },
});
