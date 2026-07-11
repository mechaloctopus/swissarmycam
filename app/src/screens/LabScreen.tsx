import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { CameraView } from "expo-camera";
import { C, F } from "../theme";
import { Label, Mono } from "../components/ui";
import { GridOverlay, Reticle, LevelIndicator } from "../components/Overlays";
import { PalettePanel } from "../components/PalettePanel";
import { extractPalette, Swatch } from "../analyze";

type Mode = "grid" | "reticle" | "level" | "thirds-safe" | "warm" | "cool" | "false";

const TOGGLES: { id: Mode; name: string; real: boolean }[] = [
  { id: "grid", name: "Rule of thirds", real: true },
  { id: "reticle", name: "Center reticle", real: true },
  { id: "level", name: "Electronic level", real: true },
  { id: "thirds-safe", name: "Safe margins", real: true },
  { id: "warm", name: "Warm look", real: true },
  { id: "cool", name: "Cool look", real: true },
  { id: "false", name: "False-colour scope", real: false },
];

export default function LabScreen({ focused }: { focused: boolean }) {
  const camRef = useRef<CameraView>(null);
  const [active, setActive] = useState<Set<Mode>>(new Set(["reticle"]));
  const [palette, setPalette] = useState<Swatch[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const toggle = (m: Mode) =>
    setActive((s) => {
      const n = new Set(s);
      n.has(m) ? n.delete(m) : n.add(m);
      return n;
    });
  const on = (m: Mode) => active.has(m);

  const analyzeFrame = async () => {
    if (!camRef.current || analyzing) return;
    setAnalyzing(true);
    try {
      const p = await camRef.current.takePictureAsync({ quality: 0.6, skipProcessing: true });
      if (p?.uri) setPalette(await extractPalette(p.uri));
    } catch {
      // ignore
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.viewport}>
        <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" active={focused} />
        {on("grid") && <GridOverlay />}
        {on("reticle") && <Reticle />}
        {on("level") && <LevelIndicator />}
        {on("thirds-safe") && <SafeMargins />}
        {on("warm") && <Tint color="rgba(224,120,20,0.16)" />}
        {on("cool") && <Tint color="rgba(40,110,224,0.16)" />}
        {on("false") && <FalseColour />}

        <View style={styles.hud}>
          <Mono color={C.inkSoft} size={11}>LAB · LIVE PREVIEW</Mono>
        </View>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
        <Label>§ Lab · Experimental overlays</Label>
        <View style={styles.grid}>
          {TOGGLES.map((t) => (
            <Pressable key={t.id} onPress={() => toggle(t.id)} style={[styles.cell, on(t.id) && styles.cellOn]}>
              <View style={styles.cellTop}>
                <View style={[styles.led, { backgroundColor: on(t.id) ? C.red : C.lineStrong }]} />
                {!t.real && <Text style={styles.gpuTag}>GPU</Text>}
              </View>
              <Text style={[styles.cellName, on(t.id) && { color: C.ink }]}>{t.name}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.viLabel}>Visual intelligence</Text>
        <Pressable onPress={analyzeFrame} disabled={analyzing} style={[styles.analyzeBtn, analyzing && { opacity: 0.6 }]}>
          <Text style={styles.analyzeText}>{analyzing ? "Analysing frame…" : "◉  Capture & analyse frame"}</Text>
        </Pressable>
        <PalettePanel swatches={palette} loading={analyzing} />

        <View style={styles.note}>
          <Mono color={C.native} size={10}>ON-DEVICE</Mono>
          <Text style={styles.noteText}>
            Colour-palette extraction runs on-device from a captured frame — real visual
            intelligence. Overlays above are real view-layer guides and looks. Deeper pixel
            analysis —
            edge detection, motion difference, frame stacking and calibrated false-colour mapping —
            runs on the GPU shader pipeline in the native module (Phase 6). Modes marked{" "}
            <Text style={{ color: C.native }}>GPU</Text> are previews of that intent, not the final compute.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Tint({ color }: { color: string }) {
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />;
}

function SafeMargins() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { padding: "6%" }]}>
      <View style={{ flex: 1, borderWidth: 1, borderColor: "rgba(255,255,255,0.35)", borderStyle: "dashed" }} />
    </View>
  );
}

/** A simple banded scrim to suggest a luminance scope. Clearly a preview, not real analysis. */
function FalseColour() {
  const bands = ["rgba(0,0,255,0.10)", "rgba(0,255,160,0.10)", "rgba(255,220,0,0.12)", "rgba(255,60,0,0.12)"];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {bands.map((b, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: b }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  viewport: { height: "44%", backgroundColor: "#000" },
  hud: { position: "absolute", top: 12, left: 14, backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 40 },
  panel: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  cell: { width: "47.5%", backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 14, minHeight: 74, justifyContent: "space-between" },
  cellOn: { borderColor: C.lineStrong, backgroundColor: C.surface2 },
  cellTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  led: { width: 9, height: 9, borderRadius: 5 },
  gpuTag: { fontFamily: F.mono, fontSize: 9, color: C.native, letterSpacing: 0.5, borderWidth: 1, borderColor: C.line, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 40 },
  cellName: { color: C.inkSoft, fontFamily: F.sans, fontSize: 14, fontWeight: "600" },
  note: { marginTop: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: C.native, borderRadius: 8, padding: 16, gap: 8 },
  noteText: { color: C.inkMute, fontSize: 13, lineHeight: 19 },
  viLabel: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 22, marginBottom: 10 },
  analyzeBtn: { backgroundColor: C.red, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  analyzeText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 14 },
});
