import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing, Pressable } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { C, F } from "../theme";
import { IRIS, CROSS } from "./Mark";

const MARK = 132;
const WORD = "LENSII";

/**
 * Cold-start title sequence: the aperture opens.
 *
 * It animates the mark's own IRIS path — the blade linkage — unwinding from
 * closed and scaling out, which is the shutter mechanism actually opening
 * rather than a generic logo zoom. Halo rings chase it outward, the Swiss
 * cross lands with a spring, and the wordmark letters rise in sequence.
 *
 * Everything runs on the native driver (transform + opacity only), so the
 * sequence stays smooth while JS is busy doing first-render work behind it —
 * which is the entire point of showing it during boot. Tap to skip.
 */
export function BootSplash({ onDone }: { onDone: () => void }) {
  const [gone, setGone] = useState(false);

  const iris = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const cross = useRef(new Animated.Value(0)).current;
  const halo1 = useRef(new Animated.Value(0)).current;
  const halo2 = useRef(new Animated.Value(0)).current;
  const letters = useRef(WORD.split("").map(() => new Animated.Value(0))).current;
  const out = useRef(new Animated.Value(1)).current;

  const finish = useRef(() => {});
  finish.current = () => {
    Animated.timing(out, { toValue: 0, duration: 340, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(() => {
        setGone(true);
        onDone();
      });
  };

  useEffect(() => {
    const halo = (v: Animated.Value, delay: number) =>
      Animated.timing(v, { toValue: 1, duration: 1100, delay, easing: Easing.out(Easing.quad), useNativeDriver: true });

    const seq = Animated.sequence([
      Animated.parallel([
        Animated.timing(ring, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(iris, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        halo(halo1, 220),
        halo(halo2, 460),
      ]),
      Animated.spring(cross, { toValue: 1, friction: 4.5, tension: 120, useNativeDriver: true }),
      Animated.stagger(
        46,
        letters.map((l) =>
          Animated.timing(l, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ),
      ),
    ]);

    seq.start();
    const t = setTimeout(() => finish.current(), 2150);
    return () => {
      clearTimeout(t);
      seq.stop();
    };
  }, [iris, ring, cross, halo1, halo2, letters, out]);

  if (gone) return null;

  const haloStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 2.3] }) }],
  });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity: out }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => finish.current()} />

      <View pointerEvents="none" style={styles.stack}>
        <Animated.View style={[styles.layer, haloStyle(halo1)]}>
          <View style={styles.halo} />
        </Animated.View>
        <Animated.View style={[styles.layer, haloStyle(halo2)]}>
          <View style={styles.halo} />
        </Animated.View>

        <Animated.View
          style={[
            styles.layer,
            {
              opacity: ring,
              transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1.35, 1] }) }],
            },
          ]}
        >
          <Svg width={MARK} height={MARK} viewBox="0 0 100 100">
            <Circle cx={50} cy={50} r={45} stroke={C.ink} strokeWidth={3.2} fill="none" />
          </Svg>
        </Animated.View>

        {/* The blades: closed and wound tight, then opening out to rest. */}
        <Animated.View
          style={[
            styles.layer,
            {
              opacity: iris.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.9, 0.85] }),
              transform: [
                { scale: iris.interpolate({ inputRange: [0, 1], outputRange: [0.06, 1] }) },
                { rotate: iris.interpolate({ inputRange: [0, 1], outputRange: ["-72deg", "0deg"] }) },
              ],
            },
          ]}
        >
          <Svg width={MARK} height={MARK} viewBox="0 0 100 100">
            <Path d={IRIS} stroke={C.ink} strokeWidth={2.56} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </Animated.View>

        <Animated.View style={[styles.layer, { opacity: cross, transform: [{ scale: cross }] }]}>
          <Svg width={MARK} height={MARK} viewBox="0 0 100 100">
            <Path d={CROSS} fill={C.red} />
          </Svg>
        </Animated.View>
      </View>

      <View pointerEvents="none" style={styles.word}>
        {WORD.split("").map((ch, i) => (
          <Animated.Text
            key={`${ch}-${i}`}
            style={[
              styles.letter,
              {
                opacity: letters[i],
                transform: [{ translateY: letters[i].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
              },
            ]}
          >
            {ch}
          </Animated.Text>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: C.bg, alignItems: "center", justifyContent: "center", zIndex: 100 },
  stack: { width: MARK, height: MARK, alignItems: "center", justifyContent: "center" },
  layer: { position: "absolute", width: MARK, height: MARK, alignItems: "center", justifyContent: "center" },
  halo: { width: MARK, height: MARK, borderRadius: MARK / 2, borderWidth: 1, borderColor: C.red },
  word: { flexDirection: "row", marginTop: 30 },
  letter: { color: C.ink, fontFamily: F.sansMed, fontSize: 22, fontWeight: "700", letterSpacing: 7 },
});
