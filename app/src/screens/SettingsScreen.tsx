import React from "react";
import { View, Text, StyleSheet, ScrollView, Linking, Pressable } from "react-native";
import Constants from "expo-constants";
import { C, F } from "../theme";
import { Label, Mono } from "../components/ui";
import { Mark } from "../components/Mark";

const CAPS: { name: string; level: string; tone: string }[] = [
  { name: "Photo capture, flip, flash, zoom", level: "Possible now", tone: C.go },
  { name: "Grid · level · reticle · self-timer", level: "Possible now", tone: C.go },
  { name: "Interval timelapse (frames)", level: "Possible now", tone: C.go },
  { name: "Local-first library", level: "Possible now", tone: C.go },
  { name: "Manual ISO / shutter / RAW", level: "Requires native code", tone: C.native },
  { name: "Green-screen compositor", level: "Requires native code", tone: C.native },
  { name: "Screen + facecam recording", level: "Requires native code", tone: C.native },
  { name: "Frame → MP4 timelapse export", level: "Requires native code", tone: C.native },
  { name: "IR / thermal / UV", level: "Requires attachment", tone: C.attach },
];

const PRIVACY = [
  "Captures are stored on-device by default — private by default.",
  "“Save to Photos” is an explicit, separate action.",
  "No covert recording. No selling camera data.",
  "Trademark & brand under review before launch.",
];

export default function SettingsScreen() {
  const version = Constants.expoConfig?.version ?? "0.1.0";
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 22, paddingBottom: 44 }}>
      <View style={styles.brand}>
        <Mark size={40} />
        <View>
          <Text style={styles.name}>Swiss Army Camera</Text>
          <Mono color={C.inkMute} size={11}>Precision tools for mobile vision</Mono>
        </View>
      </View>

      <View style={styles.verRow}>
        <Mono color={C.inkSoft} size={12}>v{version} · Android · Phase 2 shell</Mono>
        <Mono color={C.inkMute} size={11}>working name</Mono>
      </View>

      <Label style={{ marginTop: 26 }}>Capability map</Label>
      <View style={styles.caps}>
        {CAPS.map((c) => (
          <View key={c.name} style={styles.capRow}>
            <View style={[styles.capDot, { backgroundColor: c.tone }]} />
            <Text style={styles.capName}>{c.name}</Text>
            <Text style={[styles.capLevel, { color: c.tone }]}>{c.level}</Text>
          </View>
        ))}
      </View>

      <Label style={{ marginTop: 28 }}>Privacy & ethics</Label>
      <View style={styles.privacy}>
        {PRIVACY.map((p) => (
          <View key={p} style={styles.pRow}>
            <Text style={styles.pTick}>✓</Text>
            <Text style={styles.pText}>{p}</Text>
          </View>
        ))}
      </View>

      <Pressable onPress={() => Linking.openURL("https://github.com/mechaloctopus/swissarmycam")} style={styles.link}>
        <Text style={styles.linkText}>View the project on GitHub  →</Text>
      </Pressable>

      <Text style={styles.legal}>
        “Swiss Army Camera” is a working project name. Name, branding, and trademark strategy are
        subject to final review, and are not affiliated with Victorinox or any armed forces.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  brand: { flexDirection: "row", alignItems: "center", gap: 14 },
  name: { color: C.ink, fontFamily: F.sansMed, fontSize: 20, fontWeight: "700", letterSpacing: -0.4 },
  verRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.line },
  caps: { marginTop: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 8, overflow: "hidden" },
  capRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  capDot: { width: 8, height: 8, borderRadius: 4 },
  capName: { color: C.inkSoft, fontSize: 13.5, flex: 1 },
  capLevel: { fontFamily: F.mono, fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase" },
  privacy: { marginTop: 12, gap: 12 },
  pRow: { flexDirection: "row", gap: 12 },
  pTick: { color: C.red, fontSize: 13 },
  pText: { color: C.inkMute, fontSize: 13.5, flex: 1, lineHeight: 20 },
  link: { marginTop: 26, backgroundColor: C.surface, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, padding: 16, alignItems: "center" },
  linkText: { color: C.ink, fontFamily: F.sansMed, fontWeight: "600", fontSize: 14 },
  legal: { color: C.inkFaint, fontSize: 11, lineHeight: 17, marginTop: 22 },
});
