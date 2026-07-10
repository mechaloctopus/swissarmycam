import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { Accelerometer } from "expo-sensors";
import { C, F } from "../theme";

/** Rule-of-thirds grid. */
export function GridOverlay() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {[1, 2].map((i) => (
        <View key={"v" + i} style={[styles.line, { left: `${(i * 100) / 3}%`, width: StyleSheet.hairlineWidth, top: 0, bottom: 0 }]} />
      ))}
      {[1, 2].map((i) => (
        <View key={"h" + i} style={[styles.line, { top: `${(i * 100) / 3}%`, height: StyleSheet.hairlineWidth, left: 0, right: 0 }]} />
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
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Accelerometer.setUpdateInterval(80);
    const sub = Accelerometer.addListener(({ x, y }) => {
      const deg = Math.atan2(x, y) * (180 / Math.PI);
      // portrait: 0deg upright. Normalize to -90..90 tilt.
      let r = deg - 180;
      if (r < -180) r += 360;
      r = Math.max(-45, Math.min(45, r));
      setRoll(r);
      Animated.timing(anim, { toValue: r, duration: 80, easing: Easing.linear, useNativeDriver: true }).start();
    });
    return () => sub.remove();
  }, [anim]);

  const level = Math.abs(roll) < 1.2;
  const rotate = anim.interpolate({ inputRange: [-45, 45], outputRange: ["-45deg", "45deg"] });

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
