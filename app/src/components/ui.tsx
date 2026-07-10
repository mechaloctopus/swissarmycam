import React from "react";
import { Text, View, Pressable, StyleSheet, TextProps, ViewStyle, StyleProp } from "react-native";
import { C, F } from "../theme";

/** Uppercase mono eyebrow/label, like the site's section coordinates. */
export function Label({ children, color = C.inkMute, style }: { children: React.ReactNode; color?: string; style?: TextProps["style"] }) {
  return <Text style={[styles.label, { color }, style]}>{children}</Text>;
}

export function Mono({ children, color = C.inkSoft, size = 12, style }: { children: React.ReactNode; color?: string; size?: number; style?: TextProps["style"] }) {
  return <Text style={[{ fontFamily: F.mono, color, fontSize: size, letterSpacing: 0.2 }, style]}>{children}</Text>;
}

export function Title({ children, size = 26 }: { children: React.ReactNode; size?: number }) {
  return <Text style={{ fontFamily: F.sansMed, color: C.ink, fontSize: size, fontWeight: "700", letterSpacing: -0.5 }}>{children}</Text>;
}

/** A capability pill (Possible now / Requires native code / …). */
export function StatusPill({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={[styles.pill, { borderColor: C.line }]}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

/** Round tool button used across capture controls. */
export function ToolButton({
  glyph,
  active,
  onPress,
  size = 48,
  label,
}: {
  glyph: string;
  active?: boolean;
  onPress?: () => void;
  size?: number;
  label?: string;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ alignItems: "center", opacity: pressed ? 0.7 : 1 }]}>
      <View
        style={[
          styles.tool,
          { width: size, height: size, borderRadius: size / 2 },
          active && { backgroundColor: C.red, borderColor: C.red },
        ]}
      >
        <Text style={{ color: active ? "#fff" : C.inkSoft, fontSize: size * 0.4 }}>{glyph}</Text>
      </View>
      {label ? <Text style={styles.toolLabel}>{label}</Text> : null}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Registration-tick corner brackets — the schematic motif from the site. */
export function CornerTicks({ color = C.lineStrong }: { color?: string }) {
  const b: ViewStyle = { position: "absolute", width: 14, height: 14, borderColor: color };
  return (
    <>
      <View style={[b, { top: 0, left: 0, borderTopWidth: 1.5, borderLeftWidth: 1.5 }]} />
      <View style={[b, { top: 0, right: 0, borderTopWidth: 1.5, borderRightWidth: 1.5 }]} />
      <View style={[b, { bottom: 0, left: 0, borderBottomWidth: 1.5, borderLeftWidth: 1.5 }]} />
      <View style={[b, { bottom: 0, right: 0, borderBottomWidth: 1.5, borderRightWidth: 1.5 }]} />
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: F.mono, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  pill: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: 40, paddingHorizontal: 10, paddingVertical: 5, alignSelf: "flex-start" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontFamily: F.mono, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: C.inkSoft },
  tool: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: C.lineStrong },
  toolLabel: { fontFamily: F.mono, fontSize: 9, color: C.inkMute, marginTop: 6, letterSpacing: 0.5, textTransform: "uppercase" },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 18 },
});
