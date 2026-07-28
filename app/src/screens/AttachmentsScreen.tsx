import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import * as Device from "expo-device";
import { Accelerometer, Gyroscope, Magnetometer, Barometer } from "expo-sensors";
import { C, F } from "../theme";
import { Label, Mono, StatusPill } from "../components/ui";
import { loadPictureSizes, sortSizes } from "../caps";
import { getLensInfo, LensInfo } from "camera-info";
import { getMicrophones, MicrophoneInfo } from "audio-info";

type Row = { k: string; v: string };

export default function AttachmentsScreen({ focused }: { focused: boolean }) {
  const [device, setDevice] = useState<Row[]>([]);
  const [camera, setCamera] = useState<Row[]>([]);
  const [lenses, setLenses] = useState<LensInfo[]>([]);
  const [mics, setMics] = useState<MicrophoneInfo[]>([]);
  const [sensors, setSensors] = useState<{ name: string; ok: boolean }[]>([]);
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);

    setDevice([
      { k: "Model", v: Device.modelName || "—" },
      { k: "Brand", v: Device.brand || "—" },
      { k: "OS", v: `${Device.osName || ""} ${Device.osVersion || ""}`.trim() || "—" },
      { k: "Device", v: Device.deviceType != null ? DEVICE_TYPE[Device.deviceType] ?? "—" : "—" },
      { k: "Architecture", v: (Device.supportedCpuArchitectures || []).join(", ") || "—" },
      { k: "Total memory", v: Device.totalMemory ? `${(Device.totalMemory / 1024 / 1024 / 1024).toFixed(1)} GB` : "—" },
    ]);

    const sizes = sortSizes(await loadPictureSizes());
    setCamera([
      { k: "Max photo", v: sizes[0] ? sizes[0] + " (" + megapixels(sizes[0]) + ")" : "open Capture to detect" },
      { k: "Detected sizes", v: sizes.length ? String(sizes.length) : "—" },
    ]);

    setLenses(getLensInfo());
    setMics(getMicrophones());

    const checks: [string, () => Promise<boolean>][] = [
      ["Accelerometer", () => Accelerometer.isAvailableAsync()],
      ["Gyroscope", () => Gyroscope.isAvailableAsync()],
      ["Magnetometer", () => Magnetometer.isAvailableAsync()],
      ["Barometer", () => Barometer.isAvailableAsync()],
    ];
    const results = await Promise.all(
      checks.map(async ([name, fn]) => {
        try {
          return { name, ok: await fn() };
        } catch {
          return { name, ok: false };
        }
      })
    );
    setSensors(results);
    setScanning(false);
  }, []);

  useEffect(() => {
    if (focused) scan();
  }, [focused, scan]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Label>§ Attachments · Hardware ecosystem</Label>
      <Text style={styles.title}>Device &amp; module scan</Text>

      <Pressable onPress={scan} disabled={scanning} style={[styles.scanBtn, scanning && { opacity: 0.6 }]}>
        <Text style={styles.scanText}>{scanning ? "Scanning…" : "↻  Re-scan hardware"}</Text>
      </Pressable>

      <Section title="This device">
        {device.map((r) => (
          <KV key={r.k} k={r.k} v={r.v} />
        ))}
      </Section>

      <Section title="Onboard camera">
        {camera.map((r) => (
          <KV key={r.k} k={r.k} v={r.v} />
        ))}
      </Section>

      {lenses.length > 0 && (
        <View style={{ marginTop: 22 }}>
          <Text style={styles.section}>Lens characteristics · Camera2</Text>
          {lenses.map((l) => (
            <View key={l.id} style={[styles.card, { marginBottom: 10 }]}>
              <View style={styles.lensHead}>
                <Mono color={C.ink} size={12}>{l.facing.toUpperCase()} · #{l.id}</Mono>
                <Mono color={C.inkMute} size={10}>{l.hardwareLevel}</Mono>
              </View>
              <KV k="Focal lengths" v={l.focalLengthsMm.length ? l.focalLengthsMm.map((f) => `${f.toFixed(1)}mm`).join(" · ") : "—"} />
              <KV k="Apertures" v={l.apertures.length ? l.apertures.map((a) => `f/${a.toFixed(1)}`).join(" · ") : "—"} />
              <KV k="ISO range" v={l.isoRange ? `${l.isoRange[0]}–${l.isoRange[1]}` : "—"} />
              <KV k="Exposure range" v={l.exposureTimeRangeNs ? `${nsToShutter(l.exposureTimeRangeNs[0])}–${nsToShutter(l.exposureTimeRangeNs[1])}` : "—"} />
              <KV k="Sensor size" v={l.physicalSizeMm ? `${l.physicalSizeMm.width.toFixed(1)} × ${l.physicalSizeMm.height.toFixed(1)}mm` : "—"} />
              <KV k="Flash" v={l.hasFlash ? "Yes" : "No"} />
            </View>
          ))}
          <Mono color={C.inkMute} size={10} style={{ paddingHorizontal: 2, marginTop: 2 }}>
            Real Camera2 hardware data — read-only for now. Live manual capture using these ranges is Phase 3.
          </Mono>
        </View>
      )}

      {mics.length > 0 && (
        <View style={{ marginTop: 22 }}>
          <Text style={styles.section}>Microphone hardware · AudioManager</Text>
          {mics.map((m) => (
            <View key={m.id} style={[styles.card, { marginBottom: 10 }]}>
              <View style={styles.lensHead}>
                <Mono color={C.ink} size={12}>{m.type.toUpperCase()} · #{m.id}</Mono>
                <Mono color={C.inkMute} size={10}>{m.directionality}</Mono>
              </View>
              <KV k="Location" v={m.location} />
              <KV k="Group" v={m.group >= 0 ? `${m.group} (index ${m.indexInGroup})` : "—"} />
              <KV k="Position" v={m.position ? `x ${m.position.x.toFixed(2)}, y ${m.position.y.toFixed(2)}, z ${m.position.z.toFixed(2)} m` : "not reported"} />
            </View>
          ))}
          <Mono color={C.inkMute} size={10} style={{ paddingHorizontal: 2, marginTop: 2 }}>
            Real AudioManager hardware data. Most phones report one entry here even with multiple
            physical mics — Android's audio HAL handles multi-mic beamforming internally and
            doesn't expose individual mics to apps unless the device specifically does; this shows
            exactly what your device reports, nothing fabricated.
          </Mono>
        </View>
      )}

      <Section title="Onboard sensors">
        {sensors.map((s) => (
          <View key={s.name} style={styles.sensorRow}>
            <View style={[styles.led, { backgroundColor: s.ok ? C.go : C.lineStrong }]} />
            <Text style={styles.kvK}>{s.name}</Text>
            <Text style={[styles.kvV, { color: s.ok ? C.go : C.inkMute }]}>{s.ok ? "present" : "not found"}</Text>
          </View>
        ))}
      </Section>

      <Section title="External modules">
        <View style={{ padding: 16, alignItems: "center", gap: 12 }}>
          <Text style={{ fontSize: 34, color: C.inkFaint }}>⊕</Text>
          <Text style={styles.none}>No external optics or modules detected</Text>
          <View style={{ marginTop: 4 }}>
            <StatusPill label="Requires attachment" tone={C.attach} />
          </View>
        </View>
      </Section>

      <View style={styles.note}>
        <Mono color={C.attach} size={10}>REQUIRES NATIVE CODE + HARDWARE</Mono>
        <Text style={styles.noteText}>
          USB-C thermal / IR / night-vision modules, UV illuminators, and Bluetooth shutters are
          detected and driven by the native attachment module &amp; developer API — Phase 7. This
          screen reads what the phone can report today; the ecosystem plugs in here.
        </Text>
      </View>
    </ScrollView>
  );
}

const DEVICE_TYPE: Record<number, string> = { 0: "Unknown", 1: "Phone", 2: "Tablet", 3: "Desktop", 4: "TV" };

function megapixels(size: string): string {
  const [w, h] = size.split("x").map((n) => parseInt(n, 10));
  if (!w || !h) return "—";
  return `${((w * h) / 1_000_000).toFixed(1)} MP`;
}

/** Nanoseconds -> a photographer-readable shutter fraction, e.g. 8_333_333ns -> "1/120". */
function nsToShutter(ns: number): string {
  const seconds = ns / 1e9;
  if (seconds >= 1) return `${seconds.toFixed(1)}s`;
  const denom = Math.round(1 / seconds);
  return `1/${denom}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={styles.section}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvK}>{k}</Text>
      <Text style={styles.kvV}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  title: { color: C.ink, fontFamily: F.sansMed, fontSize: 26, fontWeight: "700", letterSpacing: -0.5, marginTop: 10 },
  scanBtn: { marginTop: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  scanText: { color: C.ink, fontFamily: F.sansMed, fontWeight: "600", fontSize: 14 },
  section: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10, paddingHorizontal: 2 },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: "hidden" },
  kv: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.lineSoft, gap: 12 },
  kvK: { color: C.inkMute, fontSize: 13.5, flex: 1 },
  kvV: { color: C.inkSoft, fontFamily: F.mono, fontSize: 12.5, textAlign: "right", flexShrink: 1 },
  lensHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.lineSoft, backgroundColor: C.surface2 },
  sensorRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  led: { width: 9, height: 9, borderRadius: 5 },
  none: { color: C.inkSoft, fontFamily: F.sansMed, fontSize: 15, fontWeight: "600" },
  note: { marginTop: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: C.attach, borderRadius: 8, padding: 16, gap: 8 },
  noteText: { color: C.inkMute, fontSize: 13, lineHeight: 19 },
});
