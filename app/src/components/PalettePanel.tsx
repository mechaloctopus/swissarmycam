import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { C, F } from "../theme";
import { Mono } from "./ui";
import { Swatch, readableInk } from "../analyze";

/** Renders an extracted colour palette as labelled swatches. */
export function PalettePanel({ swatches, loading }: { swatches: Swatch[]; loading?: boolean }) {
  if (loading) {
    return (
      <View style={styles.wrap}>
        <Mono color={C.inkMute} size={11}>ANALYSING…</Mono>
      </View>
    );
  }
  if (!swatches.length) return null;
  return (
    <View style={styles.wrap}>
      <Mono color={C.inkMute} size={10} style={{ marginBottom: 10, letterSpacing: 1 }}>COLOUR PALETTE · {swatches.length}</Mono>
      <View style={styles.grid}>
        {swatches.map((s) => (
          <View key={s.label} style={[styles.swatch, { backgroundColor: s.hex }]}>
            <Text style={[styles.hex, { color: readableInk(s.hex) }]}>{s.hex.toUpperCase()}</Text>
            <Text style={[styles.label, { color: readableInk(s.hex) }]}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  swatch: { width: "31.5%", aspectRatio: 1.5, borderRadius: 8, padding: 8, justifyContent: "flex-end", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  hex: { fontFamily: F.mono, fontSize: 11, fontWeight: "600" },
  label: { fontFamily: F.mono, fontSize: 8.5, opacity: 0.8, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.3 },
});
