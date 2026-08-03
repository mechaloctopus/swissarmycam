import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { C, F } from "../theme";
import { Mono } from "../components/ui";
import { useEntitlement } from "../entitlements";
import CaptureScreen from "./CaptureScreen";
import TimelapseScreen from "./TimelapseScreen";
import ClaymationScreen from "./ClaymationScreen";
import TraceScreen from "./TraceScreen";
import ScreenRecordScreen from "./ScreenRecordScreen";

export type CaptureMode = "camera" | "timelapse" | "clay" | "trace" | "screen";

/**
 * Every mode is a way of *capturing*, so they live behind one tab instead of
 * six. The rail floats over the viewfinder rather than taking a strip of
 * layout, which is what lets each mode keep a genuinely full-bleed camera.
 *
 * `free` is per-mode, not per-tab: folding these in under Capture must not
 * hand away what the subscription pays for, so Photo/Video stay free and the
 * rest still gate.
 */
const MODES: { key: CaptureMode; label: string; glyph: string; free: boolean }[] = [
  { key: "camera", label: "Photo · Video", glyph: "◎", free: true },
  { key: "timelapse", label: "Timelapse", glyph: "⧗", free: false },
  { key: "clay", label: "Clay", glyph: "◐", free: false },
  { key: "trace", label: "Trace", glyph: "◈", free: false },
  { key: "screen", label: "Screen", glyph: "▣", free: false },
];

const MODE_KEY = "lensii.captureMode";

export default function CaptureHub({ focused }: { focused: boolean }) {
  const [mode, setMode] = useState<CaptureMode>("camera");
  const [mounted, setMounted] = useState<Set<CaptureMode>>(new Set(["camera"]));
  const [railOpen, setRailOpen] = useState(true);
  const { pro } = useEntitlement();

  const current = MODES.find((m) => m.key === mode)!;
  const unlocked = current.free || pro;

  useEffect(() => {
    AsyncStorage.getItem(MODE_KEY)
      .then((k) => {
        if (k && MODES.some((m) => m.key === k)) setMode(k as CaptureMode);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(MODE_KEY, mode).catch(() => {});
    // Only mount a mode once it's been chosen and is actually usable — no
    // sense spinning up a second camera or ARCore session behind a paywall.
    if (unlocked) setMounted((s) => (s.has(mode) ? s : new Set([...s, mode])));
  }, [mode, unlocked]);

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        {MODES.filter((m) => mounted.has(m.key)).map((m) => {
          const on = m.key === mode && unlocked;
          return (
            <View key={m.key} style={[StyleSheet.absoluteFill, { display: on ? "flex" : "none" }]}>
              {m.key === "camera" && <CaptureScreen focused={focused && on} />}
              {m.key === "timelapse" && <TimelapseScreen focused={focused && on} />}
              {m.key === "clay" && <ClaymationScreen focused={focused && on} />}
              {m.key === "trace" && <TraceScreen focused={focused && on} />}
              {m.key === "screen" && <ScreenRecordScreen />}
            </View>
          );
        })}

        {!unlocked && (
          <View style={styles.locked}>
            <Text style={styles.lockGlyph}>{current.glyph}</Text>
            <Text style={styles.lockTitle}>{current.label}</Text>
            <Text style={styles.lockText}>
              Photo and Video are free forever. {current.label} is part of the full toolkit — start a
              trial, subscribe, or redeem a code in Settings.
            </Text>
          </View>
        )}
      </View>

      {/* Floating mode rail — collapsible, so the viewfinder can be clean. */}
      <View style={styles.railWrap} pointerEvents="box-none">
        {railOpen ? (
          <View style={styles.rail}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
              {MODES.map((m) => {
                const on = m.key === mode;
                return (
                  <Pressable key={m.key} onPress={() => setMode(m.key)} style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipGlyph, { color: on ? "#fff" : C.inkMute }]}>{m.glyph}</Text>
                    <Text style={[styles.chipText, { color: on ? "#fff" : C.inkMute }]}>{m.label}</Text>
                    {!m.free && !pro && <View style={styles.lockDot} />}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable onPress={() => setRailOpen(false)} hitSlop={10} style={styles.railToggle}>
              <Text style={styles.railToggleText}>▲</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setRailOpen(true)} style={styles.railPeek} hitSlop={8}>
            <Text style={styles.chipGlyph}>{current.glyph}</Text>
            <Mono color={C.inkSoft} size={10}>{current.label}</Mono>
            <Text style={styles.railToggleText}>▼</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  stage: { flex: 1, position: "relative" },
  railWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  rail: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(11,11,12,0.82)",
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingRight: 6,
  },
  railRow: { flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: C.lineStrong,
  },
  chipOn: { backgroundColor: C.red, borderColor: C.red },
  chipGlyph: { fontSize: 14 },
  chipText: { fontFamily: F.mono, fontSize: 10.5 },
  lockDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.attach },
  railToggle: { paddingHorizontal: 8, paddingVertical: 10 },
  railToggleText: { color: C.inkMute, fontSize: 11 },
  railPeek: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    marginLeft: 12,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 40,
    backgroundColor: "rgba(11,11,12,0.8)",
    borderWidth: 1,
    borderColor: C.lineStrong,
  },
  locked: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: C.bg },
  lockGlyph: { fontSize: 40, color: C.inkMute },
  lockTitle: { color: C.ink, fontFamily: F.sansMed, fontSize: 22, fontWeight: "700", marginTop: 14 },
  lockText: { color: C.inkSoft, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 10, maxWidth: 330 },
});
