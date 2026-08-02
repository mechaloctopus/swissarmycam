import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, PanResponder, LayoutChangeEvent, ActivityIndicator } from "react-native";
import { C, F } from "../theme";
import { Label, Mono } from "../components/ui";
import { Slider, Toggle, Row, Stepper, Segmented } from "../components/controls";
import { pickImageFromLibrary, shareFile } from "../media";
import {
  ArTraceView, isArTraceAvailable, checkArAvailability, requestArInstall, exportTraceMarker,
  ArAvailability, ArTrackingState, ArLockMode,
} from "ar-trace";

const PAN_METERS_PER_PX = 0.0018;

const LOCK_COPY: Record<ArLockMode, { text: string; good: boolean }> = {
  MARKER: { text: "MARKER LOCK", good: true },
  MARKER_COASTING: { text: "MARKER · COASTING", good: false },
  AUTO: { text: "AUTO LOCK", good: true },
  AUTO_COASTING: { text: "AUTO · COASTING", good: false },
  SURFACE: { text: "SURFACE LOCK", good: true },
  NONE: { text: "NO LOCK", good: false },
};

/**
 * Surface-locked AR trace/mural. Two ways to lock, best-available wins:
 *
 * A printed **marker** taped to the paper or wall is the strong one — ARCore
 * re-detects it as an AugmentedImage every frame it's in view, so the overlay
 * re-localizes against a physical object instead of dead-reckoning, and the
 * marker's known printed width is what makes "200 mm wide" mean 200 real
 * millimetres. Tap-to-place **surface** anchors still work with no marker at
 * all, they just have nothing to correct against once you walk away.
 *
 * Camera zoom only magnifies rendered pixels for detail work; it never
 * touches the anchor.
 */
export default function TraceScreen({ focused }: { focused: boolean }) {
  const available = isArTraceAvailable();
  const [availability, setAvailability] = useState<ArAvailability | null>(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(85);
  const [mode, setMode] = useState<"photo" | "lines">("lines");
  const [detail, setDetail] = useState(18);
  const [widthMm, setWidthMm] = useState(210); // A4 width — a sane default to trace at
  const [markerMm, setMarkerMm] = useState(100);
  // Applying this rebuilds ARCore's image database, so let the stepper settle
  // before handing the value over rather than reconfiguring on every tap.
  const [appliedMarkerMm, setAppliedMarkerMm] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [locked, setLocked] = useState(false);
  const [sharingMarker, setSharingMarker] = useState(false);
  const [lockMode, setLockMode] = useState<ArLockMode>("NONE");

  const [autoTrigger, setAutoTrigger] = useState(0);
  const [autoNote, setAutoNote] = useState<string | null>(null);
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

  useEffect(() => {
    const id = setTimeout(() => setAppliedMarkerMm(markerMm), 500);
    return () => clearTimeout(id);
  }, [markerMm]);

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
    setLockMode("NONE");
    setAutoNote(null);
    setOffsetX(0);
    setOffsetY(0);
    setRotation(0);
    setArError(null);
    setResetTrigger((t) => t + 1);
  };

  const doImport = async () => {
    const uri = await pickImageFromLibrary();
    if (uri) setImageUri(uri);
  };

  const doShareMarker = async () => {
    setSharingMarker(true);
    try {
      const uri = await exportTraceMarker();
      await shareFile(uri);
    } catch (e) {
      setArError(e instanceof Error ? e.message : "Could not export the marker");
    }
    setSharingMarker(false);
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
            lineMode={mode === "lines"}
            lineThreshold={detail / 100}
            overlayWidthMeters={widthMm / 1000}
            markerWidthMeters={appliedMarkerMm / 1000}
            overlayRotation={rotation}
            overlayOffsetX={offsetX}
            overlayOffsetY={offsetY}
            cameraZoom={zoom / 100}
            placeAnchorX={placeAt.x}
            placeAnchorY={placeAt.y}
            placeAnchorTrigger={placeTrigger}
            resetTrigger={resetTrigger}
            autoLockTrigger={autoTrigger}
            onAutoLock={(e) => {
              const { ok, widthMm, reason } = e.nativeEvent;
              setAutoNote(
                ok
                  ? `Auto lock set — captured about ${widthMm} mm of surface.`
                  : `Auto lock failed: ${reason}. Put something with detail in frame, or use the printed marker.`,
              );
              if (ok) setArError(null);
            }}
            paused={!focused}
            onTrackingStateChange={(e) => setTrackingState(e.nativeEvent.state)}
            onLockModeChange={(e) => setLockMode(e.nativeEvent.mode)}
            onAnchorPlaced={(e) => {
              setAnchorPlaced(e.nativeEvent.success);
              if (e.nativeEvent.success) setArError(null);
              else setArError("Couldn't lock onto a surface there — try a well-lit, textured spot, closer up.");
            }}
            onArError={(e) => setArError(e.nativeEvent.message)}
          />
        )}

        <View style={styles.hud}>
          <View style={styles.recPill}>
            <Mono color={trackingState === "TRACKING" ? C.go : C.inkMute} size={11}>{trackingState ?? "STARTING"}</Mono>
          </View>
          <View style={styles.recPill}>
            <Mono color={LOCK_COPY[lockMode].good ? C.go : C.inkMute} size={11}>
              {lockMode === "NONE" ? "SHOW MARKER OR TAP A SURFACE" : LOCK_COPY[lockMode].text}
            </Mono>
          </View>
        </View>

        <View pointerEvents="none" style={styles.autoGuide} />

        {(lockMode === "MARKER_COASTING" || lockMode === "AUTO_COASTING") && (
          <View pointerEvents="none" style={[styles.hint, { bottom: undefined, top: 56 }]}>
            <Mono color={C.inkSoft} size={11}>
              Lock target out of frame — riding ARCore's world map. Bring it back into view to re-lock.
            </Mono>
          </View>
        )}

        {!imageUri && (
          <View pointerEvents="none" style={styles.hint}>
            <Mono color={C.inkSoft} size={12}>Import a reference image below, then show the marker or tap a surface</Mono>
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

        <Row title="Show" hint="Lines extracts the edges — a full-tone photo hides your own pencil line under it.">
          <Segmented
            options={["lines", "photo"] as const}
            value={mode}
            onChange={setMode}
            format={(v) => (v === "lines" ? "Lines" : "Photo")}
          />
        </Row>
        {mode === "lines" && (
          <Row title="Line detail" hint="Lower picks up softer edges; higher keeps only the strong ones.">
            <Slider value={detail} min={4} max={60} step={2} onChange={setDetail} width={150} />
          </Row>
        )}
        <Row title="Opacity">
          <Slider value={opacity} min={10} max={100} step={5} onChange={setOpacity} width={150} />
        </Row>
        <Row title="Width" hint={`${widthMm} mm across — real millimetres once a marker is locked`}>
          <Slider value={widthMm} min={20} max={2000} step={10} onChange={setWidthMm} width={150} />
        </Row>
        <Row title="Rotation">
          <Slider value={rotation} min={-180} max={180} step={5} onChange={setRotation} width={150} />
        </Row>
        <Row title="Camera zoom">
          <Slider value={zoom} min={100} max={400} step={10} onChange={setZoom} width={150} />
        </Row>

        <View style={styles.markerBox}>
          <Mono color={C.inkSoft} size={11}>Auto lock — no printing</Mono>
          <Text style={styles.footnote}>
            Point at your surface so the square below frames it, hold the phone roughly square-on,
            and tap. Lensii grabs whatever texture is already there — desk grain, existing pencil
            lines, a coin you drop on the page — and tracks that, working out its real size from
            how far away it is. A completely blank sheet has nothing to lock onto; that's a limit
            of the physics, not a setting, so give it something to see.
          </Text>
          <View style={styles.row}>
            <Pressable onPress={() => { setAutoNote(null); setAutoTrigger((t) => t + 1); }} style={styles.smallBtn}>
              <Mono color="#fff" size={11}>◎ Auto lock this surface</Mono>
            </Pressable>
          </View>
          {autoNote && (
            <Mono color={autoNote.startsWith("Auto lock set") ? C.go : C.red} size={11} style={{ marginTop: 8 }}>
              {autoNote}
            </Mono>
          )}
        </View>

        <View style={styles.markerBox}>
          <Mono color={C.inkSoft} size={11}>Marker lock — the most accurate way</Mono>
          <Text style={styles.footnote}>
            Print the marker, tape it to your paper or wall, and keep it in shot. The camera
            re-finds it every frame, so the image stays planted instead of slowly sliding, and its
            printed width is what makes the size below real. Print at 100% scale, then measure the
            square you actually got and enter it here — that measurement is the scale reference.
          </Text>
          <View style={styles.row}>
            <Pressable onPress={doShareMarker} disabled={sharingMarker} style={[styles.smallBtn, sharingMarker && { opacity: 0.6 }]}>
              <Mono color="#fff" size={11}>{sharingMarker ? "Exporting…" : "Print / share marker"}</Mono>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Mono color={C.inkMute} size={11} style={{ marginRight: 8 }}>Printed size</Mono>
            <Stepper value={markerMm} min={20} max={400} step={5} suffix=" mm" onChange={setMarkerMm} />
          </View>
        </View>

        <Text style={styles.footnote}>
          Zoom magnifies the view for detail work — it never moves or resizes the lock itself. Drag
          on the viewfinder to nudge the image within the lock. Both lock modes are ARCore's own
          tracking, not app-side math: a marker lock re-localizes against a real object every frame,
          a surface lock has nothing to correct against once the spot leaves view. This is real
          device-tracked AR and hasn't been verified beyond compiling (see Settings → Capability map).
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
  autoGuide: {
    position: "absolute",
    alignSelf: "center",
    top: "50%",
    width: "70%",
    aspectRatio: 1,
    marginTop: "-35%",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 6,
  },
  markerBox: { marginTop: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12 },
  errBox: { marginTop: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: C.red, borderRadius: 8, padding: 10 },
});
