import React, { useRef, useState } from "react";
import { View, Text, Pressable, Switch, StyleSheet, LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import { C, F } from "../theme";
import { useLiveGesture } from "../gestures";

/** A labelled settings row: title + optional hint on the left, control on the right. */
export function Row({ title, hint, children, column }: { title: string; hint?: string; children?: React.ReactNode; column?: boolean }) {
  return (
    <View style={[styles.row, column && { flexDirection: "column", alignItems: "stretch", gap: 12 }]}>
      <View style={{ flex: 1, paddingRight: column ? 0 : 14 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function Section({ title, children, style }: { title: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginTop: 26 }, style]}>
      <Text style={styles.section}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: C.lineStrong, true: C.red }}
      thumbColor={"#fff"}
      ios_backgroundColor={C.lineStrong}
    />
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={String(o)} onPress={() => onChange(o)} style={[styles.segItem, on && styles.segItemOn]}>
            <Text style={[styles.segText, on && { color: "#fff" }]}>{format ? format(o) : String(o)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  suffix = "",
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => set(value - step)} style={styles.stepBtn} hitSlop={8}>
        <Text style={styles.stepSign}>−</Text>
      </Pressable>
      <Text style={styles.stepVal}>{value}{suffix}</Text>
      <Pressable onPress={() => set(value + step)} style={styles.stepBtn} hitSlop={8}>
        <Text style={styles.stepSign}>+</Text>
      </Pressable>
    </View>
  );
}

/**
 * Custom slider — PanResponder-based so it needs no native dependency.
 * Uses absolute window geometry (measureInWindow + gestureState) rather than
 * per-view locationX, so touches over the thumb don't cause coordinate jumps.
 */
export function Slider({
  value,
  onChange,
  onBegin,
  min = 0,
  max = 100,
  step = 1,
  width,
}: {
  value: number;
  onChange: (v: number) => void;
  /** Fires once when a drag starts — lets callers snapshot state for undo. */
  onBegin?: () => void;
  min?: number;
  max?: number;
  step?: number;
  width?: number;
}) {
  const ref = useRef<View>(null);
  const geo = useRef({ x: 0, w: 0 });

  const measure = () => {
    ref.current?.measureInWindow((x, _y, w) => {
      geo.current = { x, w };
    });
  };

  const emit = (
    live: { min: number; max: number; step: number; onChange: (v: number) => void },
    pageX: number
  ) => {
    const { x, w } = geo.current;
    if (w <= 0 || !Number.isFinite(pageX) || live.max <= live.min) return;
    let r = (pageX - x) / w;
    r = Math.max(0, Math.min(1, r));
    let v = live.min + r * (live.max - live.min);
    v = Math.round(v / live.step) * live.step;
    live.onChange(Math.max(live.min, Math.min(live.max, v)));
  };

  const pan = useLiveGesture(
    { min, max, step, onChange, onBegin },
    {
      onStart: (live, _e, g) => {
        live.onBegin?.();
        measure();
        // measureInWindow is async; wait a frame so geo is fresh on first touch.
        requestAnimationFrame(() => emit(live, g.x0));
      },
      onMove: (live, _e, g) => emit(live, g.moveX),
    }
  );

  const onLayout = (_e: LayoutChangeEvent) => measure();
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <View ref={ref} style={[styles.sliderWrap, width ? { width } : null]} onLayout={onLayout} {...pan.panHandlers}>
      <View pointerEvents="none" style={styles.sliderTrack}>
        <View style={[styles.sliderFill, { width: `${pct}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.sliderThumb, { left: `${pct}%`, marginLeft: -11 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  rowTitle: { color: C.ink, fontSize: 14.5, fontWeight: "500", fontFamily: F.sans },
  rowHint: { color: C.inkMute, fontSize: 12, marginTop: 4, lineHeight: 16 },
  section: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10, paddingHorizontal: 2 },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: "hidden" },

  seg: { flexDirection: "row", backgroundColor: C.bg2, borderRadius: 40, padding: 3, borderWidth: 1, borderColor: C.line },
  segItem: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 40 },
  segItemOn: { backgroundColor: C.red },
  segText: { color: C.inkSoft, fontFamily: F.mono, fontSize: 12 },

  stepper: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.bg2, borderRadius: 40, borderWidth: 1, borderColor: C.line, paddingHorizontal: 4 },
  stepBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  stepSign: { color: C.ink, fontSize: 20, lineHeight: 22 },
  stepVal: { color: C.ink, fontFamily: F.mono, fontSize: 14, minWidth: 46, textAlign: "center" },

  sliderWrap: { width: 150, height: 34, justifyContent: "center" },
  sliderTrack: { height: 3, borderRadius: 3, backgroundColor: C.lineStrong, overflow: "hidden" },
  sliderFill: { height: 3, backgroundColor: C.red },
  sliderThumb: { position: "absolute", width: 22, height: 22, borderRadius: 11, backgroundColor: C.red, borderWidth: 3, borderColor: C.bg, top: 6 },
});
