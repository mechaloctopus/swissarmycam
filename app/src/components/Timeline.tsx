import React, { useMemo, useRef } from "react";
import { View, Text, StyleSheet, PanResponder, ScrollView } from "react-native";
import { C, F } from "../theme";
import { Layer } from "../timeline";

const RULER_H = 22;
const LANE_H = 34;
const LANE_GAP = 6;
const HANDLE_W = 14;

export type TimelineProps = {
  duration: number;
  currentTime: number;
  layers: Layer[];
  selectedId: string | null;
  /** Pixels per second. */
  pps: number;
  onSeek: (t: number) => void;
  onSelect: (id: string) => void;
  onTrimLayer: (id: string, tIn: number, tOut: number) => void;
  onMoveKeyframe: (id: string, from: number, to: number) => void;
  onTapKeyframe: (t: number) => void;
};

/**
 * The editor's timeline: a time ruler, a scrubbable playhead, and one lane
 * per layer showing its visibility span with draggable in/out handles and
 * its keyframes as diamonds.
 *
 * Everything is laid out from `pps` (pixels per second) so zooming is just a
 * different pps — no gesture-scale bookkeeping to keep in sync.
 */
export function Timeline({
  duration,
  currentTime,
  layers,
  selectedId,
  pps,
  onSeek,
  onSelect,
  onTrimLayer,
  onMoveKeyframe,
  onTapKeyframe,
}: TimelineProps) {
  const safeDuration = Math.max(duration, 0.1);
  const contentW = Math.max(safeDuration * pps, 1);

  const ticks = useMemo(() => {
    // Aim for a tick roughly every 60px, snapped to a readable interval.
    const raw = 60 / pps;
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60];
    const step = steps.find((s) => s >= raw) ?? 60;
    const out: number[] = [];
    for (let t = 0; t <= safeDuration + 0.001; t += step) out.push(Math.round(t * 100) / 100);
    return out;
  }, [pps, safeDuration]);

  const scrubRef = useRef<View>(null);
  const scrubGeo = useRef({ x: 0 });

  const measureScrub = () => {
    scrubRef.current?.measureInWindow((x) => {
      scrubGeo.current = { x };
    });
  };

  const emitSeek = (pageX: number) => {
    const t = (pageX - scrubGeo.current.x) / pps;
    onSeek(Math.max(0, Math.min(safeDuration, t)));
  };

  const scrub = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        measureScrub();
        // measureInWindow is async — use the touch's own page origin for the
        // very first frame so the playhead doesn't jump on a fast tap.
        requestAnimationFrame(() => emitSeek(e.nativeEvent.pageX));
      },
      onPanResponderMove: (e) => emitSeek(e.nativeEvent.pageX),
    })
  ).current;

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 24 }}>
        <View style={{ width: contentW }}>
          {/* RULER — also the scrub surface */}
          <View ref={scrubRef} onLayout={measureScrub} style={styles.ruler} {...scrub.panHandlers}>
            {ticks.map((t) => (
              <View key={t} style={[styles.tick, { left: t * pps }]}>
                <View style={styles.tickMark} />
                <Text style={styles.tickLabel}>{formatTime(t)}</Text>
              </View>
            ))}
          </View>

          {/* LANES */}
          {layers.length === 0 ? (
            <View style={styles.emptyLane}>
              <Text style={styles.emptyText}>No layers yet — add one below</Text>
            </View>
          ) : (
            layers.map((layer) => (
              <Lane
                key={layer.id}
                layer={layer}
                pps={pps}
                duration={safeDuration}
                selected={layer.id === selectedId}
                onSelect={onSelect}
                onTrim={onTrimLayer}
                onMoveKeyframe={onMoveKeyframe}
                onTapKeyframe={onTapKeyframe}
              />
            ))
          )}

          {/* PLAYHEAD — drawn over everything, ignores touches so lanes stay usable */}
          <View
            pointerEvents="none"
            style={[
              styles.playhead,
              { left: currentTime * pps, height: RULER_H + (Math.max(layers.length, 1) * (LANE_H + LANE_GAP)) },
            ]}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function Lane({
  layer,
  pps,
  duration,
  selected,
  onSelect,
  onTrim,
  onMoveKeyframe,
  onTapKeyframe,
}: {
  layer: Layer;
  pps: number;
  duration: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onTrim: (id: string, tIn: number, tOut: number) => void;
  onMoveKeyframe: (id: string, from: number, to: number) => void;
  onTapKeyframe: (t: number) => void;
}) {
  const left = layer.tIn * pps;
  const width = Math.max((layer.tOut - layer.tIn) * pps, HANDLE_W * 2 + 6);

  const startRef = useRef({ tIn: layer.tIn, tOut: layer.tOut });

  const makeTrimResponder = (edge: "in" | "out") =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        onSelect(layer.id);
        startRef.current = { tIn: layer.tIn, tOut: layer.tOut };
      },
      onPanResponderMove: (_e, g) => {
        const dt = g.dx / pps;
        if (edge === "in") {
          const next = Math.max(0, Math.min(startRef.current.tOut - 0.1, startRef.current.tIn + dt));
          onTrim(layer.id, next, startRef.current.tOut);
        } else {
          const next = Math.min(duration, Math.max(startRef.current.tIn + 0.1, startRef.current.tOut + dt));
          onTrim(layer.id, startRef.current.tIn, next);
        }
      },
    });

  // Recreated per render so the responders always read current tIn/tOut —
  // memoizing these in a ref is the classic stale-closure trap here.
  const trimIn = makeTrimResponder("in");
  const trimOut = makeTrimResponder("out");

  const bodyStart = useRef({ tIn: layer.tIn, tOut: layer.tOut });
  const body = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3,
    onPanResponderGrant: () => {
      onSelect(layer.id);
      bodyStart.current = { tIn: layer.tIn, tOut: layer.tOut };
    },
    onPanResponderMove: (_e, g) => {
      const dt = g.dx / pps;
      const span = bodyStart.current.tOut - bodyStart.current.tIn;
      let nextIn = bodyStart.current.tIn + dt;
      nextIn = Math.max(0, Math.min(duration - span, nextIn));
      onTrim(layer.id, nextIn, nextIn + span);
    },
  });

  return (
    <View style={styles.lane}>
      <View
        style={[styles.laneBar, selected && styles.laneBarOn, { left, width }]}
        {...body.panHandlers}
      >
        <View style={styles.laneLabelWrap} pointerEvents="none">
          <Text style={styles.laneLabel} numberOfLines={1}>
            {layerTitle(layer)}
          </Text>
        </View>

        {/* Keyframe diamonds, positioned relative to the bar */}
        {layer.keyframes.map((k) => (
          <KeyframeDot
            key={`${k.t}`}
            t={k.t}
            leftPx={(k.t - layer.tIn) * pps}
            pps={pps}
            onTap={() => onTapKeyframe(k.t)}
            onDragEnd={(to) => onMoveKeyframe(layer.id, k.t, to)}
          />
        ))}

        <View style={[styles.handle, { left: 0 }]} {...trimIn.panHandlers}>
          <View style={styles.handleGrip} />
        </View>
        <View style={[styles.handle, { right: 0 }]} {...trimOut.panHandlers}>
          <View style={styles.handleGrip} />
        </View>
      </View>
    </View>
  );
}

function KeyframeDot({
  t,
  leftPx,
  pps,
  onTap,
  onDragEnd,
}: {
  t: number;
  leftPx: number;
  pps: number;
  onTap: () => void;
  onDragEnd: (to: number) => void;
}) {
  const moved = useRef(false);
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    // Only claim the gesture once it's clearly a horizontal drag, so a plain
    // tap still reaches onTap and a vertical scroll still reaches the list.
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4,
    onPanResponderGrant: () => {
      moved.current = false;
    },
    onPanResponderMove: () => {
      moved.current = true;
    },
    onPanResponderRelease: (_e, g) => {
      if (moved.current) onDragEnd(Math.max(0, t + g.dx / pps));
      else onTap();
    },
  });

  return (
    <View style={[styles.kfHit, { left: leftPx - 11 }]} {...pan.panHandlers}>
      <View style={styles.kfDot} />
    </View>
  );
}

function layerTitle(l: Layer): string {
  if (l.kind === "text") return l.text || "Text";
  if (l.kind === "video") return "Video" + (l.chroma ? " · keyed" : "");
  if (l.kind === "gif") return "GIF";
  return "Image" + (l.chroma ? " · keyed" : "");
}

function formatTime(t: number): string {
  if (t < 60) return `${t % 1 === 0 ? t.toFixed(0) : t.toFixed(1)}s`;
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: C.bg2, borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 8 },
  ruler: { height: RULER_H, position: "relative", justifyContent: "flex-end" },
  tick: { position: "absolute", bottom: 0, alignItems: "flex-start" },
  tickMark: { width: 1, height: 6, backgroundColor: C.lineStrong },
  tickLabel: { color: C.inkFaint, fontFamily: F.mono, fontSize: 9, marginTop: 1 },
  emptyLane: { height: LANE_H, marginTop: LANE_GAP, justifyContent: "center", paddingLeft: 4 },
  emptyText: { color: C.inkFaint, fontFamily: F.mono, fontSize: 10.5 },
  lane: { height: LANE_H, marginTop: LANE_GAP, position: "relative" },
  laneBar: {
    position: "absolute",
    top: 0,
    height: LANE_H,
    borderRadius: 6,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.lineStrong,
    justifyContent: "center",
    overflow: "hidden",
  },
  laneBarOn: { borderColor: C.red, backgroundColor: "rgba(224,35,28,0.16)" },
  laneLabelWrap: { paddingHorizontal: HANDLE_W + 2 },
  laneLabel: { color: C.inkSoft, fontFamily: F.mono, fontSize: 10 },
  handle: { position: "absolute", top: 0, bottom: 0, width: HANDLE_W, alignItems: "center", justifyContent: "center" },
  handleGrip: { width: 3, height: 16, borderRadius: 2, backgroundColor: C.inkMute },
  kfHit: { position: "absolute", top: 0, bottom: 0, width: 22, alignItems: "center", justifyContent: "center" },
  kfDot: {
    width: 9,
    height: 9,
    backgroundColor: C.redBright,
    borderWidth: 1,
    borderColor: "#fff",
    transform: [{ rotate: "45deg" }],
  },
  playhead: { position: "absolute", top: 0, width: 2, backgroundColor: C.redBright },
});
