import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Easing, Dimensions } from "react-native";
import { C, F } from "../theme";
import { Mono } from "./ui";
import { useTour } from "../tour";

const DIM = "rgba(6,7,8,0.86)";
const PAD = 8;
const ARROW = 9;

/**
 * The guided tour layer: a spotlight cut around the live element, an arrowed
 * bubble beside it, and a progress rail.
 *
 * The cutout is four dim panels framing the target rather than a mask or an
 * SVG clip path. That renders identically on every GPU, needs no compositing
 * tricks, and leaves the real element genuinely visible and untouched
 * underneath — the tour points at the actual running UI, not a picture of it.
 */
export function TourOverlay() {
  const { active, step, steps, rect, next, back, stop } = useTour();
  const enter = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, step, enter]);

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  if (!active) return null;

  const s = steps[step];
  const { width: winW, height: winH } = Dimensions.get("window");
  const last = step === steps.length - 1;

  // Spotlight geometry, padded so the ring doesn't clip the element.
  const hole = rect
    ? { x: rect.x - PAD, y: rect.y - PAD, w: rect.width + PAD * 2, h: rect.height + PAD * 2 }
    : null;

  // Put the bubble on whichever side of the target has room; with no target at
  // all, centre it.
  const above = hole ? hole.y > winH * 0.45 : false;
  const bubbleTop = hole ? (above ? undefined : hole.y + hole.h + ARROW + 6) : undefined;
  const bubbleBottom = hole && above ? winH - hole.y + ARROW + 6 : undefined;

  const arrowLeft = hole
    ? Math.min(Math.max(hole.x + hole.w / 2 - ARROW, 26), winW - 52)
    : 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {hole ? (
        <>
          <Pressable style={[styles.dim, { top: 0, left: 0, right: 0, height: Math.max(0, hole.y) }]} onPress={next} />
          <Pressable style={[styles.dim, { top: hole.y + hole.h, left: 0, right: 0, bottom: 0 }]} onPress={next} />
          <Pressable style={[styles.dim, { top: hole.y, left: 0, width: Math.max(0, hole.x), height: hole.h }]} onPress={next} />
          <Pressable
            style={[styles.dim, { top: hole.y, left: hole.x + hole.w, right: 0, height: hole.h }]}
            onPress={next}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                top: hole.y,
                left: hole.x,
                width: hole.w,
                height: hole.h,
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0.4] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
              },
            ]}
          />
        </>
      ) : (
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} onPress={next} />
      )}

      <Animated.View
        style={[
          styles.bubble,
          hole
            ? { top: bubbleTop, bottom: bubbleBottom, left: 16, right: 16 }
            : { top: winH * 0.3, left: 22, right: 22 },
          {
            opacity: enter,
            transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [above ? 10 : -10, 0] }) }],
          },
        ]}
      >
        {hole && (
          <View
            style={[
              styles.arrow,
              above
                ? { bottom: -ARROW, left: arrowLeft, borderTopWidth: 0, borderLeftWidth: 0 }
                : { top: -ARROW, left: arrowLeft, borderBottomWidth: 0, borderRightWidth: 0 },
            ]}
          />
        )}

        <View style={styles.head}>
          <Mono color={C.red} size={10}>
            {String(step + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
          </Mono>
          <Pressable onPress={stop} hitSlop={10}>
            <Mono color={C.inkMute} size={11}>Skip</Mono>
          </Pressable>
        </View>

        <Text style={styles.title}>{s.title}</Text>
        <Text style={styles.body}>{s.body}</Text>

        <View style={styles.rail}>
          {steps.map((_, i) => (
            <View key={i} style={[styles.pip, i === step && styles.pipOn, i < step && styles.pipDone]} />
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable onPress={back} disabled={step === 0} style={[styles.ghost, step === 0 && { opacity: 0.35 }]}>
            <Text style={styles.ghostText}>Back</Text>
          </Pressable>
          <Pressable onPress={last ? stop : next} style={styles.cta}>
            <Text style={styles.ctaText}>{last ? "Start shooting" : "Next"}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { position: "absolute", backgroundColor: DIM },
  ring: {
    position: "absolute",
    borderWidth: 2,
    borderColor: C.red,
    borderRadius: 14,
  },
  bubble: {
    position: "absolute",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderRadius: 14,
    padding: 16,
  },
  arrow: {
    position: "absolute",
    width: ARROW * 2,
    height: ARROW * 2,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.lineStrong,
    transform: [{ rotate: "45deg" }],
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: C.ink, fontFamily: F.sansMed, fontSize: 19, fontWeight: "700", letterSpacing: -0.3, marginTop: 10 },
  body: { color: C.inkSoft, fontSize: 13.5, lineHeight: 20, marginTop: 8 },
  rail: { flexDirection: "row", gap: 4, marginTop: 16 },
  pip: { flex: 1, height: 2, borderRadius: 1, backgroundColor: C.lineStrong },
  pipDone: { backgroundColor: C.inkMute },
  pipOn: { backgroundColor: C.red },
  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  ghost: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: C.bg2,
  },
  ghostText: { color: C.inkSoft, fontFamily: F.sansMed, fontWeight: "600", fontSize: 13.5 },
  cta: { flex: 1, backgroundColor: C.red, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  ctaText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 13.5 },
});
