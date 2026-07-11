import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { Accelerometer } from "expo-sensors";
import { C, F } from "../theme";

export type GridKind = "thirds" | "golden" | "square";

/** Composition grid — thirds, golden ratio, or a centered square. */
export function GridOverlay({ kind = "thirds" }: { kind?: GridKind }) {
  if (kind === "square") {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
        <View style={{ width: "100%", aspectRatio: 1, borderColor: "rgba(255,255,255,0.28)", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth }} />
      </View>
    );
  }
  // thirds = 33.33/66.66 ; golden ≈ 38.2/61.8
  const stops = kind === "golden" ? [38.2, 61.8] : [33.333, 66.666];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {stops.map((p, i) => (
        <View key={"v" + i} style={[styles.line, { left: `${p}%`, width: StyleSheet.hairlineWidth, top: 0, bottom: 0 }]} />
      ))}
      {stops.map((p, i) => (
        <View key={"h" + i} style={[styles.line, { top: `${p}%`, height: StyleSheet.hairlineWidth, left: 0, right: 0 }]} />
      ))}
    </View>
  );
}

/** Center crosshair reticle with corner registration ticks. */
export function Reticle() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <View style={styles.reticleRing} />
      <View style={[styles.cross, { width: 26, height: 1 }]} />
      <View style={[styles.cross, { width: 1, height: 26 }]} />
    </View>
  );
}

/**
 * Electronic level. Reads the accelerometer, shows roll in degrees and a line
 * that snaps green near level. A genuine sensor readout — nothing faked.
 */
export function LevelIndicator() {
  const [roll, setRoll] = useState(0);
  const rollRef = useRef(0);
  const started = useRef(false);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Accelerometer.setUpdateInterval(50);
    const sub = Accelerometer.addListener(({ x, y }) => {
      // Roll of the horizon line. A level line is symmetric mod 180°, so fold
      // to ±90 with 0 at upright — correct whichever way up the phone is.
      let a = Math.atan2(x, y) * (180 / Math.PI);
      if (a > 90) a -= 180;
      else if (a < -90) a += 180;
      // Low-pass filter to remove sensor jitter.
      const prev = started.current ? rollRef.current : a;
      const s = prev * 0.82 + a * 0.18;
      started.current = true;
      rollRef.current = s;
      setRoll(s);
      Animated.timing(anim, { toValue: s, duration: 50, easing: Easing.linear, useNativeDriver: true }).start();
    });
    return () => sub.remove();
  }, [anim]);

  const level = Math.abs(roll) < 0.9;
  const rotate = anim.interpolate({ inputRange: [-90, 90], outputRange: ["-90deg", "90deg"], extrapolate: "clamp" });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Animated.View style={[styles.levelBar, { transform: [{ rotate }], backgroundColor: level ? C.go : C.overlay }]} />
      <Text style={[styles.levelDeg, { color: level ? C.go : C.inkMute, top: "58%" }]}>{roll.toFixed(0)}°</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { position: "absolute", backgroundColor: "rgba(255,255,255,0.28)" },
  reticleRing: { position: "absolute", width: 60, height: 60, borderRadius: 30, borderWidth: 1, borderColor: "rgba(255,255,255,0.28)" },
  cross: { position: "absolute", backgroundColor: "rgba(255,255,255,0.55)" },
  levelBar: { width: 120, height: 2, borderRadius: 2 },
  levelDeg: { position: "absolute", fontFamily: F.mono, fontSize: 11, letterSpacing: 0.5 },
});
