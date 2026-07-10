import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { C, F } from "../theme";
import { Label, Mono, StatusPill } from "../components/ui";

export type ComingSoon = {
  glyph: string;
  title: string;
  phase: string;
  levelLabel: string;
  tone: string;
  blurb: string;
  planned: string[];
};

/** Honest placeholder — mirrors the website's "what's possible" discipline. */
export default function ComingSoonScreen({ data }: { data: ComingSoon }) {
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 22, paddingBottom: 40 }}>
      <Label>§ {data.phase}</Label>
      <Text style={styles.glyph}>{data.glyph}</Text>
      <Text style={styles.title}>{data.title}</Text>
      <View style={{ marginVertical: 14 }}>
        <StatusPill label={data.levelLabel} tone={data.tone} />
      </View>
      <Text style={styles.blurb}>{data.blurb}</Text>

      <Text style={styles.sub}>Planned instruments</Text>
      <View style={styles.list}>
        {data.planned.map((p) => (
          <View key={p} style={styles.row}>
            <Text style={styles.tick}>▸</Text>
            <Text style={styles.rowText}>{p}</Text>
          </View>
        ))}
      </View>

      <View style={styles.note}>
        <Mono color={C.inkMute} size={11}>
          This module is staged in the build. The current release is the app shell — Capture,
          Timelapse, Lab preview and Library work today.
        </Mono>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  glyph: { fontSize: 44, color: C.red, marginTop: 18 },
  title: { color: C.ink, fontFamily: F.sansMed, fontSize: 30, fontWeight: "700", letterSpacing: -0.5, marginTop: 10 },
  blurb: { color: C.inkSoft, fontSize: 15, lineHeight: 22 },
  sub: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 26, marginBottom: 12 },
  list: { gap: 10 },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  tick: { color: C.red, fontSize: 13, marginTop: 2 },
  rowText: { color: C.inkSoft, fontSize: 14.5, flex: 1, lineHeight: 20 },
  note: { marginTop: 28, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 16 },
});
