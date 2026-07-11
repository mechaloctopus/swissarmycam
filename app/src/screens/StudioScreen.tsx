import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, PanResponder, ScrollView, Image, Modal, TextInput, LayoutChangeEvent } from "react-native";
import { captureRef } from "react-native-view-shot";
import { C, F } from "../theme";
import { Label, Mono } from "../components/ui";
import { Slider } from "../components/controls";
import { listMedia, saveCapture } from "../store";
import { saveToPhotos } from "../media";
import { useSettings } from "../settings";

type LayerType = "text" | "sticker";
type Layer = {
  id: string;
  type: LayerType;
  text: string;
  color: string;
  x: number;
  y: number;
  scale: number; // 0.3–3
  rotation: number; // -180–180
  opacity: number; // 0–100
};

const STICKERS = ["⭐", "❤️", "🔥", "📷", "✚", "✔", "➡", "●", "▲", "■", "☀", "🌙", "⚡", "🎯", "💧", "🏔"];
const COLORS = ["#FFFFFF", "#E0231C", "#0B0B0C", "#8B9298", "#E0A62A", "#37B36B", "#4C8DFF"];
let seq = 0;

export default function StudioScreen({ focused }: { focused: boolean }) {
  const { settings } = useSettings();
  const canvasRef = useRef<View>(null);
  const [canvas, setCanvas] = useState({ w: 0, h: 0 });
  const [baseUri, setBaseUri] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [textModal, setTextModal] = useState<{ open: boolean; value: string; editing: string | null }>({ open: false, value: "", editing: null });
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const loadRecent = useCallback(async () => {
    const m = await listMedia();
    setRecent(m.filter((i) => i.kind === "photo").map((i) => i.uri).slice(0, 12));
  }, []);
  useEffect(() => {
    if (focused) loadRecent();
  }, [focused, loadRecent]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1600);
  };

  const sel = layers.find((l) => l.id === selected) || null;
  const patch = (id: string, p: Partial<Layer>) => setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));

  const addLayer = (type: LayerType, text: string) => {
    const id = `L${++seq}`;
    setLayers((ls) => [
      ...ls,
      { id, type, text, color: "#FFFFFF", x: canvas.w / 2 - 30, y: canvas.h / 2 - 20, scale: 1, rotation: 0, opacity: 100 },
    ]);
    setSelected(id);
  };

  const removeSel = () => {
    if (!sel) return;
    setLayers((ls) => ls.filter((l) => l.id !== sel.id));
    setSelected(null);
  };

  const bringFront = () => {
    if (!sel) return;
    setLayers((ls) => [...ls.filter((l) => l.id !== sel.id), sel]);
  };

  const doExport = async () => {
    if (exporting) return;
    if (!baseUri && layers.length === 0) return flash("Add a base or a layer first");
    setExporting(true);
    setSelected(null);
    try {
      await new Promise((r) => setTimeout(r, 60)); // let selection UI clear before capture
      const uri = await captureRef(canvasRef, { format: "jpg", quality: 0.95 });
      const saved = await saveCapture(uri);
      if (settings.autoSaveToPhotos) saveToPhotos(saved);
      flash("Exported to Library ✓");
      loadRecent();
    } catch {
      flash("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const onCanvasLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setCanvas({ w: width, h: height });
  };

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Label>§ Studio · Compositor</Label>
        <Mono color={C.inkMute} size={11}>{layers.length} LAYERS</Mono>
      </View>

      {/* canvas */}
      <View style={styles.canvasWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelected(null)} />
        <View ref={canvasRef} collapsable={false} style={styles.canvas} onLayout={onCanvasLayout}>
          {baseUri ? (
            <Image source={{ uri: baseUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.blankBase]}>
              <Mono color={C.inkFaint} size={11}>NO BASE · transparent dark</Mono>
            </View>
          )}
          {layers.map((l) => (
            <DraggableLayer key={l.id} layer={l} selected={l.id === selected} onSelect={setSelected} onMove={(id, x, y) => patch(id, { x, y })} />
          ))}
        </View>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        {/* base picker */}
        <Text style={styles.sub}>Base image</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Pressable onPress={() => setBaseUri(null)} style={[styles.baseCell, !baseUri && styles.baseCellOn]}>
            <Text style={{ color: C.inkMute, fontSize: 11, fontFamily: F.mono }}>None</Text>
          </Pressable>
          {recent.map((u) => (
            <Pressable key={u} onPress={() => setBaseUri(u)} style={[styles.baseCell, baseUri === u && styles.baseCellOn]}>
              <Image source={{ uri: u }} style={styles.baseThumb} />
            </Pressable>
          ))}
          {recent.length === 0 && <Mono color={C.inkFaint} size={11}>Capture a photo first</Mono>}
        </ScrollView>

        {/* add */}
        <View style={styles.addRow}>
          <Pressable onPress={() => setTextModal({ open: true, value: "", editing: null })} style={styles.addBtn}>
            <Text style={styles.addText}>+ Text</Text>
          </Pressable>
          <Pressable onPress={bringFront} disabled={!sel} style={[styles.addBtn, !sel && { opacity: 0.4 }]}>
            <Text style={styles.addText}>Bring to front</Text>
          </Pressable>
          <Pressable onPress={removeSel} disabled={!sel} style={[styles.addBtn, { borderColor: C.red }, !sel && { opacity: 0.4 }]}>
            <Text style={[styles.addText, { color: C.red }]}>Delete</Text>
          </Pressable>
        </View>

        <Text style={styles.sub}>Stickers</Text>
        <View style={styles.stickerGrid}>
          {STICKERS.map((s) => (
            <Pressable key={s} onPress={() => addLayer("sticker", s)} style={styles.sticker}>
              <Text style={{ fontSize: 22 }}>{s}</Text>
            </Pressable>
          ))}
        </View>

        {/* selected layer controls */}
        {sel && (
          <View style={styles.controls}>
            <View style={styles.controlHead}>
              <Mono color={C.ink} size={12}>{sel.type === "text" ? `“${sel.text}”` : sel.text}</Mono>
              {sel.type === "text" && (
                <Pressable onPress={() => setTextModal({ open: true, value: sel.text, editing: sel.id })}>
                  <Mono color={C.red} size={11}>edit</Mono>
                </Pressable>
              )}
            </View>
            <CtrlRow label="Size"><Slider value={Math.round(sel.scale * 100)} min={30} max={300} step={5} onChange={(v) => patch(sel.id, { scale: v / 100 })} width={150} /></CtrlRow>
            <CtrlRow label="Rotate"><Slider value={sel.rotation} min={-180} max={180} step={1} onChange={(v) => patch(sel.id, { rotation: v })} width={150} /></CtrlRow>
            <CtrlRow label="Opacity"><Slider value={sel.opacity} min={10} max={100} step={5} onChange={(v) => patch(sel.id, { opacity: v })} width={150} /></CtrlRow>
            {sel.type === "text" && (
              <View style={styles.swatches}>
                {COLORS.map((c) => (
                  <Pressable key={c} onPress={() => patch(sel.id, { color: c })} style={[styles.swatch, { backgroundColor: c }, sel.color === c && styles.swatchOn]} />
                ))}
              </View>
            )}
          </View>
        )}

        <Pressable onPress={doExport} disabled={exporting} style={[styles.export, exporting && { opacity: 0.6 }]}>
          <Text style={styles.exportText}>{exporting ? "Exporting…" : "⤓  Export to Library"}</Text>
        </Pressable>

        <View style={styles.note}>
          <Mono color={C.native} size={10}>REQUIRES NATIVE CODE</Mono>
          <Text style={styles.noteText}>
            This is the layer compositor in basic form — base image, text and sticker layers, drag,
            scale, rotate, opacity, flatten &amp; export. GPU chroma key (green screen), a video
            timeline and keyframes arrive with the native module — Phase 4+.
          </Text>
        </View>
      </ScrollView>

      <Modal visible={textModal.open} transparent animationType="fade" onRequestClose={() => setTextModal({ open: false, value: "", editing: null })}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Label>{textModal.editing ? "Edit text" : "Add text"}</Label>
            <TextInput
              value={textModal.value}
              onChangeText={(t) => setTextModal((m) => ({ ...m, value: t }))}
              placeholder="Type here…"
              placeholderTextColor={C.inkFaint}
              style={styles.input}
              autoFocus
            />
            <View style={styles.modalBtns}>
              <Pressable onPress={() => setTextModal({ open: false, value: "", editing: null })} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const v = textModal.value.trim() || "Text";
                  if (textModal.editing) patch(textModal.editing, { text: v });
                  else addLayer("text", v);
                  setTextModal({ open: false, value: "", editing: null });
                }}
                style={[styles.modalBtn, { backgroundColor: C.red, borderColor: C.red }]}
              >
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>{textModal.editing ? "Save" : "Add"}</Text>
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

function DraggableLayer({ layer, selected, onSelect, onMove }: { layer: Layer; selected: boolean; onSelect: (id: string) => void; onMove: (id: string, x: number, y: number) => void }) {
  const posRef = useRef({ x: layer.x, y: layer.y });
  posRef.current = { x: layer.x, y: layer.y };
  const startRef = useRef({ x: 0, y: 0 });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        onSelect(layer.id);
        startRef.current = { ...posRef.current };
      },
      onPanResponderMove: (_e, g) => onMove(layer.id, startRef.current.x + g.dx, startRef.current.y + g.dy),
    })
  ).current;

  return (
    <View
      {...pan.panHandlers}
      style={{
        position: "absolute",
        left: layer.x,
        top: layer.y,
        opacity: layer.opacity / 100,
        transform: [{ rotate: `${layer.rotation}deg` }, { scale: layer.scale }],
      }}
    >
      <View style={selected ? styles.layerSelected : undefined}>
        {layer.type === "text" ? (
          <Text style={{ color: layer.color, fontSize: 26, fontWeight: "800", fontFamily: F.sansMed }}>{layer.text}</Text>
        ) : (
          <Text style={{ fontSize: 40 }}>{layer.text}</Text>
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
  canvasWrap: { alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  canvas: { width: "100%", aspectRatio: 3 / 4, maxHeight: 360, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: C.line, backgroundColor: "#101216" },
  blankBase: { alignItems: "center", justifyContent: "center", backgroundColor: "#101216" },
  layerSelected: { borderWidth: 1, borderColor: C.red, borderStyle: "dashed", padding: 2 },
  panel: { flex: 1, marginTop: 8 },
  sub: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 14, marginBottom: 10 },
  baseCell: { width: 54, height: 54, borderRadius: 8, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  baseCellOn: { borderColor: C.red },
  baseThumb: { width: "100%", height: "100%" },
  addRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  addBtn: { flex: 1, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, paddingVertical: 11, alignItems: "center", backgroundColor: C.surface },
  addText: { color: C.inkSoft, fontFamily: F.mono, fontSize: 12 },
  stickerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sticker: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  controls: { marginTop: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 14 },
  controlHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  ctrlRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  ctrlLabel: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, textTransform: "uppercase" },
  swatches: { flexDirection: "row", gap: 8, marginTop: 10 },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "transparent" },
  swatchOn: { borderColor: C.ink },
  export: { marginTop: 20, backgroundColor: C.red, borderRadius: 8, paddingVertical: 16, alignItems: "center" },
  exportText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 15 },
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
