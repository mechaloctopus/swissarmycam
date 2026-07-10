import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Dimensions, Modal, Alert } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { C, F } from "../theme";
import { Label, Mono } from "../components/ui";
import { listMedia, deleteMedia, listTimelapseSessions, deleteTimelapseSession, MediaItem, TLSession } from "../store";
import { saveToPhotos, shareFile } from "../media";

const COLS = 3;
const GAP = 3;

type Viewer =
  | { type: "photo"; uri: string }
  | { type: "video"; uri: string }
  | { type: "tl"; session: TLSession }
  | null;

export default function LibraryScreen() {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [sessions, setSessions] = useState<TLSession[]>([]);
  const [viewer, setViewer] = useState<Viewer>(null);
  const [toast, setToast] = useState<string | null>(null);
  const width = Dimensions.get("window").width;
  const cell = (width - GAP * (COLS - 1)) / COLS;

  const load = useCallback(async () => {
    setMedia(await listMedia());
    setSessions(await listTimelapseSessions());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1500);
  };

  const remove = async () => {
    if (!viewer) return;
    if (viewer.type === "tl") await deleteTimelapseSession(viewer.session.session);
    else await deleteMedia(viewer.uri);
    setViewer(null);
    load();
  };

  const currentUri = viewer && viewer.type !== "tl" ? viewer.uri : viewer && viewer.type === "tl" ? viewer.session.cover : null;
  const empty = media.length === 0 && sessions.length === 0;

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Label>§ Library · Local-first</Label>
        <Mono color={C.inkMute} size={11}>{media.filter((m) => m.kind === "photo").length} PH · {media.filter((m) => m.kind === "video").length} VID · {sessions.length} TL</Mono>
      </View>

      {empty ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 40, color: C.inkFaint }}>▦</Text>
          <Text style={styles.emptyText}>No captures yet.</Text>
          <Mono color={C.inkMute} size={12}>Shoot something in Capture or Timelapse.</Mono>
        </View>
      ) : (
        <FlatList
          data={media}
          keyExtractor={(m) => m.uri}
          numColumns={COLS}
          contentContainerStyle={{ paddingBottom: 30 }}
          columnWrapperStyle={{ gap: GAP, marginBottom: GAP }}
          ListHeaderComponent={
            sessions.length ? (
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.section}>Timelapse sets</Text>
                <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                  {sessions.map((s) => (
                    <Pressable key={s.session} style={styles.tlCard} onPress={() => setViewer({ type: "tl", session: s })}>
                      {s.cover ? <Image source={{ uri: s.cover }} style={styles.tlCover} contentFit="cover" /> : null}
                      <View style={styles.tlPlay}><Text style={{ color: "#fff", fontSize: 12 }}>▶</Text></View>
                      <View style={styles.tlMeta}>
                        <Mono color={C.ink} size={12}>{s.frames.length} frames</Mono>
                        <Mono color={C.inkMute} size={10}>tap to play</Mono>
                      </View>
                    </Pressable>
                  ))}
                </View>
                {media.length ? <Text style={[styles.section, { marginTop: 18 }]}>Photos & videos</Text> : null}
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => setViewer({ type: item.kind, uri: item.uri })} style={{ width: cell, height: cell }}>
              <Image source={{ uri: item.uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={120} />
              {item.kind === "video" && (
                <View style={styles.vidBadge}>
                  <Text style={{ color: "#fff", fontSize: 11 }}>▶</Text>
                </View>
              )}
            </Pressable>
          )}
        />
      )}

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewer}>
          {viewer?.type === "photo" && <Image source={{ uri: viewer.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />}
          {viewer?.type === "video" && <VideoViewer uri={viewer.uri} />}
          {viewer?.type === "tl" && <TLPlayer frames={viewer.session.frames} />}

          <View style={styles.viewerBar}>
            <Pressable onPress={() => setViewer(null)} style={styles.vBtn}>
              <Text style={styles.vBtnText}>✕ Close</Text>
            </Pressable>
            {viewer?.type !== "tl" && (
              <>
                <Pressable onPress={async () => currentUri && flash((await shareFile(currentUri)) ? "Shared" : "Share unavailable")} style={styles.vBtn}>
                  <Text style={styles.vBtnText}>⇪ Share</Text>
                </Pressable>
                <Pressable onPress={async () => currentUri && flash((await saveToPhotos(currentUri)) ? "Saved to Photos" : "Permission needed")} style={styles.vBtn}>
                  <Text style={styles.vBtnText}>↧ Photos</Text>
                </Pressable>
              </>
            )}
            <Pressable onPress={() => Alert.alert("Delete?", "This cannot be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: remove }])} style={[styles.vBtn, { borderColor: C.red }]}>
              <Text style={[styles.vBtnText, { color: C.red }]}>🗑 Delete</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {toast && (
        <View pointerEvents="none" style={styles.toast}>
          <Mono color={C.ink} size={12}>{toast}</Mono>
        </View>
      )}
    </View>
  );
}

function VideoViewer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls />;
}

/** Plays a timelapse frame-set as a looping preview. */
function TLPlayer({ frames }: { frames: string[] }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [fps, setFps] = useState(12);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    timer.current = setInterval(() => setI((x) => (x + 1) % frames.length), 1000 / fps);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, frames, fps]);

  if (!frames.length) return <View style={StyleSheet.absoluteFill} />;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Image source={{ uri: frames[i] }} style={StyleSheet.absoluteFill} contentFit="contain" />
      <View style={styles.tlHud}>
        <Mono color={C.ink} size={12}>{i + 1}/{frames.length} · {fps}fps</Mono>
      </View>
      <View style={styles.tlCtrls}>
        <Pressable onPress={() => setPlaying((p) => !p)} style={styles.tlBtn}>
          <Text style={styles.vBtnText}>{playing ? "❚❚ Pause" : "▶ Play"}</Text>
        </Pressable>
        {[8, 12, 24].map((f) => (
          <Pressable key={f} onPress={() => setFps(f)} style={[styles.tlBtn, fps === f && { borderColor: C.red }]}>
            <Text style={[styles.vBtnText, fps === f && { color: C.red }]}>{f}fps</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
  section: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10, paddingHorizontal: 2 },
  tlCard: { width: 150, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 8, overflow: "hidden" },
  tlCover: { width: "100%", height: 88 },
  tlPlay: { position: "absolute", top: 30, left: 0, right: 0, alignItems: "center" },
  tlMeta: { padding: 10, gap: 3 },
  vidBadge: { position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyText: { color: C.inkSoft, fontFamily: F.sansMed, fontSize: 18, fontWeight: "700" },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.97)" },
  viewerBar: { position: "absolute", bottom: 30, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 8, paddingHorizontal: 12, flexWrap: "wrap" },
  vBtn: { borderWidth: 1, borderColor: C.lineStrong, backgroundColor: "rgba(20,21,24,0.9)", paddingHorizontal: 13, paddingVertical: 11, borderRadius: 8 },
  vBtnText: { color: C.inkSoft, fontFamily: F.mono, fontSize: 12 },
  tlHud: { position: "absolute", top: 18, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 40 },
  tlCtrls: { position: "absolute", bottom: 90, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 8 },
  tlBtn: { borderWidth: 1, borderColor: C.lineStrong, backgroundColor: "rgba(20,21,24,0.9)", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8 },
  toast: { position: "absolute", bottom: 100, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.8)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 40, borderWidth: 1, borderColor: C.line },
});
