import React, { useMemo, useRef } from "react";
import { View, Text, StyleSheet, PanResponder, Pressable, ScrollView } from "react-native";
import { C, F } from "../theme";
import { Layer, AudioTrack, snapTime } from "../timeline";

const RULER_H = 22;
const LANE_H = 34;
const LANE_GAP = 6;
const HANDLE_W = 14;

export type TimelineProps = {
  duration: number;
  currentTime: number;
  layers: Layer[];
  /** Imported audio tracks, drawn as their own lanes below the layer lanes. */
  audios?: AudioTrack[];
  selectedAudioId?: string | null;
  onSelectAudio?: (id: string) => void;
  selectedId: string | null;
  /** Pixels per second. */
  pps: number;
  onSeek: (t: number) => void;
  onSelect: (id: string) => void;
  onTrimLayer: (id: string, tIn: number, tOut: number) => void;
  onMoveKeyframe: (id: string, from: number, to: number) => void;
  onTapKeyframe: (t: number) => void;
  /** Fires once at the start of any lane/keyframe drag — for undo snapshots. */
  onGestureStart?: () => void;
  /** Times worth snapping to (playhead, cuts). Whole seconds are added automatically. */
  snapTargets?: number[];
  /** Fires when a drag snaps onto a target — for haptic feedback. */
  onSnap?: () => void;
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
  audios = [],
  selectedAudioId = null,
  onSelectAudio,
  onSeek,
  onSelect,
  onTrimLayer,
  onMoveKeyframe,
  onTapKeyframe,
  onGestureStart,
  snapTargets,
  onSnap,
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

  // The responder below is created once, so it must not close over pps,
  // duration or onSeek directly — it would pin them to their first-render
  // values (duration starts at 0.1), which is why scrubbing landed nowhere.
  const live = useRef({ pps, safeDuration, onSeek });
  live.current = { pps, safeDuration, onSeek };

  const emitSeek = (pageX: number) => {
    const { pps: p, safeDuration: d, onSeek: seek } = live.current;
    // measureInWindow may not have landed yet, and pps can arrive as 0 on the
    // very first layout pass — both produce NaN/Infinity here, which is fatal
    // once it reaches the native player.
    if (!Number.isFinite(pageX) || !Number.isFinite(p) || p <= 0) return;
    const t = (pageX - scrubGeo.current.x) / p;
    if (!Number.isFinite(t)) return;
    seek(Math.max(0, Math.min(d, t)));
  };

  const scrub = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // The ruler owns its drags; the ScrollView keeps everything else, so you
      // can still fling the timeline sideways by dragging the lane area.
      onPanResponderTerminationRequest: () => false,
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
                onGestureStart={onGestureStart}
                snapTargets={snapTargets}
                onSnap={onSnap}
              />
            ))
          )}

          {/* AUDIO LANES — a track's real extent on the timeline, so "multi-track"
              is something you can see rather than only configure. Fade ramps are
              drawn to scale at each end. */}
          {audios.map((a) => {
            const span = Math.max(0.05, a.trimOut - a.trimIn);
            const on = a.id === selectedAudioId;
            return (
              <Pressable
                key={a.id}
                onPress={() => onSelectAudio?.(a.id)}
                style={[
                  styles.audioLane,
                  on && styles.audioLaneOn,
                  { left: a.tIn * pps, width: Math.max(span * pps, 12) },
                ]}
              >
                {a.fadeIn > 0 && <View style={[styles.fadeWedge, { left: 0, width: Math.min(a.fadeIn, span) * pps }]} />}
                {a.fadeOut > 0 && <View style={[styles.fadeWedge, { right: 0, width: Math.min(a.fadeOut, span) * pps }]} />}
                <Text numberOfLines={1} style={styles.audioLaneText}>♪ {a.name}</Text>
              </Pressable>
            );
          })}

          {/* PLAYHEAD — drawn over everything, ignores touches so lanes stay usable */}
          <View
            pointerEvents="none"
            style={[
              styles.playhead,
              {
                left: currentTime * pps,
                height: RULER_H + (Math.max(layers.length, 1) + audios.length) * (LANE_H + LANE_GAP),
              },
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
  onGestureStart,
  snapTargets,
  onSnap,
}: {
  layer: Layer;
  pps: number;
  duration: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onTrim: (id: string, tIn: number, tOut: number) => void;
  onMoveKeyframe: (id: string, from: number, to: number) => void;
  onTapKeyframe: (t: number) => void;
  onGestureStart?: () => void;
  snapTargets?: number[];
  onSnap?: () => void;
}) {
  const left = layer.tIn * pps;
  const width = Math.max((layer.tOut - layer.tIn) * pps, HANDLE_W * 2 + 6);

  const startRef = useRef({ tIn: layer.tIn, tOut: layer.tOut });
  const wasSnapped = useRef(false);

  // Same trap as the canvas sprite, and the reason dragging a clip or a
  // keyframe did nothing: these responders were rebuilt on every render, and
  // each drag re-renders, so a fresh PanResponder arrived mid-gesture with a
  // fresh gestureState and g.dx snapped back to ~0. They are created once now
  // and read everything current through this ref.
  const live = useRef({ layer, pps, duration, onTrim, onMoveKeyframe, onTapKeyframe, onGestureStart, onSelect, snapTargets, onSnap });
  live.current = { layer, pps, duration, onTrim, onMoveKeyframe, onTapKeyframe, onGestureStart, onSelect, snapTargets, onSnap };

  // Snap to the playhead/cuts plus every whole second; ~8px of grab range.
  const applySnap = (t: number): number => {
    const cur = live.current;
    const targets = [...(cur.snapTargets ?? [])];
    for (let sec = 0; sec <= cur.duration + 0.001; sec++) targets.push(sec);
    const r = snapTime(t, targets, 8 / cur.pps);
    if (r.snapped && !wasSnapped.current) cur.onSnap?.();
    wasSnapped.current = r.snapped;
    return r.t;
  };

  const makeTrimResponder = (edge: "in" | "out") =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const cur = live.current;
        cur.onGestureStart?.();
        cur.onSelect(cur.layer.id);
        startRef.current = { tIn: cur.layer.tIn, tOut: cur.layer.tOut };
        wasSnapped.current = false;
      },
      onPanResponderMove: (_e, g) => {
        const cur = live.current;
        const dt = g.dx / cur.pps;
        if (edge === "in") {
          const next = applySnap(Math.max(0, Math.min(startRef.current.tOut - 0.1, startRef.current.tIn + dt)));
          cur.onTrim(cur.layer.id, Math.min(next, startRef.current.tOut - 0.1), startRef.current.tOut);
        } else {
          const next = applySnap(Math.min(cur.duration, Math.max(startRef.current.tIn + 0.1, startRef.current.tOut + dt)));
          cur.onTrim(cur.layer.id, startRef.current.tIn, Math.max(next, startRef.current.tIn + 0.1));
        }
      },
    });

  const trimIn = useRef(makeTrimResponder("in")).current;
  const trimOut = useRef(makeTrimResponder("out")).current;

  const bodyStart = useRef({ tIn: layer.tIn, tOut: layer.tOut });
  const body = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // Only claim once it is clearly a horizontal drag, so a vertical swipe or
      // a sideways fling on the lane still scrolls the timeline.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const cur = live.current;
        cur.onGestureStart?.();
        cur.onSelect(cur.layer.id);
        bodyStart.current = { tIn: cur.layer.tIn, tOut: cur.layer.tOut };
      },
      onPanResponderMove: (_e, g) => {
        const cur = live.current;
        const dt = g.dx / cur.pps;
        const span = bodyStart.current.tOut - bodyStart.current.tIn;
        let nextIn = bodyStart.current.tIn + dt;
        nextIn = Math.max(0, Math.min(cur.duration - span, nextIn));
        cur.onTrim(cur.layer.id, nextIn, nextIn + span);
      },
    })
  ).current;

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
            onDragStart={onGestureStart}
            onDragEnd={(to) => onMoveKeyframe(layer.id, k.t, applySnap(to))}
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
  onDragStart,
  onDragEnd,
}: {
  t: number;
  leftPx: number;
  pps: number;
  onTap: () => void;
  onDragStart?: () => void;
  onDragEnd: (to: number) => void;
}) {
  const moved = useRef(false);
  // Built once for the same reason as the lane and the sprite — dragging a dot
  // retimes a keyframe, which re-renders, which would otherwise hand the
  // gesture a brand-new PanResponder with dx back at zero.
  const live = useRef({ t, pps, onTap, onDragStart, onDragEnd });
  live.current = { t, pps, onTap, onDragStart, onDragEnd };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Only claim the gesture once it's clearly a horizontal drag, so a plain
      // tap still reaches onTap and a vertical scroll still reaches the list.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        moved.current = false;
      },
      onPanResponderMove: () => {
        if (!moved.current) live.current.onDragStart?.();
        moved.current = true;
      },
      onPanResponderRelease: (_e, g) => {
        const cur = live.current;
        if (moved.current) cur.onDragEnd(Math.max(0, cur.t + g.dx / cur.pps));
        else cur.onTap();
      },
    })
  ).current;

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
  audioLane: {
    height: LANE_H,
    marginBottom: LANE_GAP,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: "rgba(64,150,120,0.22)",
    justifyContent: "center",
    paddingHorizontal: 8,
    overflow: "hidden",
  },
  audioLaneOn: { borderColor: C.go },
  audioLaneText: { color: C.inkSoft, fontFamily: F.mono, fontSize: 10 },
  fadeWedge: { position: "absolute", top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.32)" },
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
