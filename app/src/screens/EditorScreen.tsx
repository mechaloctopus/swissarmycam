import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, PanResponder, ScrollView, Image, Modal, TextInput } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEventListener } from "expo";
import { C, F } from "../theme";
import { Label, Mono } from "../components/ui";
import { Slider } from "../components/controls";
import { listMedia } from "../store";
import { pickImageFromLibrary } from "../media";

type Keyframe = { t: number; x: number; y: number; scale: number; rotation: number; opacity: number };
type OverlayLayer = { id: string; kind: "image" | "text"; uri?: string; text?: string; color: string; keyframes: Keyframe[] };

let seq = 0;
const DEFAULT_KF = (t: number): Keyframe => ({ t, x: 40, y: 40, scale: 1, rotation: 0, opacity: 100 });

export default function EditorScreen({ focused }: { focused: boolean }) {
  const [videos, setVideos] = useState<string[]>([]);
  const [baseUri, setBaseUri] = useState<string | null>(null);
  const [layers, setLayers] = useState<OverlayLayer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [textModal, setTextModal] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const player = useVideoPlayer(baseUri ?? "", (p) => {
    p.loop = true;
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEventListener(player, "timeUpdate", (payload) => setCurrentTime(payload.currentTime));
  useEventListener(player, "statusChange", () => setDuration(player.duration || 0));
  useEventListener(player, "playingChange", (payload) => setPlaying(payload.isPlaying));

  const loadVideos = useCallback(async () => {
    const m = await listMedia();
    setVideos(m.filter((i) => i.kind === "video").map((i) => i.uri));
  }, []);
  useEffect(() => {
    if (focused) loadVideos();
  }, [focused, loadVideos]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1700);
  };

  const selected = layers.find((l) => l.id === selectedId) || null;

  /** Interpolated transform for a layer at the current playback time. */
  const transformAt = useCallback((layer: OverlayLayer, t: number): Keyframe => {
    const kfs = layer.keyframes;
    if (kfs.length === 0) return DEFAULT_KF(0);
    if (kfs.length === 1) return kfs[0];
    if (t <= kfs[0].t) return kfs[0];
    if (t >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1];
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i];
      const b = kfs[i + 1];
      if (t >= a.t && t <= b.t) {
        const span = b.t - a.t || 1;
        const p = (t - a.t) / span;
        return {
          t,
          x: a.x + (b.x - a.x) * p,
          y: a.y + (b.y - a.y) * p,
          scale: a.scale + (b.scale - a.scale) * p,
          rotation: a.rotation + (b.rotation - a.rotation) * p,
          opacity: a.opacity + (b.opacity - a.opacity) * p,
        };
      }
    }
    return kfs[kfs.length - 1];
  }, []);

  const addLayer = (kind: "image" | "text", opts: { uri?: string; text?: string }) => {
    const id = `OV${++seq}`;
    setLayers((ls) => [...ls, { id, kind, uri: opts.uri, text: opts.text, color: "#FFFFFF", keyframes: [DEFAULT_KF(0)] }]);
    setSelectedId(id);
  };

  const removeSelected = () => {
    if (!selected) return;
    setLayers((ls) => ls.filter((l) => l.id !== selected.id));
    setSelectedId(null);
  };

  const importOverlay = async () => {
    setImporting(true);
    try {
      const uri = await pickImageFromLibrary();
      if (uri) addLayer("image", { uri });
      else flash("No image selected");
    } finally {
      setImporting(false);
    }
  };

  const moveSelectedTo = (x: number, y: number) => {
    if (!selected) return;
    setLayers((ls) =>
      ls.map((l) => {
        if (l.id !== selected.id) return l;
        const kfs = [...l.keyframes];
        const idx = kfs.findIndex((k) => Math.abs(k.t - currentTime) < 0.05);
        if (idx >= 0) kfs[idx] = { ...kfs[idx], x, y };
        else return l; // dragging only updates an existing keyframe at this time; use "Add keyframe" to create one
        return { ...l, keyframes: kfs };
      })
    );
  };

  const addKeyframeHere = () => {
    if (!selected) return flash("Select a layer first");
    const current = transformAt(selected, currentTime);
    setLayers((ls) =>
      ls.map((l) => {
        if (l.id !== selected.id) return l;
        const kfs = l.keyframes.filter((k) => Math.abs(k.t - currentTime) >= 0.05);
        kfs.push({ ...current, t: currentTime });
        kfs.sort((a, b) => a.t - b.t);
        return { ...l, keyframes: kfs };
      })
    );
    flash(`Keyframe set at ${currentTime.toFixed(1)}s`);
  };

  const removeKeyframe = (t: number) => {
    if (!selected) return;
    setLayers((ls) =>
      ls.map((l) => (l.id === selected.id ? { ...l, keyframes: l.keyframes.filter((k) => Math.abs(k.t - t) >= 0.05) } : l))
    );
  };

  const patchKeyframeAtCurrent = (patch: Partial<Keyframe>) => {
    if (!selected) return;
    setLayers((ls) =>
      ls.map((l) => {
        if (l.id !== selected.id) return l;
        const kfs = [...l.keyframes];
        let idx = kfs.findIndex((k) => Math.abs(k.t - currentTime) < 0.05);
        if (idx < 0) {
          kfs.push({ ...transformAt(l, currentTime), t: currentTime, ...patch });
          kfs.sort((a, b) => a.t - b.t);
        } else {
          kfs[idx] = { ...kfs[idx], ...patch };
        }
        return { ...l, keyframes: kfs };
      })
    );
  };

  const seekTo = (t: number) => {
    player.currentTime = t;
    setCurrentTime(t);
  };

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Label>§ Editor · Video + keyframes</Label>
        <Mono color={C.inkMute} size={11}>{layers.length} OVERLAYS</Mono>
      </View>

      {!baseUri ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
          <Text style={styles.sub}>Pick a base video</Text>
          {videos.length === 0 ? (
            <Mono color={C.inkFaint} size={12} style={{ marginTop: 12 }}>Record a video in Capture first.</Mono>
          ) : (
            <View style={styles.grid}>
              {videos.map((u) => (
                <Pressable key={u} onPress={() => setBaseUri(u)} style={styles.videoCell}>
                  <Text style={{ color: C.inkSoft, fontSize: 20 }}>▶</Text>
                  <Mono color={C.inkMute} size={9} style={{ marginTop: 6 }}>{u.split("/").pop()?.slice(0, 16)}</Mono>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        <>
          <View
            style={styles.canvasWrap}
            onLayout={(e) => setCanvasSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          >
            <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
            {layers.map((l) => (
              <OverlaySprite key={l.id} layer={l} transform={transformAt(l, currentTime)} selected={l.id === selectedId} onSelect={setSelectedId} onDrag={(x, y) => selectedId === l.id && moveSelectedTo(x, y)} />
            ))}
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedId(null)} pointerEvents="box-none" />
          </View>

          <View style={styles.transportRow}>
            <Pressable onPress={() => (playing ? player.pause() : player.play())} style={styles.playBtn}>
              <Text style={{ color: "#fff", fontSize: 16 }}>{playing ? "❚❚" : "▶"}</Text>
            </Pressable>
            <Mono color={C.inkSoft} size={11} style={{ width: 40 }}>{currentTime.toFixed(1)}s</Mono>
            <View style={{ flex: 1 }}>
              <Slider value={currentTime} min={0} max={Math.max(duration, 0.1)} step={0.05} onChange={seekTo} width={undefined} />
            </View>
            <Mono color={C.inkMute} size={11} style={{ width: 40, textAlign: "right" }}>{duration.toFixed(1)}s</Mono>
          </View>

          <ScrollView style={styles.panel} contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
            <View style={styles.addRow}>
              <Pressable onPress={importOverlay} disabled={importing} style={styles.addBtn}>
                <Text style={styles.addText}>{importing ? "Importing…" : "⤓ Import PNG"}</Text>
              </Pressable>
              <Pressable onPress={() => setTextModal(true)} style={styles.addBtn}>
                <Text style={styles.addText}>+ Text</Text>
              </Pressable>
              <Pressable onPress={() => setBaseUri(null)} style={styles.addBtn}>
                <Text style={styles.addText}>Change video</Text>
              </Pressable>
            </View>

            {layers.length > 0 && (
              <>
                <Text style={styles.sub}>Overlays</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {layers.map((l) => (
                    <Pressable key={l.id} onPress={() => setSelectedId(l.id)} style={[styles.layerChip, l.id === selectedId && styles.layerChipOn]}>
                      {l.kind === "image" && l.uri ? (
                        <Image source={{ uri: l.uri }} style={{ width: 20, height: 20, borderRadius: 4 }} />
                      ) : (
                        <Text style={{ fontSize: 12, color: l.id === selectedId ? "#fff" : C.inkSoft }}>{l.text || "Text"}</Text>
                      )}
                      <Mono color={l.id === selectedId ? "#fff" : C.inkMute} size={9}>{l.keyframes.length} kf</Mono>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {selected && (
              <View style={styles.controls}>
                <View style={styles.controlHead}>
                  <Mono color={C.ink} size={12}>{selected.kind === "text" ? selected.text : "Image overlay"}</Mono>
                  <Pressable onPress={removeSelected}>
                    <Mono color={C.red} size={11}>delete</Mono>
                  </Pressable>
                </View>

                <Mono color={C.inkMute} size={10} style={{ marginTop: 4 }}>
                  Drag the overlay in the canvas above, then tap "Set keyframe here" to lock its position at {currentTime.toFixed(1)}s.
                </Mono>

                <Pressable onPress={addKeyframeHere} style={styles.kfBtn}>
                  <Text style={styles.kfBtnText}>◆ Set keyframe here ({currentTime.toFixed(1)}s)</Text>
                </Pressable>

                <CtrlRow label="Size">
                  <Slider value={Math.round(transformAt(selected, currentTime).scale * 100)} min={20} max={300} step={5} onChange={(v) => patchKeyframeAtCurrent({ scale: v / 100 })} width={140} />
                </CtrlRow>
                <CtrlRow label="Rotate">
                  <Slider value={transformAt(selected, currentTime).rotation} min={-180} max={180} step={1} onChange={(v) => patchKeyframeAtCurrent({ rotation: v })} width={140} />
                </CtrlRow>
                <CtrlRow label="Opacity">
                  <Slider value={transformAt(selected, currentTime).opacity} min={10} max={100} step={5} onChange={(v) => patchKeyframeAtCurrent({ opacity: v })} width={140} />
                </CtrlRow>

                <Text style={styles.kfListLabel}>Keyframes ({selected.keyframes.length})</Text>
                <View style={styles.kfList}>
                  {selected.keyframes.map((k) => (
                    <View key={k.t} style={styles.kfRow}>
                      <Pressable onPress={() => seekTo(k.t)} style={styles.kfTime}>
                        <Mono color={C.red} size={11}>{k.t.toFixed(1)}s</Mono>
                      </Pressable>
                      <Mono color={C.inkMute} size={10}>x{Math.round(k.x)} y{Math.round(k.y)} · {Math.round(k.scale * 100)}%</Mono>
                      <Pressable onPress={() => removeKeyframe(k.t)}>
                        <Text style={{ color: C.inkMute, fontSize: 13 }}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View style={styles.note}>
              <Mono color={C.native} size={10}>LIVE PREVIEW · EXPORT PENDING</Mono>
              <Text style={styles.noteText}>
                Everything above plays back live and for real — drag, keyframe, and watch the
                overlay move across the video. Baking this into an exported MP4 is a separate,
                frame-accurate job (decode every frame, draw the overlay at its interpolated
                position, re-encode) via MediaCodec/MediaMuxer — a bigger native pipeline than
                screen recording, which only mirrors the live display. Staged as its own build.
              </Text>
            </View>
          </ScrollView>
        </>
      )}

      <Modal visible={textModal} transparent animationType="fade" onRequestClose={() => setTextModal(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Label>Add text overlay</Label>
            <TextInput
              value={textInput}
              onChangeText={setTextInput}
              placeholder="Type here…"
              placeholderTextColor={C.inkFaint}
              style={styles.input}
              autoFocus
            />
            <View style={styles.modalBtns}>
              <Pressable onPress={() => setTextModal(false)} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  addLayer("text", { text: textInput.trim() || "Text" });
                  setTextInput("");
                  setTextModal(false);
                }}
                style={[styles.modalBtn, { backgroundColor: C.red, borderColor: C.red }]}
              >
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Add</Text>
              </Pressable>
            </View>
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

function OverlaySprite({
  layer,
  transform,
  selected,
  onSelect,
  onDrag,
}: {
  layer: OverlayLayer;
  transform: Keyframe;
  selected: boolean;
  onSelect: (id: string) => void;
  onDrag: (x: number, y: number) => void;
}) {
  const startRef = useRef({ x: transform.x, y: transform.y });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        onSelect(layer.id);
        startRef.current = { x: transform.x, y: transform.y };
      },
      onPanResponderMove: (_e, g) => onDrag(startRef.current.x + g.dx, startRef.current.y + g.dy),
    })
  ).current;

  return (
    <View
      {...pan.panHandlers}
      style={{
        position: "absolute",
        left: transform.x,
        top: transform.y,
        opacity: transform.opacity / 100,
        transform: [{ rotate: `${transform.rotation}deg` }, { scale: transform.scale }],
      }}
    >
      <View style={selected ? styles.spriteSelected : undefined}>
        {layer.kind === "image" && layer.uri ? (
          <Image source={{ uri: layer.uri }} style={{ width: 100, height: 100 }} resizeMode="contain" />
        ) : (
          <Text style={{ color: layer.color, fontSize: 24, fontWeight: "800", fontFamily: F.sansMed }}>{layer.text}</Text>
        )}
      </View>
    </View>
  );
}

function CtrlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.ctrlRow}>
      <Text style={styles.ctrlLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  sub: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 4, marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  videoCell: { width: 96, height: 96, borderRadius: 10, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", padding: 8 },
  canvasWrap: { height: 280, backgroundColor: "#000", marginHorizontal: 16, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: C.line },
  spriteSelected: { borderWidth: 1, borderColor: C.red, borderStyle: "dashed", padding: 2 },
  transportRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  playBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.red, alignItems: "center", justifyContent: "center" },
  panel: { flex: 1 },
  addRow: { flexDirection: "row", gap: 8 },
  addBtn: { flex: 1, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, paddingVertical: 11, alignItems: "center", backgroundColor: C.surface },
  addText: { color: C.inkSoft, fontFamily: F.mono, fontSize: 11.5 },
  layerChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface },
  layerChipOn: { backgroundColor: C.red, borderColor: C.red },
  controls: { marginTop: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 14 },
  controlHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kfBtn: { marginTop: 12, backgroundColor: C.red, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  kfBtnText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 12.5 },
  ctrlRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  ctrlLabel: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, textTransform: "uppercase" },
  kfListLabel: { color: C.inkMute, fontFamily: F.mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginTop: 14, marginBottom: 8 },
  kfList: { gap: 6 },
  kfRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: C.bg2, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8 },
  kfTime: { minWidth: 40 },
  note: { marginTop: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: C.native, borderRadius: 8, padding: 16, gap: 8 },
  noteText: { color: C.inkMute, fontSize: 13, lineHeight: 19 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", backgroundColor: C.surface, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 12, padding: 20 },
  input: { marginTop: 12, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, color: C.ink, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 16 },
  modalBtn: { flex: 1, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  modalBtnText: { color: C.inkSoft, fontFamily: F.sansMed, fontWeight: "600", fontSize: 14 },
  toast: { position: "absolute", bottom: 24, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.8)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 40, borderWidth: 1, borderColor: C.line },
});
