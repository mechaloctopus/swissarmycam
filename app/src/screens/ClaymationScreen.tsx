import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Image, FlatList, ActivityIndicator } from "react-native";
import { CameraView } from "expo-camera";
import * as Haptics from "expo-haptics";
import { C, F } from "../theme";
import { Label, Mono } from "../components/ui";
import { Slider } from "../components/controls";
import {
  newClaySession,
  saveClayFrame,
  listClaySessions,
  deleteClaySession,
  deleteClayFrame,
  newVideoOutputPath,
  saveVideo,
  ClaySession,
} from "../store";
import { saveToPhotos } from "../media";
import { useSettings } from "../settings";
import { isVideoExportAvailable, exportImageSequence } from "video-exporter";

const FPS_OPTIONS = [8, 12, 24];

/**
 * Claymation / stop-motion capture with an onion-skin guide: the last frame
 * you shot renders semi-transparent over the live viewfinder so you can see
 * exactly how far to nudge the subject before the next shot. Reuses the same
 * camera + session-storage pattern as Timelapse/Scan; export reuses the
 * video-exporter module's proven EGL/encoder pipeline (a simpler, decoder-free
 * variant of it — see ImageSequenceExporter.kt).
 */
export default function ClaymationScreen({ focused }: { focused: boolean }) {
  const { settings } = useSettings();
  const camRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const [onionSkin, setOnionSkin] = useState(true);
  const [onionOpacity, setOnionOpacity] = useState(35);
  const [sessions, setSessions] = useState<ClaySession[]>([]);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fps, setFps] = useState(12);
  const [toast, setToast] = useState<string | null>(null);

  const sessionRef = useRef<string | null>(null);
  const idxRef = useRef(0);
  const exportAvailable = isVideoExportAvailable();

  const loadSessions = useCallback(async () => {
    setSessions(await listClaySessions());
  }, []);
  useEffect(() => {
    if (focused && !shooting) loadSessions();
  }, [focused, shooting, loadSessions]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1700);
  };

  const startShoot = () => {
    sessionRef.current = newClaySession();
    idxRef.current = 0;
    setFrames([]);
    setShooting(true);
  };

  const capture = async () => {
    if (!camRef.current || busy || !sessionRef.current) return;
    setBusy(true);
    try {
      const p = await camRef.current.takePictureAsync({ quality: 0.9, skipProcessing: true });
      if (p?.uri) {
        const dest = await saveClayFrame(sessionRef.current, p.uri, idxRef.current++);
        setFrames((f) => [...f, dest]);
        if (settings.haptics) Haptics.selectionAsync();
      }
    } catch {
      flash("Couldn't capture that frame");
    } finally {
      setBusy(false);
    }
  };

  const undoLast = async () => {
    if (frames.length === 0 || !sessionRef.current) return;
    const last = frames[frames.length - 1];
    await deleteClayFrame(sessionRef.current, last);
    idxRef.current = Math.max(0, idxRef.current - 1);
    setFrames((f) => f.slice(0, -1));
  };

  const finishShoot = () => {
    setShooting(false);
    sessionRef.current = null;
    flash(`Saved · ${frames.length} frames`);
    loadSessions();
  };

  const discardShoot = async () => {
    if (sessionRef.current) await deleteClaySession(sessionRef.current);
    sessionRef.current = null;
    setShooting(false);
    setFrames([]);
  };

  const exportSession = async (s: ClaySession) => {
    if (!exportAvailable || exporting || s.frames.length === 0) return;
    setExporting(true);
    try {
      const { uri, path } = await newVideoOutputPath();
      await exportImageSequence(s.frames, fps, path);
      await saveVideo(uri);
      flash("Exported to Library");
      if (settings.autoSaveToPhotos) saveToPhotos(uri);
    } catch {
      flash("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const onionUri = frames.length > 0 ? frames[frames.length - 1] : null;

  if (shooting) {
    return (
      <View style={styles.root}>
        <View style={styles.viewport}>
          <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" active={focused} onCameraReady={() => setReady(true)} />
          {onionSkin && onionUri && (
            <Image source={{ uri: onionUri }} style={[StyleSheet.absoluteFill, { opacity: onionOpacity / 100 }]} resizeMode="cover" />
          )}
          <View style={styles.hud}>
            <View style={styles.recPill}>
              <Mono color={C.ink} size={11}>{frames.length} FRAMES</Mono>
            </View>
            <Pressable onPress={() => setOnionSkin((v) => !v)} style={styles.recPill}>
              <Mono color={onionSkin ? C.red : C.inkMute} size={11}>{onionSkin ? "ONION ON" : "ONION OFF"}</Mono>
            </Pressable>
          </View>
        </View>

        {onionSkin && (
          <View style={styles.onionSliderWrap}>
            <Mono color={C.inkMute} size={10}>Onion opacity</Mono>
            <Slider value={onionOpacity} min={10} max={70} step={5} onChange={setOnionOpacity} width={160} />
          </View>
        )}

        {frames.length > 0 && (
          <FlatList
            horizontal
            data={frames}
            keyExtractor={(f) => f}
            style={styles.thumbStrip}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
            renderItem={({ item }) => <Image source={{ uri: item }} style={styles.thumb} />}
          />
        )}

        <View style={styles.panel}>
          <View style={styles.shootRow}>
            <Pressable onPress={undoLast} disabled={frames.length === 0} style={[styles.undoBtn, frames.length === 0 && { opacity: 0.4 }]}>
              <Text style={styles.undoText}>↺</Text>
            </Pressable>
            <Pressable onPress={capture} disabled={!ready || busy} style={[styles.shutter, (!ready || busy) && { opacity: 0.5 }]}>
              <View style={styles.shutterInner} />
            </Pressable>
            <View style={{ width: 52 }} />
          </View>
          <View style={styles.finishRow}>
            <Pressable onPress={discardShoot} style={styles.discardBtn}>
              <Text style={styles.discardText}>Discard</Text>
            </Pressable>
            <Pressable onPress={finishShoot} disabled={frames.length === 0} style={[styles.finishBtn, frames.length === 0 && { opacity: 0.5 }]}>
              <Text style={styles.finishText}>Finish ({frames.length})</Text>
            </Pressable>
          </View>
        </View>

        {toast && (
          <View pointerEvents="none" style={styles.toast}>
            <Mono color={C.ink} size={12}>{toast}</Mono>
          </View>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Label>§ Clay · Stop-motion studio</Label>
      <Text style={styles.title}>Claymation</Text>
      <Text style={styles.body}>
        Shoot one frame at a time — the last frame you captured shows semi-transparent over the
        live view (onion skin) so you can see exactly how far to move the subject before the next
        shot. When you're done, bake the set into a real MP4 at your chosen frame rate.
      </Text>

      <Pressable onPress={startShoot} style={styles.newBtn}>
        <Text style={styles.newBtnText}>◉ Start a new shoot</Text>
      </Pressable>

      {exportAvailable && (
        <View style={styles.fpsRow}>
          <Mono color={C.inkMute} size={11}>Export frame rate</Mono>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {FPS_OPTIONS.map((f) => (
              <Pressable key={f} onPress={() => setFps(f)} style={[styles.fpsChip, fps === f && styles.fpsChipOn]}>
                <Text style={{ color: fps === f ? "#fff" : C.inkSoft, fontFamily: F.mono, fontSize: 12 }}>{f}fps</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {sessions.length > 0 && (
        <>
          <Text style={styles.sub}>Shoots ({sessions.length})</Text>
          {sessions.map((s) => (
            <View key={s.session} style={styles.sessionRow}>
              {s.cover ? <Image source={{ uri: s.cover }} style={styles.sessionCover} /> : <View style={[styles.sessionCover, styles.sessionCoverEmpty]} />}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Mono color={C.ink} size={12}>{s.frames.length} frames</Mono>
                <Mono color={C.inkFaint} size={10} style={{ marginTop: 2 }}>{s.session.replace("clay_", "")}</Mono>
              </View>
              {exportAvailable && (
                <Pressable onPress={() => exportSession(s)} disabled={exporting} style={styles.exportChip}>
                  {exporting ? <ActivityIndicator color="#fff" size="small" /> : <Mono color="#fff" size={11}>Export</Mono>}
                </Pressable>
              )}
              <Pressable onPress={() => deleteClaySession(s.session).then(loadSessions)} style={{ marginLeft: 10 }}>
                <Mono color={C.red} size={11}>delete</Mono>
              </Pressable>
            </View>
          ))}
        </>
      )}

      {!exportAvailable && (
        <View style={styles.note}>
          <Mono color={C.native} size={10}>EXPORT NEEDS NATIVE MODULE</Mono>
          <Text style={styles.noteText}>Frame capture works everywhere; baking to MP4 needs the video-exporter native module (Android build).</Text>
        </View>
      )}

      {toast && (
        <View pointerEvents="none" style={styles.toast}>
          <Mono color={C.ink} size={12}>{toast}</Mono>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  title: { color: C.ink, fontFamily: F.sansMed, fontSize: 24, fontWeight: "700", marginTop: 10 },
  body: { color: C.inkSoft, fontSize: 14, lineHeight: 21, marginTop: 6 },
  sub: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 24, marginBottom: 12 },
  newBtn: { marginTop: 20, backgroundColor: C.red, borderRadius: 8, paddingVertical: 15, alignItems: "center" },
  newBtnText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 15 },
  fpsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 12 },
  fpsChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 40, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.bg2 },
  fpsChipOn: { backgroundColor: C.red, borderColor: C.red },
  sessionRow: { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, marginBottom: 8 },
  sessionCover: { width: 48, height: 48, borderRadius: 6 },
  sessionCoverEmpty: { backgroundColor: C.bg2 },
  exportChip: { backgroundColor: C.go, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, minWidth: 60, alignItems: "center" },
  note: { marginTop: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: C.native, borderRadius: 8, padding: 16, gap: 8 },
  noteText: { color: C.inkMute, fontSize: 13, lineHeight: 19 },
  viewport: { height: "48%", backgroundColor: "#000" },
  hud: { position: "absolute", top: 12, left: 14, right: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  recPill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(0,0,0,0.5)", borderWidth: 1, borderColor: C.line, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 40 },
  onionSliderWrap: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.bg2 },
  thumbStrip: { maxHeight: 64, backgroundColor: C.bg2, paddingVertical: 8 },
  thumb: { width: 48, height: 48, borderRadius: 6 },
  panel: { padding: 20, alignItems: "center" },
  shootRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 24 },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.red },
  undoBtn: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  undoText: { color: C.inkSoft, fontSize: 22 },
  finishRow: { flexDirection: "row", gap: 10, marginTop: 18, width: "100%" },
  discardBtn: { flex: 1, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, paddingVertical: 13, alignItems: "center", backgroundColor: C.surface },
  discardText: { color: C.inkMute, fontFamily: F.sansMed, fontWeight: "600", fontSize: 13.5 },
  finishBtn: { flex: 2, backgroundColor: C.go, borderRadius: 8, paddingVertical: 13, alignItems: "center" },
  finishText: { color: "#062", fontFamily: F.sansMed, fontWeight: "700", fontSize: 13.5 },
  toast: { position: "absolute", bottom: 24, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.85)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 40, borderWidth: 1, borderColor: C.line },
});
