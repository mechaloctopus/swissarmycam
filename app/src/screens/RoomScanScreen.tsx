import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Image, FlatList, ActivityIndicator } from "react-native";
import { CameraView } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as VideoThumbnails from "expo-video-thumbnails";
import { C, F } from "../theme";
import { Label, Mono, StatusPill } from "../components/ui";
import { newScanSession, saveScanFrame, listScanSessions, deleteScanSession, ScanSession } from "../store";
import { pickVideoFromLibrary } from "../media";
import { useSettings } from "../settings";

// Extracted frames are sampled at a fixed interval rather than a known frame
// count, since getting a video's exact duration up front needs its own
// decode step — cheaper to just keep sampling until a few consecutive probes
// land past the end of the clip.
const VIDEO_FRAME_INTERVAL_MS = 1200;
const MAX_VIDEO_FRAMES = 40;
const MAX_CONSECUTIVE_MISSES = 3;

/**
 * Room/object scan capture — "NeRF Measure," phase one. Guides a multi-angle
 * overlapping photo capture of a subject, saved as a set. This is the real,
 * buildable, on-device half of the feature: turning that photo set into a 3D
 * model (photogrammetry/NeRF reconstruction) and overlaying AR measurements
 * on it needs real cloud compute this project doesn't have — that part stays
 * an honestly-scoped "planned" placeholder rather than being faked.
 */
export default function RoomScanScreen({ focused }: { focused: boolean }) {
  const { settings } = useSettings();
  const camRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractCount, setExtractCount] = useState(0);

  const sessionRef = useRef<string | null>(null);
  const idxRef = useRef(0);

  const loadSessions = useCallback(async () => {
    setSessions(await listScanSessions());
  }, []);
  useEffect(() => {
    if (focused && !scanning) loadSessions();
  }, [focused, scanning, loadSessions]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1600);
  };

  const startScan = () => {
    sessionRef.current = newScanSession();
    idxRef.current = 0;
    setFrames([]);
    setScanning(true);
  };

  const capture = async () => {
    if (!camRef.current || busy || !sessionRef.current) return;
    setBusy(true);
    try {
      const p = await camRef.current.takePictureAsync({ quality: 0.85, skipProcessing: true });
      if (p?.uri) {
        const dest = await saveScanFrame(sessionRef.current, p.uri, idxRef.current++);
        setFrames((f) => [...f, dest]);
        if (settings.haptics) Haptics.selectionAsync();
      }
    } catch {
      flash("Couldn't capture that angle — try again");
    } finally {
      setBusy(false);
    }
  };

  const finishScan = () => {
    setScanning(false);
    sessionRef.current = null;
    flash(`Scan saved · ${frames.length} angles`);
    loadSessions();
  };

  const discardScan = async () => {
    if (sessionRef.current) await deleteScanSession(sessionRef.current);
    sessionRef.current = null;
    setScanning(false);
    setFrames([]);
  };

  /**
   * Turns an imported video into a scan session by sampling still frames out
   * of it at a fixed interval (via expo-video-thumbnails) and feeding them
   * into the same session-storage pipeline the live capture flow uses — the
   * resulting session is indistinguishable from a hand-shot one downstream.
   */
  const importVideo = async () => {
    if (extracting) return;
    const videoUri = await pickVideoFromLibrary();
    if (!videoUri) return;

    setExtracting(true);
    setExtractCount(0);
    const session = newScanSession();
    let index = 0;
    let timeMs = 0;
    let misses = 0;
    try {
      while (index < MAX_VIDEO_FRAMES && misses < MAX_CONSECUTIVE_MISSES) {
        try {
          const { uri: frameUri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: timeMs, quality: 0.85 });
          await saveScanFrame(session, frameUri, index++);
          setExtractCount(index);
          misses = 0;
        } catch {
          misses++;
        }
        timeMs += VIDEO_FRAME_INTERVAL_MS;
      }
      if (index === 0) {
        await deleteScanSession(session);
        flash("Couldn't extract frames from that video");
      } else {
        flash(`Extracted ${index} angles from video`);
        loadSessions();
      }
    } finally {
      setExtracting(false);
    }
  };

  if (scanning) {
    return (
      <View style={styles.root}>
        <View style={styles.viewport}>
          <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" active={focused} onCameraReady={() => setReady(true)} />
          <View style={styles.hud}>
            <View style={styles.recPill}>
              <View style={styles.recDot} />
              <Mono color={C.red} size={11}>SCANNING</Mono>
            </View>
            <Mono color={C.inkSoft} size={11}>{frames.length} ANGLES</Mono>
          </View>
        </View>

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
          <Mono color={C.inkMute} size={11} style={{ textAlign: "center", marginBottom: 14 }}>
            Walk around the subject, overlapping each shot 60–80% with the last. Aim for 20–40 angles for good coverage.
          </Mono>
          <Pressable onPress={capture} disabled={!ready || busy} style={[styles.shutter, (!ready || busy) && { opacity: 0.5 }]}>
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.finishRow}>
            <Pressable onPress={discardScan} style={styles.discardBtn}>
              <Text style={styles.discardText}>Discard</Text>
            </Pressable>
            <Pressable onPress={finishScan} disabled={frames.length === 0} style={[styles.finishBtn, frames.length === 0 && { opacity: 0.5 }]}>
              <Text style={styles.finishText}>Finish scan ({frames.length})</Text>
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
      <Label>§ Scan · Room / object capture</Label>
      <Text style={styles.title}>NeRF Measure — capture</Text>
      <View style={{ marginVertical: 14 }}>
        <StatusPill label="Real · on-device capture" tone={C.go} />
      </View>
      <Text style={styles.body}>
        Capture a multi-angle overlapping photo set of a room or object — the real, on-device half
        of NeRF Measure. Turning a scan into a 3D model and overlaying AR measurements on it needs
        real photogrammetry/NeRF reconstruction, which is genuinely heavy cloud compute this project
        doesn't have yet — that step stays honestly marked "planned," not faked. Scans captured here
        are saved and ready for that pipeline whenever it exists.
      </Text>

      <Pressable onPress={startScan} style={styles.newScanBtn}>
        <Text style={styles.newScanText}>◫ Start a new scan</Text>
      </Pressable>

      <Pressable onPress={importVideo} disabled={extracting} style={[styles.importBtn, extracting && { opacity: 0.6 }]}>
        {extracting ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <ActivityIndicator color={C.inkSoft} size="small" />
            <Text style={styles.importText}>Extracting angles… {extractCount}</Text>
          </View>
        ) : (
          <Text style={styles.importText}>▶ Import from video instead</Text>
        )}
      </Pressable>
      <Mono color={C.inkFaint} size={10.5} style={{ marginTop: 8 }}>
        Walk a video around the subject the same way you'd shoot stills — frames get sampled out of
        it automatically into a scan set.
      </Mono>

      {sessions.length > 0 && (
        <>
          <Text style={styles.sub}>Saved scans ({sessions.length})</Text>
          {sessions.map((s) => (
            <View key={s.session} style={styles.sessionRow}>
              {s.cover ? <Image source={{ uri: s.cover }} style={styles.sessionCover} /> : <View style={[styles.sessionCover, styles.sessionCoverEmpty]} />}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Mono color={C.ink} size={12}>{s.frames.length} angles</Mono>
                <Mono color={C.inkFaint} size={10} style={{ marginTop: 2 }}>{s.session.replace("scan_", "")}</Mono>
              </View>
              <Pressable onPress={() => deleteScanSession(s.session).then(loadSessions)}>
                <Mono color={C.red} size={11}>delete</Mono>
              </Pressable>
            </View>
          ))}
        </>
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
  newScanBtn: { marginTop: 22, backgroundColor: C.red, borderRadius: 8, paddingVertical: 15, alignItems: "center" },
  newScanText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 15 },
  importBtn: { marginTop: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, paddingVertical: 13, alignItems: "center" },
  importText: { color: C.inkSoft, fontFamily: F.sansMed, fontWeight: "600", fontSize: 13.5 },
  sessionRow: { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, marginBottom: 8 },
  sessionCover: { width: 48, height: 48, borderRadius: 6 },
  sessionCoverEmpty: { backgroundColor: C.bg2 },
  viewport: { height: "48%", backgroundColor: "#000" },
  hud: { position: "absolute", top: 12, left: 14, right: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  recPill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(0,0,0,0.45)", borderWidth: 1, borderColor: C.line, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 40 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.red },
  thumbStrip: { maxHeight: 64, backgroundColor: C.bg2, paddingVertical: 8 },
  thumb: { width: 48, height: 48, borderRadius: 6 },
  panel: { padding: 20, alignItems: "center" },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.red },
  finishRow: { flexDirection: "row", gap: 10, marginTop: 18, width: "100%" },
  discardBtn: { flex: 1, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, paddingVertical: 13, alignItems: "center", backgroundColor: C.surface },
  discardText: { color: C.inkMute, fontFamily: F.sansMed, fontWeight: "600", fontSize: 13.5 },
  finishBtn: { flex: 2, backgroundColor: C.go, borderRadius: 8, paddingVertical: 13, alignItems: "center" },
  finishText: { color: "#062", fontFamily: F.sansMed, fontWeight: "700", fontSize: 13.5 },
  toast: { position: "absolute", bottom: 24, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.85)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 40, borderWidth: 1, borderColor: C.line },
});
