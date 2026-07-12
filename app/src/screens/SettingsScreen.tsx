import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Linking, Pressable, Alert } from "react-native";
import Constants from "expo-constants";
import { C, F } from "../theme";
import { Mono } from "../components/ui";
import { Mark } from "../components/Mark";
import { Row, Section, Toggle, Segmented, Slider, Stepper } from "../components/controls";
import { useSettings, DEFAULTS } from "../settings";
import { loadPictureSizes, sortSizes } from "../caps";
import { storageBytes, humanBytes, clearAllCaptures, countMedia } from "../store";

const CAPS: { name: string; level: string; tone: string }[] = [
  { name: "Photo + video capture, flip, flash, torch, zoom", level: "Possible now", tone: C.go },
  { name: "Resolution / quality / mic — customizable", level: "Possible now", tone: C.go },
  { name: "Grid · level · reticle · self-timer", level: "Possible now", tone: C.go },
  { name: "Interval timelapse (frames)", level: "Possible now", tone: C.go },
  { name: "Colour palette · OCR · scene labeling (on-device)", level: "Possible now", tone: C.go },
  { name: "Layer compositor + photo editor", level: "Possible now", tone: C.go },
  { name: "GPU chroma key (green/blue screen)", level: "Possible now", tone: C.go },
  { name: "Camera2 sensor characteristics (read-only)", level: "Possible now", tone: C.go },
  { name: "Unit converter (length/volume/weight/temp)", level: "Possible now", tone: C.go },
  { name: "Video keyframe overlay — live preview", level: "Possible now", tone: C.go },
  { name: "NeRF Measure (room scan → AR measurement)", level: "Requires cloud compute", tone: C.attach },
  { name: "Manual ISO / shutter / RAW capture", level: "Requires native code", tone: C.native },
  { name: "Input mic-gain / audio DSP", level: "Requires native code", tone: C.native },
  { name: "Screen recording", level: "Requires native code", tone: C.native },
  { name: "IR / thermal / UV", level: "Requires attachment", tone: C.attach },
];

const PRIVACY = [
  "Captures are stored on-device by default — private by default.",
  "“Save to Photos” is an explicit, opt-in action.",
  "No covert recording. No selling camera data.",
  "Trademark & brand under review before launch.",
];

export default function SettingsScreen({ focused }: { focused: boolean }) {
  const { settings, update, reset } = useSettings();
  const [sizes, setSizes] = useState<string[]>([]);
  const [bytes, setBytes] = useState(0);
  const [counts, setCounts] = useState({ photos: 0, videos: 0 });
  const version = Constants.expoConfig?.version ?? "0.1.0";

  const refresh = () => {
    loadPictureSizes().then((s) => setSizes(sortSizes(s)));
    storageBytes().then(setBytes);
    countMedia().then(setCounts);
  };
  useEffect(() => {
    if (focused) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  const confirmClear = () =>
    Alert.alert("Clear in-app media?", "Deletes all photos, videos and timelapse frames stored inside the app. Anything you saved to Photos stays.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete all",
        style: "destructive",
        onPress: async () => {
          await clearAllCaptures();
          refresh();
        },
      },
    ]);

  const confirmReset = () =>
    Alert.alert("Reset settings?", "Restore all preferences to defaults.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: reset },
    ]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 18, paddingBottom: 48 }}>
      <View style={styles.brand}>
        <Mark size={38} />
        <View>
          <Text style={styles.name}>Lensii</Text>
          <Mono color={C.inkMute} size={11}>The Swiss Army knife of camera apps · v{version}</Mono>
        </View>
      </View>

      {/* CAMERA */}
      <Section title="Camera · Photo">
        <Row title="Aspect ratio" hint="Preview & capture ratio.">
          <Segmented options={["4:3", "16:9", "1:1"] as const} value={settings.cameraRatio} onChange={(v) => update({ cameraRatio: v })} />
        </Row>
        <Row title="Picture size" hint={sizes.length ? "Detected on this device." : "Open Capture once to detect sizes."} column>
          <View style={styles.chips}>
            <Chip label="Auto" on={!settings.pictureSize} onPress={() => update({ pictureSize: null })} />
            {sizes.slice(0, 10).map((s) => (
              <Chip key={s} label={s} on={settings.pictureSize === s} onPress={() => update({ pictureSize: s })} />
            ))}
          </View>
        </Row>
        <Row title="JPEG quality" hint={`${Math.round(settings.jpegQuality * 100)}%`}>
          <Slider value={Math.round(settings.jpegQuality * 100)} min={30} max={100} step={5} onChange={(v) => update({ jpegQuality: v / 100 })} width={140} />
        </Row>
      </Section>

      {/* VIDEO */}
      <Section title="Camera · Video">
        <Row title="Resolution" hint="Recording quality.">
          <Segmented options={["2160p", "1080p", "720p", "480p"] as const} value={settings.videoQuality} onChange={(v) => update({ videoQuality: v })} />
        </Row>
        <Row title="Bitrate" hint="0 = automatic (device chooses).">
          <Stepper value={settings.videoBitrateMbps} min={0} max={100} step={2} suffix=" Mbps" onChange={(v) => update({ videoBitrateMbps: v })} />
        </Row>
        <Row title="Max duration" hint="0 = unlimited.">
          <Stepper value={settings.videoMaxSeconds} min={0} max={600} step={15} suffix="s" onChange={(v) => update({ videoMaxSeconds: v })} />
        </Row>
      </Section>

      {/* AUDIO */}
      <Section title="Audio">
        <Row title="Microphone" hint="Record audio with video.">
          <Toggle value={settings.micEnabled} onChange={(v) => update({ micEnabled: v })} />
        </Row>
        <Row title="Mic gain" hint={`${settings.micGain}% · input gain applies with the native audio pipeline (Phase 5)`}>
          <Slider value={settings.micGain} min={0} max={100} step={5} onChange={(v) => update({ micGain: v })} width={130} />
        </Row>
        <Row title="Feedback volume" hint={`${settings.shutterVolume}% · shutter & UI cues`}>
          <Slider value={settings.shutterVolume} min={0} max={100} step={10} onChange={(v) => update({ shutterVolume: v })} width={130} />
        </Row>
      </Section>

      {/* CAPTURE DEFAULTS */}
      <Section title="Capture defaults">
        <Row title="Flash" hint="Photo flash default.">
          <Segmented options={["off", "auto", "on"] as const} value={settings.flashDefault} onChange={(v) => update({ flashDefault: v })} />
        </Row>
        <Row title="Grid">
          <Toggle value={settings.grid} onChange={(v) => update({ grid: v })} />
        </Row>
        <Row title="Grid type">
          <Segmented options={["thirds", "golden", "square"] as const} value={settings.gridType} onChange={(v) => update({ gridType: v })} format={(v) => v[0].toUpperCase() + v.slice(1)} />
        </Row>
        <Row title="Electronic level">
          <Toggle value={settings.level} onChange={(v) => update({ level: v })} />
        </Row>
        <Row title="Center reticle">
          <Toggle value={settings.reticle} onChange={(v) => update({ reticle: v })} />
        </Row>
        <Row title="Self-timer">
          <Segmented options={[0, 3, 10]} value={settings.timerDefault} onChange={(v) => update({ timerDefault: v })} format={(v) => (v === 0 ? "Off" : v + "s")} />
        </Row>
        <Row title="Auto-save to Photos" hint="Also copy every capture to your gallery.">
          <Toggle value={settings.autoSaveToPhotos} onChange={(v) => update({ autoSaveToPhotos: v })} />
        </Row>
        <Row title="Haptics">
          <Toggle value={settings.haptics} onChange={(v) => update({ haptics: v })} />
        </Row>
      </Section>

      {/* TIMELAPSE */}
      <Section title="Timelapse">
        <Row title="Default interval">
          <Stepper value={settings.tlInterval} min={1} max={120} step={1} suffix="s" onChange={(v) => update({ tlInterval: v })} />
        </Row>
        <Row title="Output frame rate" hint="For the finished-length estimate.">
          <Stepper value={settings.tlOutputFps} min={8} max={60} step={2} suffix=" fps" onChange={(v) => update({ tlOutputFps: v })} />
        </Row>
      </Section>

      {/* STORAGE */}
      <Section title="Storage">
        <Row title="In-app media" hint={`${counts.photos} photos · ${counts.videos} videos`}>
          <Mono color={C.inkSoft} size={13}>{humanBytes(bytes)}</Mono>
        </Row>
        <Pressable onPress={confirmClear} style={styles.dangerRow}>
          <Text style={styles.dangerText}>Clear all in-app media</Text>
        </Pressable>
      </Section>

      {/* CAPABILITY MAP */}
      <Section title="Capability map">
        {CAPS.map((c) => (
          <View key={c.name} style={styles.capRow}>
            <View style={[styles.capDot, { backgroundColor: c.tone }]} />
            <Text style={styles.capName}>{c.name}</Text>
            <Text style={[styles.capLevel, { color: c.tone }]}>{c.level}</Text>
          </View>
        ))}
      </Section>

      {/* PRIVACY */}
      <Section title="Privacy & ethics">
        <View style={{ padding: 14, gap: 12 }}>
          {PRIVACY.map((p) => (
            <View key={p} style={styles.pRow}>
              <Text style={styles.pTick}>✓</Text>
              <Text style={styles.pText}>{p}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Pressable onPress={() => Linking.openURL("https://github.com/mechaloctopus/swissarmycam")} style={styles.link}>
        <Text style={styles.linkText}>View the project on GitHub  →</Text>
      </Pressable>
      <Pressable onPress={confirmReset} style={[styles.link, { marginTop: 10 }]}>
        <Text style={[styles.linkText, { color: C.inkMute }]}>Reset all settings to defaults</Text>
      </Pressable>

      <Text style={styles.legal}>
        “The Swiss Army knife of camera apps” is a descriptive phrase only. Lensii is an independent
        product and is not affiliated with Victorinox or any armed forces. Final trademark clearance in progress.
      </Text>
    </ScrollView>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  brand: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 4 },
  name: { color: C.ink, fontFamily: F.sansMed, fontSize: 20, fontWeight: "700", letterSpacing: -0.4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 40, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.bg2 },
  chipOn: { backgroundColor: C.red, borderColor: C.red },
  chipText: { color: C.inkSoft, fontFamily: F.mono, fontSize: 12 },
  dangerRow: { padding: 14, alignItems: "center", borderTopWidth: 1, borderTopColor: C.lineSoft },
  dangerText: { color: C.red, fontFamily: F.sansMed, fontWeight: "600", fontSize: 14 },
  capRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  capDot: { width: 8, height: 8, borderRadius: 4 },
  capName: { color: C.inkSoft, fontSize: 13, flex: 1 },
  capLevel: { fontFamily: F.mono, fontSize: 9.5, letterSpacing: 0.3, textTransform: "uppercase" },
  pRow: { flexDirection: "row", gap: 12 },
  pTick: { color: C.red, fontSize: 13 },
  pText: { color: C.inkMute, fontSize: 13.5, flex: 1, lineHeight: 20 },
  link: { marginTop: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 10, padding: 16, alignItems: "center" },
  linkText: { color: C.ink, fontFamily: F.sansMed, fontWeight: "600", fontSize: 14 },
  legal: { color: C.inkFaint, fontSize: 11, lineHeight: 17, marginTop: 22, paddingHorizontal: 4 },
});
