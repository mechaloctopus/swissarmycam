import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView } from "react-native";
import { C, F } from "../theme";
import { Label, Mono, StatusPill } from "../components/ui";
import {
  UnitGroup,
  UnitDef,
  LENGTH_UNITS,
  VOLUME_UNITS,
  WEIGHT_UNITS,
  TEMPERATURE_UNITS,
  GROUPS,
  convert,
  convertTemperature,
  formatResult,
} from "../units";

export default function ToolsScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, paddingBottom: 44 }}>
      <Label>§ Tools · Utility instruments</Label>
      <Text style={styles.title}>Away from the lens.</Text>
      <Text style={styles.sub}>Measurement conversion and site-planning instruments — no camera required.</Text>

      <UnitConverter />
      <NerfMeasureCard />
    </ScrollView>
  );
}

function UnitConverter() {
  const [group, setGroup] = useState<UnitGroup>("length");
  const units = group === "length" ? LENGTH_UNITS : group === "volume" ? VOLUME_UNITS : group === "weight" ? WEIGHT_UNITS : null;

  const [fromKey, setFromKey] = useState("cm");
  const [toKey, setToKey] = useState("in");
  const [tempFrom, setTempFrom] = useState<"c" | "f" | "k">("c");
  const [tempTo, setTempTo] = useState<"c" | "f" | "k">("f");
  const [input, setInput] = useState("1");

  const onGroupChange = (g: UnitGroup) => {
    setGroup(g);
    const list = g === "length" ? LENGTH_UNITS : g === "volume" ? VOLUME_UNITS : g === "weight" ? WEIGHT_UNITS : null;
    if (list) {
      setFromKey(list[0].key);
      setToKey(list[1].key);
    }
  };

  const value = parseFloat(input);
  const result = useMemo(() => {
    if (isNaN(value)) return null;
    if (group === "temperature") return convertTemperature(value, tempFrom, tempTo);
    if (!units) return null;
    const from = units.find((u) => u.key === fromKey);
    const to = units.find((u) => u.key === toKey);
    if (!from || !to) return null;
    return convert(value, from, to);
  }, [value, group, units, fromKey, toKey, tempFrom, tempTo]);

  const swap = () => {
    if (group === "temperature") {
      setTempFrom(tempTo);
      setTempTo(tempFrom);
    } else {
      setFromKey(toKey);
      setToKey(fromKey);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.groupRow}>
        {GROUPS.map((g) => (
          <Pressable key={g.key} onPress={() => onGroupChange(g.key)} style={[styles.groupChip, group === g.key && styles.groupChipOn]}>
            <Text style={{ fontSize: 14 }}>{g.glyph}</Text>
            <Text style={[styles.groupText, group === g.key && { color: "#fff" }]}>{g.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.convertRow}>
        <View style={styles.convertSide}>
          <Mono color={C.inkMute} size={10} style={{ marginBottom: 8, letterSpacing: 1 }}>FROM</Mono>
          <TextInput
            value={input}
            onChangeText={setInput}
            keyboardType="numeric"
            style={styles.input}
            placeholder="0"
            placeholderTextColor={C.inkFaint}
          />
          {group === "temperature" ? (
            <UnitPicker items={TEMPERATURE_UNITS} value={tempFrom} onChange={(v) => setTempFrom(v as "c" | "f" | "k")} />
          ) : (
            units && <UnitPicker items={units} value={fromKey} onChange={setFromKey} />
          )}
        </View>

        <Pressable onPress={swap} style={styles.swapBtn}>
          <Text style={{ color: C.red, fontSize: 20 }}>⇄</Text>
        </Pressable>

        <View style={styles.convertSide}>
          <Mono color={C.inkMute} size={10} style={{ marginBottom: 8, letterSpacing: 1 }}>TO</Mono>
          <View style={styles.resultBox}>
            <Text style={styles.resultText} numberOfLines={1} adjustsFontSizeToFit>
              {result === null ? "—" : formatResult(result)}
            </Text>
          </View>
          {group === "temperature" ? (
            <UnitPicker items={TEMPERATURE_UNITS} value={tempTo} onChange={(v) => setTempTo(v as "c" | "f" | "k")} />
          ) : (
            units && <UnitPicker items={units} value={toKey} onChange={setToKey} />
          )}
        </View>
      </View>
    </View>
  );
}

function UnitPicker<T extends { key: string; label: string }>({ items, value, onChange }: { items: T[]; value: string; onChange: (key: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {items.map((u) => (
        <Pressable key={u.key} onPress={() => onChange(u.key)} style={[styles.unitChip, value === u.key && styles.unitChipOn]}>
          <Text style={[styles.unitChipText, value === u.key && { color: "#fff" }]}>{u.key}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function NerfMeasureCard() {
  return (
    <View style={[styles.card, styles.nerfCard]}>
      <View style={styles.nerfHead}>
        <View>
          <Mono color={C.inkMute} size={10} style={{ letterSpacing: 1.2 }}>CAPTURE IS LIVE</Mono>
          <Text style={styles.nerfTitle}>NeRF Measure</Text>
        </View>
        <StatusPill label="Reconstruct: planned" tone={C.attach} />
      </View>

      <Text style={styles.nerfBody}>
        Walk a room or job site capturing overlapping multi-angle photos in the new{" "}
        <Text style={{ color: C.ink, fontWeight: "700" }}>Scan</Text> tab — real, on-device, working
        today. NeRF Measure reconstructs that photo set into a 3D scene — a neural radiance field,
        the same family of technique behind tools like Polycam and Luma — and lets you drop
        measurement points directly on the reconstructed model to read real-world distances, areas,
        and volumes back out of the scan.
      </Text>

      <View style={styles.nerfSteps}>
        {[
          "Capture — real today: Scan tab, guided multi-angle photo set",
          "Reconstruct — on-device pre-processing, cloud NeRF/photogrammetry solve",
          "Measure — tap two points on the 3D model, read the real distance",
        ].map((s, i) => (
          <View key={s} style={styles.nerfStep}>
            <Mono color={i === 0 ? C.go : C.red} size={11}>{String(i + 1).padStart(2, "0")}</Mono>
            <Text style={styles.nerfStepText}>{s}</Text>
          </View>
        ))}
      </View>

      <View style={styles.nerfNote}>
        <Mono color={C.attach} size={10}>RECONSTRUCTION REQUIRES CLOUD COMPUTE + NATIVE AR</Mono>
        <Text style={styles.nerfNoteText}>
          Reconstructing a radiance field from a handful of frames is heavy — real-time on a phone
          isn't there yet, so this ships as capture-on-device (done), reconstruct-in-the-cloud,
          review-and-measure-on-device (still ahead). Scans captured in the Scan tab are saved and
          ready for that pipeline whenever it exists — nothing here is faked. AR measurement overlay
          reuses ARKit/ARCore for the live view once the reconstruction pipeline lands.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  title: { color: C.ink, fontFamily: F.sansMed, fontSize: 26, fontWeight: "700", letterSpacing: -0.5, marginTop: 10 },
  sub: { color: C.inkMute, fontSize: 14, marginTop: 8, lineHeight: 20, maxWidth: 46 * 8 },
  card: { marginTop: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 16 },
  groupRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  groupChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 40, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.bg2 },
  groupChipOn: { backgroundColor: C.red, borderColor: C.red },
  groupText: { color: C.inkSoft, fontFamily: F.mono, fontSize: 12 },
  convertRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, marginTop: 20 },
  convertSide: { flex: 1 },
  input: { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, color: C.ink, fontFamily: F.mono, fontSize: 20, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 },
  resultBox: { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.red, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10, minHeight: 48, justifyContent: "center" },
  resultText: { color: C.red, fontFamily: F.mono, fontSize: 20, fontWeight: "700" },
  swapBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  unitChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 40, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface2 },
  unitChipOn: { backgroundColor: C.ink, borderColor: C.ink },
  unitChipText: { color: C.inkSoft, fontFamily: F.mono, fontSize: 11.5 },
  nerfCard: { borderColor: C.attach, backgroundColor: "rgba(154,108,255,0.06)" },
  nerfHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  nerfTitle: { color: C.ink, fontFamily: F.sansMed, fontSize: 22, fontWeight: "700", letterSpacing: -0.4, marginTop: 4 },
  nerfBody: { color: C.inkSoft, fontSize: 14, lineHeight: 21, marginTop: 14 },
  nerfSteps: { marginTop: 16, gap: 10 },
  nerfStep: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  nerfStepText: { color: C.inkSoft, fontSize: 13, flex: 1, lineHeight: 19 },
  nerfNote: { marginTop: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: C.attach, borderRadius: 8, padding: 14, gap: 8 },
  nerfNoteText: { color: C.inkMute, fontSize: 12.5, lineHeight: 18 },
});
