import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useCameraPermissions } from "expo-camera";
import { SettingsProvider } from "./src/settings";
import { EntitlementProvider, useEntitlement } from "./src/entitlements";
import { C, F } from "./src/theme";
import { Mark } from "./src/components/Mark";
import { Mono } from "./src/components/ui";
import CaptureScreen from "./src/screens/CaptureScreen";
import StudioScreen from "./src/screens/StudioScreen";
import TimelapseScreen from "./src/screens/TimelapseScreen";
import AttachmentsScreen from "./src/screens/AttachmentsScreen";
import ToolsScreen from "./src/screens/ToolsScreen";
import LibraryScreen from "./src/screens/LibraryScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import ScreenRecordScreen from "./src/screens/ScreenRecordScreen";
import RoomScanScreen from "./src/screens/RoomScanScreen";
import ClaymationScreen from "./src/screens/ClaymationScreen";
import TraceScreen from "./src/screens/TraceScreen";

type Kind = "camera" | "plain";
type Tab = { key: string; name: string; glyph: string; kind: Kind };

const TABS: Tab[] = [
  { key: "capture", name: "Capture", glyph: "◎", kind: "camera" },
  { key: "studio", name: "Studio", glyph: "⧉", kind: "plain" },
  { key: "screen", name: "Screen", glyph: "▣", kind: "plain" },
  { key: "timelapse", name: "Timelapse", glyph: "⧗", kind: "camera" },
  { key: "clay", name: "Clay", glyph: "◐", kind: "camera" },
  { key: "scan", name: "Scan", glyph: "◫", kind: "camera" },
  { key: "trace", name: "Trace", glyph: "◈", kind: "camera" },
  { key: "attach", name: "Attachments", glyph: "⊕", kind: "plain" },
  { key: "tools", name: "Tools", glyph: "⚏", kind: "plain" },
  { key: "library", name: "Library", glyph: "▦", kind: "plain" },
  { key: "settings", name: "Settings", glyph: "⚙", kind: "plain" },
];

// Capture and Library are always free. Settings has to stay free too — it's
// where a trial/subscription starts or a code gets redeemed, so gating it
// would make unlocking anything else impossible. Every other tab needs an
// active trial, subscription, or redeemed access code.
const FREE_TABS = new Set(["capture", "library", "settings"]);

function Screen({ tabKey, focused }: { tabKey: string; focused: boolean }) {
  switch (tabKey) {
    case "capture": return <CaptureScreen focused={focused} />;
    case "studio": return <StudioScreen focused={focused} />;
    case "screen": return <ScreenRecordScreen />;
    case "timelapse": return <TimelapseScreen focused={focused} />;
    case "clay": return <ClaymationScreen focused={focused} />;
    case "scan": return <RoomScanScreen focused={focused} />;
    case "trace": return <TraceScreen focused={focused} />;
    case "attach": return <AttachmentsScreen focused={focused} />;
    case "tools": return <ToolsScreen />;
    case "library": return <LibraryScreen focused={focused} />;
    case "settings": return <SettingsScreen focused={focused} />;
    default: return null;
  }
}

function Shell() {
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState("capture");
  const [permission, requestPermission] = useCameraPermissions();
  const [mounted, setMounted] = useState<Set<string>>(new Set());
  const activeTab = TABS.find((t) => t.key === active)!;
  const { pro } = useEntitlement();

  const cameraReady = !!permission?.granted;
  const activeUnlocked = FREE_TABS.has(active) || pro;

  // Keep visited screens mounted (so returning doesn't re-init the camera).
  // Gated screens never mount at all until unlocked — no point spinning up a
  // camera/native module for a tab the user can't use yet.
  useEffect(() => {
    const t = TABS.find((x) => x.key === active)!;
    if (!FREE_TABS.has(t.key) && !pro) return;
    if (t.kind === "camera" && !cameraReady) return; // wait for permission before mounting camera screens
    setMounted((m) => (m.has(active) ? m : new Set([...m, active])));
  }, [active, cameraReady, pro]);

  const showPaywall = !activeUnlocked;
  const showGate = !showPaywall && activeTab.kind === "camera" && permission && !permission.granted;
  const showPermSplash = !showPaywall && activeTab.kind === "camera" && !permission;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <View style={styles.stage}>
        {TABS.filter((t) => mounted.has(t.key)).map((t) => {
          const isActive = t.key === active;
          return (
            <View
              key={t.key}
              style={[StyleSheet.absoluteFill, { paddingTop: insets.top, display: isActive ? "flex" : "none" }]}
            >
              <Screen tabKey={t.key} focused={isActive} />
            </View>
          );
        })}

        {showPermSplash && <View style={[StyleSheet.absoluteFill, { paddingTop: insets.top }]}><Splash label="Checking permissions…" /></View>}
        {showGate && <View style={[StyleSheet.absoluteFill, { paddingTop: insets.top }]}><PermissionGate onGrant={requestPermission} canAsk={permission!.canAskAgain} /></View>}
        {showPaywall && <View style={[StyleSheet.absoluteFill, { paddingTop: insets.top }]}><PaywallGate onOpenSettings={() => setActive("settings")} /></View>}
      </View>

      <View style={[styles.tabbarWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabbar}>
          {TABS.map((t) => {
            const on = t.key === active;
            return (
              <Pressable key={t.key} onPress={() => setActive(t.key)} style={[styles.tab, on && styles.tabOn]}>
                <Text style={[styles.tabGlyph, { color: on ? "#fff" : C.inkMute }]}>{t.glyph}</Text>
                <Text style={[styles.tabName, { color: on ? "#fff" : C.inkMute }]}>{t.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

function Splash({ label }: { label: string }) {
  return (
    <View style={styles.center}>
      <Mark size={64} />
      <Mono color={C.inkMute} size={12} style={{ marginTop: 18 }}>{label}</Mono>
    </View>
  );
}

function PaywallGate({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { trial, recurring, busy, error, buy, available } = useEntitlement();
  return (
    <View style={styles.center}>
      <Mark size={72} />
      <Text style={styles.gateTitle}>Part of the full toolkit</Text>
      <Text style={styles.gateText}>
        Capture and Library are always free. Studio, Screen, Timelapse, Clay, Scan, Trace,
        Attachments, and Tools are unlocked with a trial, subscription, or access code.
      </Text>
      {available ? (
        <Pressable onPress={buy} disabled={busy} style={[styles.gateBtn, busy && { opacity: 0.6 }]}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.gateBtnText}>
              {trial ? "Start free trial" : "Subscribe"}
              {recurring ? ` · ${recurring.price}/mo` : ""}
            </Text>
          )}
        </Pressable>
      ) : (
        <Mono color={C.inkFaint} size={11} style={{ marginTop: 20 }}>Purchases need an Android build with Play Billing linked.</Mono>
      )}
      <Pressable onPress={onOpenSettings} hitSlop={8}>
        <Mono color={C.inkMute} size={12} style={{ marginTop: 18 }}>Have an access code? Open Settings →</Mono>
      </Pressable>
      {error && <Mono color={C.red} size={11} style={{ marginTop: 12 }}>{error}</Mono>}
    </View>
  );
}

function PermissionGate({ onGrant, canAsk }: { onGrant: () => void; canAsk: boolean }) {
  return (
    <View style={styles.center}>
      <Mark size={72} />
      <Text style={styles.gateTitle}>Camera access</Text>
      <Text style={styles.gateText}>
        Lensii is a camera instrument — it needs the camera to show a viewfinder and
        capture. Nothing leaves your device unless you choose to share it.
      </Text>
      <Pressable onPress={onGrant} style={styles.gateBtn}>
        <Text style={styles.gateBtnText}>{canAsk ? "Grant camera access  →" : "Open Settings to allow"}</Text>
      </Pressable>
      <Mono color={C.inkFaint} size={11} style={{ marginTop: 16 }}>Library & Settings work without it.</Mono>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <EntitlementProvider>
          <Shell />
        </EntitlementProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  stage: { flex: 1, position: "relative" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: C.bg },
  gateTitle: { color: C.ink, fontFamily: F.sansMed, fontSize: 26, fontWeight: "700", letterSpacing: -0.5, marginTop: 24 },
  gateText: { color: C.inkSoft, fontSize: 14.5, lineHeight: 22, textAlign: "center", marginTop: 12, maxWidth: 340 },
  gateBtn: { marginTop: 26, backgroundColor: C.red, paddingHorizontal: 24, paddingVertical: 15, borderRadius: 8 },
  gateBtnText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 15 },
  tabbarWrap: { backgroundColor: C.bg2, borderTopWidth: 1, borderTopColor: C.line },
  tabbar: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  tab: { alignItems: "center", justifyContent: "center", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 40, borderWidth: 1, borderColor: "transparent", minWidth: 62 },
  tabOn: { backgroundColor: C.red },
  tabGlyph: { fontSize: 18, marginBottom: 3 },
  tabName: { fontFamily: F.mono, fontSize: 10, letterSpacing: 0.3 },
});
