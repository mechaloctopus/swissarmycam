import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Dimensions, Modal } from "react-native";
import { Image } from "expo-image";
import { C, F } from "../theme";
import { Label, Mono } from "../components/ui";
import { listCaptures, deleteCapture, listTimelapseSessions } from "../store";
import { saveToPhotos } from "../media";

const COLS = 3;
const GAP = 3;

export default function LibraryScreen() {
  const [items, setItems] = useState<string[]>([]);
  const [sessions, setSessions] = useState<{ session: string; frames: number; cover: string | null }[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const width = Dimensions.get("window").width;
  const cell = (width - GAP * (COLS - 1)) / COLS;

  const load = useCallback(async () => {
    setItems(await listCaptures());
    setSessions(await listTimelapseSessions());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1500);
  };

  const remove = async (uri: string) => {
    await deleteCapture(uri);
    setViewer(null);
    load();
  };

  const empty = items.length === 0 && sessions.length === 0;

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Label>§ Library · Local-first</Label>
        <Mono color={C.inkMute} size={11}>{items.length} PHOTOS · {sessions.length} TL</Mono>
      </View>

      {empty ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 40, color: C.inkFaint }}>▦</Text>
          <Text style={styles.emptyText}>No captures yet.</Text>
          <Mono color={C.inkMute} size={12}>Shoot something in Capture or Timelapse.</Mono>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(u) => u}
          numColumns={COLS}
          contentContainerStyle={{ paddingBottom: 30 }}
          columnWrapperStyle={{ gap: GAP, marginBottom: GAP }}
          ListHeaderComponent={
            sessions.length ? (
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.section}>Timelapse sets</Text>
                <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                  {sessions.map((s) => (
                    <View key={s.session} style={styles.tlCard}>
                      {s.cover ? <Image source={{ uri: s.cover }} style={styles.tlCover} contentFit="cover" /> : null}
                      <View style={styles.tlMeta}>
                        <Mono color={C.ink} size={12}>{s.frames} frames</Mono>
                        <Mono color={C.inkMute} size={10}>{s.session.replace("tl_", "")}</Mono>
                      </View>
                    </View>
                  ))}
                </View>
                <Text style={[styles.section, { marginTop: 18 }]}>Photos</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => setViewer(item)} style={{ width: cell, height: cell }}>
              <Image source={{ uri: item }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={120} />
            </Pressable>
          )}
        />
      )}

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewer}>
          {viewer && <Image source={{ uri: viewer }} style={StyleSheet.absoluteFill} contentFit="contain" />}
          <View style={styles.viewerBar}>
            <Pressable onPress={() => setViewer(null)} style={styles.vBtn}>
              <Text style={styles.vBtnText}>✕  Close</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (viewer) flash((await saveToPhotos(viewer)) ? "Saved to Photos" : "Permission needed");
              }}
              style={styles.vBtn}
            >
              <Text style={styles.vBtnText}>↧  Save to Photos</Text>
            </Pressable>
            <Pressable onPress={() => viewer && remove(viewer)} style={[styles.vBtn, { borderColor: C.red }]}>
              <Text style={[styles.vBtnText, { color: C.red }]}>🗑  Delete</Text>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
  section: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10, paddingHorizontal: 2 },
  tlCard: { width: 150, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 8, overflow: "hidden" },
  tlCover: { width: "100%", height: 88 },
  tlMeta: { padding: 10, gap: 3 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyText: { color: C.inkSoft, fontFamily: F.sansMed, fontSize: 18, fontWeight: "700" },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)" },
  viewerBar: { position: "absolute", bottom: 30, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 10, paddingHorizontal: 16 },
  vBtn: { borderWidth: 1, borderColor: C.lineStrong, backgroundColor: "rgba(20,21,24,0.9)", paddingHorizontal: 14, paddingVertical: 11, borderRadius: 8 },
  vBtnText: { color: C.inkSoft, fontFamily: F.mono, fontSize: 12 },
  toast: { position: "absolute", bottom: 100, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.8)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 40, borderWidth: 1, borderColor: C.line },
});
