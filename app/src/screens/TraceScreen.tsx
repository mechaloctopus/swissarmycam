import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, PanResponder, LayoutChangeEvent, ActivityIndicator } from "react-native";
import { C, F } from "../theme";
import { Label, Mono } from "../components/ui";
import { Slider, Toggle, Row } from "../components/controls";
import { pickImageFromLibrary } from "../media";
import { ArTraceView, isArTraceAvailable, checkArAvailability, requestArInstall, ArAvailability, ArTrackingState } from "ar-trace";

const PAN_METERS_PER_PX = 0.0018;

/**
 * Surface-locked AR trace/mural: tap a real-world surface to drop an ARCore
 * anchor, import a reference image, and it renders projected onto that
 * surface — locked by ARCore's own SLAM tracking, not by app-side math, so
 * it doesn't drift as you move the phone. Camera zoom only magnifies the
 * rendered pixels for detail work; it never touches the anchor.
 */
export default function TraceScreen({ focused }: { focused: boolean }) {
  const available = isArTraceAvailable();
  const [availability, setAvailability] = useState<ArAvailability | null>(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(85);
  const [scale, setScale] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [locked, setLocked] = useState(false);

  const [anchorPlaced, setAnchorPlaced] = useState(false);
  const [placeAt, setPlaceAt] = useState({ x: 0.5, y: 0.5 });
  const [placeTrigger, setPlaceTrigger] = useState(0);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [trackingState, setTrackingState] = useState<ArTrackingState | null>(null);
  const [arError, setArError] = useState<string | null>(null);

  const viewSize = useRef({ width: 0, height: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;
    if (!available) {
      setChecking(false);
      return;
    }
    (async () => {
      const a = await checkArAvailability();
      if (!cancelled) {
        setAvailability(a);
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [available]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    viewSize.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
  }, []);

  // Recreated each render (cheap) so its callbacks always see current state —
  // avoids the stale-closure trap of memoizing PanResponder.create via useRef.
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      offsetStart.current = { x: offsetX, y: offsetY };
    },
    onPanResponderMove: (_e, g) => {
      if (locked || !anchorPlaced) return;
      setOffsetX(offsetStart.current.x + g.dx * PAN_METERS_PER_PX);
      setOffsetY(offsetStart.current.y - g.dy * PAN_METERS_PER_PX);
    },
    onPanResponderRelease: (e, g) => {
      if (locked || anchorPlaced) return;
      if (Math.abs(g.dx) >= 6 || Math.abs(g.dy) >= 6) return;
      const { width, height } = viewSize.current;
      if (width <= 0 || height <= 0) return;
      setArError(null);
      setPlaceAt({ x: e.nativeEvent.locationX / width, y: e.nativeEvent.locationY / height });
      setPlaceTrigger((t) => t + 1);
    },
  }).panHandlers;

  const doReset = () => {
    setAnchorPlaced(false);
    setOffsetX(0);
    setOffsetY(0);
    setScale(100);
    setRotation(0);
    setArError(null);
    setResetTrigger((t) => t + 1);
  };

  const doImport = async () => {
    const uri = await pickImageFromLibrary();
    if (uri) setImageUri(uri);
  };

  const doInstall = async () => {
    setInstalling(true);
    try {
      await requestArInstall();
    } catch {
      // user may have declined, or install is already in progress — re-check below either way
    }
    const a = await checkArAvailability();
    setAvailability(a);
    setInstalling(false);
  };

  if (!available) {
    return (
      <View style={styles.center}>
        <Label>§ Trace · AR mural / trace lock</Label>
        <Text style={styles.title}>AR Trace</Text>
        <Text style={styles.body}>
          This build doesn't have the AR Trace native module linked. It needs an Android build with
          ARCore compiled in — rebuild the app (or grab the latest APK from Releases) to get this tab working.
        </Text>
      </View>
    );
  }

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.red} />
        <Mono color={C.inkMute} size={12} style={{ marginTop: 12 }}>Checking AR support…</Mono>
      </View>
    );
  }

  if (availability && availability !== "SUPPORTED_INSTALLED") {
    const needsInstall = availability === "SUPPORTED_NOT_INSTALLED" || availability === "SUPPORTED_APK_TOO_OLD";
    return (
      <View style={styles.center}>
        <Label>§ Trace · AR mural / trace lock</Label>
        <Text style={styles.title}>AR Trace</Text>
        <Text style={styles.body}>
          {availability === "UNSUPPORTED_DEVICE_NOT_CAPABLE"
            ? "This device isn't on Google's ARCore-certified list — surface-locked tracing needs hardware ARCore supports."
            : needsInstall
              ? "This feature needs Google Play Services for AR, which isn't installed (or is out of date) on this device."
              : "Couldn't determine AR support on this device."}
        </Text>
        {needsInstall && (
          <Pressable onPress={doInstall} disabled={installing} style={[styles.newBtn, installing && { opacity: 0.6 }]}>
            {installing ? <ActivityIndicator color="#fff" /> : <Text style={styles.newBtnText}>Install Google Play Services for AR →</Text>}
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.viewport} onLayout={onLayout} {...pan}>
        {focused && (
          <ArTraceView
            style={StyleSheet.absoluteFill}
            imageUri={imageUri}
            overlayOpacity={opacity / 100}
            overlayScale={scale / 100}
            overlayRotation={rotation}
            overlayOffsetX={offsetX}
            overlayOffsetY={offsetY}
            cameraZoom={zoom / 100}
            placeAnchorX={placeAt.x}
            placeAnchorY={placeAt.y}
            placeAnchorTrigger={placeTrigger}
            resetTrigger={resetTrigger}
            paused={!focused}
            onTrackingStateChange={(e) => setTrackingState(e.nativeEvent.state)}
            onAnchorPlaced={(e) => {
              setAnchorPlaced(e.nativeEvent.success);
              if (!e.nativeEvent.success) setArError("Couldn't lock onto a surface there — try a well-lit, textured spot, closer up.");
            }}
            onArError={(e) => setArError(e.nativeEvent.message)}
          />
        )}

        <View style={styles.hud}>
          <View style={styles.recPill}>
            <Mono color={trackingState === "TRACKING" ? C.go : C.inkMute} size={11}>{trackingState ?? "STARTING"}</Mono>
          </View>
          <View style={styles.recPill}>
            <Mono color={anchorPlaced ? C.go : C.inkMute} size={11}>
              {anchorPlaced ? (locked ? "LOCKED" : "SURFACE LOCKED") : "TAP TO LOCK SURFACE"}
            </Mono>
          </View>
        </View>

        {!imageUri && (
          <View pointerEvents="none" style={styles.hint}>
            <Mono color={C.inkSoft} size={12}>Import a reference image below, then tap a surface to lock onto it</Mono>
          </View>
        )}
      </View>

      <View style={styles.panel}>
        <View style={styles.row}>
          <Pressable onPress={doImport} style={styles.smallBtn}>
            <Mono color="#fff" size={11}>{imageUri ? "Change image" : "Import image"}</Mono>
          </Pressable>
          <Pressable onPress={doReset} disabled={!anchorPlaced} style={[styles.smallBtn, styles.smallBtnGhost, !anchorPlaced && { opacity: 0.5 }]}>
            <Mono color={C.inkSoft} size={11}>Reset lock</Mono>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Mono color={C.inkMute} size={11} style={{ marginRight: 8 }}>Lock adjust</Mono>
          <Toggle value={locked} onChange={setLocked} />
        </View>

        <Row title="Opacity">
          <Slider value={opacity} min={10} max={100} step={5} onChange={setOpacity} width={150} />
        </Row>
        <Row title="Size">
          <Slider value={scale} min={30} max={400} step={5} onChange={setScale} width={150} />
        </Row>
        <Row title="Rotation">
          <Slider value={rotation} min={-180} max={180} step={5} onChange={setRotation} width={150} />
        </Row>
        <Row title="Camera zoom">
          <Slider value={zoom} min={100} max={400} step={10} onChange={setZoom} width={150} />
        </Row>

        <Text style={styles.footnote}>
          Zoom magnifies the view for detail work — it never moves or resizes the lock itself. Drag
          on the viewfinder to nudge the image within the locked surface. The lock comes from
          ARCore's own tracking, not this screen — hold steady over a textured, well-lit surface
          for the best result; this is real device-tracked AR and hasn't been verified beyond
          compiling (see Settings → Capability map).
        </Text>

        {arError && (
          <View style={styles.errBox}>
            <Mono color={C.red} size={11}>{arError}</Mono>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: C.bg },
  title: { color: C.ink, fontFamily: F.sansMed, fontSize: 24, fontWeight: "700", marginTop: 10, textAlign: "center" },
  body: { color: C.inkSoft, fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: "center" },
  newBtn: { marginTop: 22, backgroundColor: C.red, borderRadius: 8, paddingVertical: 15, paddingHorizontal: 18, alignItems: "center" },
  newBtnText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 14 },
  viewport: { flex: 1, backgroundColor: "#000" },
  hud: { position: "absolute", top: 12, left: 14, right: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  recPill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(0,0,0,0.55)", borderWidth: 1, borderColor: C.line, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 40 },
  hint: { position: "absolute", left: 20, right: 20, bottom: 20, alignItems: "center", backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 8, padding: 12 },
  panel: { padding: 16, backgroundColor: C.bg2, borderTopWidth: 1, borderTopColor: C.line, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  smallBtn: { backgroundColor: C.red, borderRadius: 40, paddingHorizontal: 12, paddingVertical: 8 },
  smallBtnGhost: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.lineStrong, marginLeft: 8 },
  footnote: { color: C.inkFaint, fontSize: 11.5, lineHeight: 17, marginTop: 10 },
  errBox: { marginTop: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: C.red, borderRadius: 8, padding: 10 },
});
