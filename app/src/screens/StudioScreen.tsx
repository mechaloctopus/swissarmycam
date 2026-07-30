import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  PanResponder,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEventListener } from "expo";
import { C, F } from "../theme";
import { Label, Mono } from "../components/ui";
import { Slider, Segmented } from "../components/controls";
import { Timeline } from "../components/Timeline";
import { listMedia, newVideoOutputPath } from "../store";
import { pickImageFromLibrary, pickVideoFromLibrary, saveToPhotos } from "../media";
import { useSettings } from "../settings";
import { isVideoExportAvailable, exportTimeline } from "video-exporter";
import {
  Layer,
  Keyframe,
  BaseClip,
  Easing,
  Transition,
  DEFAULT_CHROMA,
  makeKeyframe,
  makeClip,
  transformAt,
  alphaAt,
  isVisibleAt,
  writeTransformAt,
  addKeyframeAt,
  removeKeyframeAt,
  retimeKeyframe,
  clipOutputDuration,
  clipStartTimes,
  totalDuration,
  clipAtTime,
  dipAmountAt,
  serializeLayers,
  serializeClips,
  IMAGE_BOX,
  VIDEO_BOX_W,
  VIDEO_BOX_H,
} from "../timeline";

type PanelTab = "layers" | "animate" | "clip";

let seq = 0;
const nextId = () => `L${++seq}`;

/**
 * Studio — the one editor. Replaces the old split Editor (video keyframes) and
 * Studio (photo compositor) screens with a single keyframe-first video editor:
 * a base clip with trim/speed/pitch, any number of image/GIF/video/text layers
 * each with their own in/out window, fades, chroma key, and keyframed
 * position/scale/rotation/opacity with easing.
 */
export default function StudioScreen({ focused }: { focused: boolean }) {
  const { settings } = useSettings();
  const [videos, setVideos] = useState<string[]>([]);
  const [clips, setClips] = useState<BaseClip[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [canvas, setCanvas] = useState({ w: 0, h: 0 });
  const [tab, setTab] = useState<PanelTab>("layers");
  const [pps, setPps] = useState(60);
  const [textModal, setTextModal] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportAvailable = useMemo(() => isVideoExportAvailable(), []);

  const activeClip: BaseClip | null = clips[activeIndex] ?? null;
  const starts = useMemo(() => clipStartTimes(clips), [clips]);
  const timelineDuration = useMemo(() => totalDuration(clips), [clips]);

  const player = useVideoPlayer(activeClip?.uri ?? "", (p) => {
    // No looping: the sequence advances clip to clip, and the end of the
    // last clip is the end of the timeline.
    p.loop = false;
  });
  const [sourceTime, setSourceTime] = useState(0);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEventListener(player, "timeUpdate", (p) => setSourceTime(p.currentTime));
  useEventListener(player, "statusChange", () => setSourceDuration(player.duration || 0));
  useEventListener(player, "playingChange", (p) => setPlaying(p.isPlaying));

  // Layers are keyed against global timeline (output) time; the player runs in
  // one clip's source time. This is the only place the two are reconciled.
  const timelineTime = activeClip
    ? (starts[activeIndex] ?? 0) + Math.max(0, (sourceTime - activeClip.trimIn) / Math.max(0.01, activeClip.speed))
    : 0;

  const wasPlaying = useRef(false);
  useEffect(() => {
    wasPlaying.current = playing;
  }, [playing]);

  // Declared before seekTimeline because that callback writes to it.
  const pendingSeek = useRef<number | null>(null);

  /** Moves the playhead anywhere on the global timeline, switching clip if needed. */
  const seekTimeline = useCallback(
    (t: number) => {
      const hit = clipAtTime(clips, Math.max(0, t));
      if (!hit) return;
      const srcTarget = hit.clip.trimIn + hit.localT * Math.max(0.01, hit.clip.speed);
      if (hit.index !== activeIndex) {
        setActiveIndex(hit.index);
        // The source swap is async; seek once the new clip is loaded.
        pendingSeek.current = srcTarget;
      } else {
        player.currentTime = srcTarget;
        setSourceTime(srcTarget);
      }
    },
    [clips, activeIndex, player]
  );

  useEffect(() => {
    if (pendingSeek.current == null || !activeClip) return;
    const target = pendingSeek.current;
    pendingSeek.current = null;
    // A frame's grace for the new source to attach before seeking into it.
    const id = setTimeout(() => {
      player.currentTime = target;
      setSourceTime(target);
      if (wasPlaying.current) player.play();
    }, 60);
    return () => clearTimeout(id);
  }, [activeIndex, activeClip, player]);

  // Preview honours the active clip's speed/pitch/mute so what you see bakes.
  useEffect(() => {
    if (!activeClip) return;
    player.playbackRate = activeClip.speed;
    player.preservesPitch = activeClip.preservePitch;
    player.muted = activeClip.muted;
  }, [player, activeClip]);

  // Roll onto the next clip when this one passes its out point.
  useEffect(() => {
    if (!activeClip || activeClip.trimOut <= activeClip.trimIn) return;
    if (sourceTime < activeClip.trimOut) return;
    if (activeIndex < clips.length - 1) {
      const next = clips[activeIndex + 1];
      setActiveIndex(activeIndex + 1);
      pendingSeek.current = next.trimIn;
    } else if (playing) {
      player.pause();
    }
  }, [sourceTime, activeClip, activeIndex, clips, player, playing]);

  // trimOut starts at 0 (unknown) and resolves once the player reports length.
  useEffect(() => {
    if (!activeClip || activeClip.trimOut !== 0 || sourceDuration <= 0) return;
    setClips((cs) => cs.map((c, i) => (i === activeIndex ? { ...c, trimOut: sourceDuration } : c)));
  }, [activeClip, sourceDuration, activeIndex]);

  const loadVideos = useCallback(async () => {
    const m = await listMedia();
    setVideos(m.filter((i) => i.kind === "video").map((i) => i.uri));
  }, []);
  useEffect(() => {
    if (focused) loadVideos();
  }, [focused, loadVideos]);

  useEffect(() => {
    if (!focused && playing) player.pause();
  }, [focused, playing, player]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1800);
  };

  const selected = layers.find((l) => l.id === selectedId) ?? null;

  const patchLayer = useCallback((id: string, fn: (l: Layer) => Layer) => {
    setLayers((ls) => ls.map((l) => (l.id === id ? fn(l) : l)));
  }, []);

  const startWithClip = (uri: string) => {
    const c = makeClip(uri, `C${++seq}`);
    setClips([c]);
    setActiveIndex(0);
    setSelectedClipId(c.id);
    setLayers([]);
    setSelectedId(null);
    setTab("layers");
  };

  const appendClip = async () => {
    setBusy(true);
    try {
      const uri = await pickVideoFromLibrary();
      if (!uri) return flash("Nothing selected");
      const c = makeClip(uri, `C${++seq}`);
      setClips((cs) => [...cs, c]);
      setSelectedClipId(c.id);
      flash("Clip added to the end");
    } finally {
      setBusy(false);
    }
  };

  const patchClip = (id: string, patch: Partial<BaseClip>) =>
    setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeClip = (id: string) => {
    setClips((cs) => {
      const next = cs.filter((c) => c.id !== id);
      setActiveIndex((i) => Math.max(0, Math.min(i, next.length - 1)));
      return next;
    });
    setSelectedClipId(null);
  };

  const moveClip = (index: number, dir: -1 | 1) =>
    setClips((cs) => {
      const j = index + dir;
      if (j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  const addLayer = (partial: Partial<Layer> & { kind: Layer["kind"] }) => {
    const id = nextId();
    const dur = timelineDuration || 5;
    // New layers start at the playhead and run to the end — drag the lane's
    // right handle (or the Out slider) to make it pop back out.
    const tIn = Math.min(timelineTime, Math.max(0, dur - 0.3));
    const layer: Layer = {
      id,
      kind: partial.kind,
      uri: partial.uri,
      text: partial.text,
      color: partial.color ?? "#FFFFFF",
      fontSize: partial.fontSize ?? 28,
      tIn,
      tOut: dur,
      fadeIn: 0,
      fadeOut: 0,
      keyframes: [makeKeyframe(tIn)],
      chroma: partial.chroma ?? null,
    };
    setLayers((ls) => [...ls, layer]);
    setSelectedId(id);
    setTab("animate");
  };

  const importImage = async () => {
    setBusy(true);
    try {
      const uri = await pickImageFromLibrary();
      if (!uri) return flash("Nothing selected");
      addLayer({ kind: /\.gif($|\?)/i.test(uri) ? "gif" : "image", uri });
    } finally {
      setBusy(false);
    }
  };

  const importVideoLayer = async () => {
    setBusy(true);
    try {
      const uri = await pickVideoFromLibrary();
      if (!uri) return flash("Nothing selected");
      addLayer({ kind: "video", uri, chroma: { ...DEFAULT_CHROMA } });
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = () => {
    if (!selected) return;
    setLayers((ls) => ls.filter((l) => l.id !== selected.id));
    setSelectedId(null);
    setTab("layers");
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const id = nextId();
    setLayers((ls) => [...ls, { ...selected, id, keyframes: selected.keyframes.map((k) => ({ ...k })) }]);
    setSelectedId(id);
  };

  const patchPose = (patch: Partial<Keyframe>) => {
    if (!selected) return;
    patchLayer(selected.id, (l) => writeTransformAt(l, timelineTime, patch));
  };

  const runExport = async () => {
    if (clips.length === 0 || !exportAvailable || exporting) return;
    if (layers.length === 0) return flash("Add a layer first");
    if (canvas.w === 0 || canvas.h === 0) return flash("Give the preview a moment to lay out");
    setExporting(true);
    try {
      const { uri, path } = await newVideoOutputPath();
      await exportTimeline(path, serializeLayers(layers), serializeClips(clips), canvas.w, canvas.h);
      flash("Exported to Library");
      if (settings.autoSaveToPhotos) saveToPhotos(uri);
      loadVideos();
    } catch (e) {
      flash(e instanceof Error ? `Export failed: ${e.message}` : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  // ---------------------------------------------------------------- picker --
  if (clips.length === 0) {
    return (
      <View style={styles.root}>
        <View style={styles.head}>
          <Label>§ Studio · Keyframe video editor</Label>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={styles.title}>Pick a base clip</Text>
          <Text style={styles.body}>
            Build a sequence of clips, then layer images, GIFs, videos and text over them — each
            layer with its own in/out point, fades and keyframed motion.
          </Text>
          <Pressable
            onPress={async () => {
              setBusy(true);
              try {
                const uri = await pickVideoFromLibrary();
                if (uri) startWithClip(uri);
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
          >
            <Text style={styles.primaryBtnText}>{busy ? "Opening…" : "⤓  Import from gallery"}</Text>
          </Pressable>

          {videos.length > 0 && (
            <>
              <Text style={styles.sub}>From Library ({videos.length})</Text>
              <View style={styles.grid}>
                {videos.map((u) => (
                  <Pressable key={u} onPress={() => startWithClip(u)} style={styles.videoCell}>
                    <Text style={{ color: C.inkSoft, fontSize: 20 }}>▶</Text>
                    <Mono color={C.inkMute} size={9} style={{ marginTop: 6 }}>
                      {u.split("/").pop()?.slice(0, 14)}
                    </Mono>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </ScrollView>
        {toast && <Toast msg={toast} />}
      </View>
    );
  }

  // ---------------------------------------------------------------- editor --
  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Pressable onPress={() => { setClips([]); setActiveIndex(0); }} hitSlop={8}>
          <Mono color={C.inkMute} size={11}>‹ new</Mono>
        </Pressable>
        <Mono color={C.inkMute} size={11}>
          {layers.length} LAYER{layers.length === 1 ? "" : "S"}
        </Mono>
        {exportAvailable ? (
          <Pressable
            onPress={runExport}
            disabled={exporting || layers.length === 0}
            style={[styles.exportChip, (exporting || layers.length === 0) && { opacity: 0.5 }]}
          >
            {exporting ? <ActivityIndicator color="#fff" size="small" /> : <Mono color="#fff" size={11}>Export</Mono>}
          </Pressable>
        ) : (
          <Mono color={C.native} size={10}>NO NATIVE EXPORT</Mono>
        )}
      </View>

      <View
        style={styles.canvasWrap}
        onLayout={(e) => setCanvas({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        {layers.map((l) => (
          <Sprite
            key={l.id}
            layer={l}
            t={timelineTime}
            selected={l.id === selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setTab("animate");
            }}
            onDrag={(x, y) => patchLayer(l.id, (cur) => writeTransformAt(cur, timelineTime, { x, y }))}
            onPinch={(s) => patchLayer(l.id, (cur) => writeTransformAt(cur, timelineTime, { scale: s }))}
          />
        ))}
        {/* Dip transitions darken the preview exactly as they will the bake. */}
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: "#000", opacity: dipAmountAt(clips, timelineTime) }]}
        />
      </View>

      <View style={styles.transport}>
        <Pressable onPress={() => (playing ? player.pause() : player.play())} style={styles.playBtn}>
          <Text style={{ color: "#fff", fontSize: 15 }}>{playing ? "❚❚" : "▶"}</Text>
        </Pressable>
        <Mono color={C.ink} size={11}>{timelineTime.toFixed(2)}s</Mono>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setPps((p) => Math.max(20, p / 1.5))} style={styles.zoomBtn}>
          <Text style={styles.zoomText}>−</Text>
        </Pressable>
        <Mono color={C.inkFaint} size={10}>zoom</Mono>
        <Pressable onPress={() => setPps((p) => Math.min(400, p * 1.5))} style={styles.zoomBtn}>
          <Text style={styles.zoomText}>+</Text>
        </Pressable>
        <Mono color={C.inkMute} size={11} style={{ marginLeft: 8 }}>{timelineDuration.toFixed(1)}s</Mono>
      </View>

      <Timeline
        duration={timelineDuration}
        currentTime={timelineTime}
        layers={layers}
        selectedId={selectedId}
        pps={pps}
        onSeek={seekTimeline}
        onSelect={(id) => {
          setSelectedId(id);
          setTab("animate");
        }}
        onTrimLayer={(id, tIn, tOut) => patchLayer(id, (l) => ({ ...l, tIn, tOut }))}
        onMoveKeyframe={(id, from, to) => patchLayer(id, (l) => retimeKeyframe(l, from, to))}
        onTapKeyframe={seekTimeline}
      />

      <View style={styles.tabRow}>
        {(["layers", "animate", "clip"] as PanelTab[]).map((tk) => (
          <Pressable key={tk} onPress={() => setTab(tk)} style={[styles.tabBtn, tab === tk && styles.tabBtnOn]}>
            <Text style={[styles.tabBtnText, tab === tk && { color: "#fff" }]}>
              {tk === "layers" ? "Layers" : tk === "animate" ? "Animate" : "Clip"}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 14, paddingBottom: 34 }}>
        {tab === "layers" && (
          <>
            <View style={styles.addGrid}>
              <AddBtn label="Image / GIF" glyph="⤓" onPress={importImage} disabled={busy} />
              <AddBtn label="Video" glyph="🎬" onPress={importVideoLayer} disabled={busy} />
              <AddBtn label="Text" glyph="T" onPress={() => setTextModal(true)} disabled={busy} />
            </View>

            {layers.length === 0 ? (
              <Mono color={C.inkFaint} size={11} style={{ marginTop: 16 }}>
                Add an image, GIF, video or text layer — then animate it in the Animate tab.
              </Mono>
            ) : (
              <View style={{ marginTop: 16, gap: 8 }}>
                {layers.map((l, i) => (
                  <Pressable
                    key={l.id}
                    onPress={() => {
                      setSelectedId(l.id);
                      setTab("animate");
                    }}
                    style={[styles.layerRow, l.id === selectedId && styles.layerRowOn]}
                  >
                    {l.uri && l.kind !== "video" ? (
                      <Image source={{ uri: l.uri }} style={styles.layerThumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.layerThumb, styles.layerThumbAlt]}>
                        <Text style={{ fontSize: 14 }}>{l.kind === "video" ? "🎬" : "T"}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Mono color={C.ink} size={11}>
                        {l.kind === "text" ? l.text || "Text" : l.kind === "gif" ? "GIF" : l.kind === "video" ? "Video" : "Image"}
                      </Mono>
                      <Mono color={C.inkFaint} size={9.5} style={{ marginTop: 2 }}>
                        {l.tIn.toFixed(1)}–{l.tOut.toFixed(1)}s · {l.keyframes.length} kf{l.chroma ? " · keyed" : ""}
                      </Mono>
                    </View>
                    <View style={{ flexDirection: "row", gap: 4 }}>
                      <Pressable onPress={() => reorder(setLayers, i, -1)} hitSlop={6} style={styles.orderBtn}>
                        <Text style={styles.orderText}>▲</Text>
                      </Pressable>
                      <Pressable onPress={() => reorder(setLayers, i, 1)} hitSlop={6} style={styles.orderBtn}>
                        <Text style={styles.orderText}>▼</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                ))}
                <Mono color={C.inkFaint} size={9.5}>Further down this list = drawn on top.</Mono>
              </View>
            )}
          </>
        )}

        {tab === "animate" && !selected && (
          <Mono color={C.inkFaint} size={11}>Select a layer in Layers, or tap one on the canvas.</Mono>
        )}

        {tab === "animate" && selected && (
          <AnimatePanel
            layer={selected}
            t={timelineTime}
            duration={timelineDuration}
            onPatchPose={patchPose}
            onAddKeyframe={() => {
              patchLayer(selected.id, (l) => addKeyframeAt(l, timelineTime));
              flash(`Keyframe at ${timelineTime.toFixed(2)}s`);
            }}
            onRemoveKeyframe={(t) => patchLayer(selected.id, (l) => removeKeyframeAt(l, t))}
            onPatchLayer={(patch) => patchLayer(selected.id, (l) => ({ ...l, ...patch }))}
            onSeek={seekTimeline}
            onDelete={deleteSelected}
            onDuplicate={duplicateSelected}
          />
        )}

        {tab === "clip" && (
          <ClipPanel
            clips={clips}
            starts={starts}
            activeIndex={activeIndex}
            selectedClipId={selectedClipId}
            sourceDuration={sourceDuration}
            busy={busy}
            onSelectClip={(id, index) => {
              setSelectedClipId(id);
              seekTimeline(starts[index] ?? 0);
            }}
            onPatchClip={patchClip}
            onRemoveClip={removeClip}
            onMoveClip={moveClip}
            onAppendClip={appendClip}
          />
        )}
      </ScrollView>

      <Modal visible={textModal} transparent animationType="fade" onRequestClose={() => setTextModal(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Label>Add text</Label>
            <TextInput
              value={textInput}
              onChangeText={setTextInput}
              placeholder="Type here…"
              placeholderTextColor={C.inkFaint}
              style={styles.input}
              autoFocus
            />
            <View style={styles.modalBtns}>
              <Pressable onPress={() => setTextModal(false)} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  addLayer({ kind: "text", text: textInput.trim() || "Text" });
                  setTextInput("");
                  setTextModal(false);
                }}
                style={[styles.modalBtn, { backgroundColor: C.red, borderColor: C.red }]}
              >
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Add</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {toast && <Toast msg={toast} />}
    </View>
  );
}

function reorder(setLayers: React.Dispatch<React.SetStateAction<Layer[]>>, index: number, dir: -1 | 1) {
  setLayers((ls) => {
    const j = index + dir;
    if (j < 0 || j >= ls.length) return ls;
    const next = [...ls];
    [next[index], next[j]] = [next[j], next[index]];
    return next;
  });
}

// ------------------------------------------------------------------ panels --

function AnimatePanel({
  layer,
  t,
  duration,
  onPatchPose,
  onAddKeyframe,
  onRemoveKeyframe,
  onPatchLayer,
  onSeek,
  onDelete,
  onDuplicate,
}: {
  layer: Layer;
  t: number;
  duration: number;
  onPatchPose: (p: Partial<Keyframe>) => void;
  onAddKeyframe: () => void;
  onRemoveKeyframe: (t: number) => void;
  onPatchLayer: (p: Partial<Layer>) => void;
  onSeek: (t: number) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const pose = transformAt(layer, t);
  const onScreen = isVisibleAt(layer, t);
  const keyable = layer.kind === "video" || layer.kind === "image" || layer.kind === "gif";

  return (
    <View style={{ gap: 4 }}>
      <View style={styles.rowBetween}>
        <Mono color={C.ink} size={12}>{layer.kind === "text" ? layer.text || "Text" : layer.kind.toUpperCase()}</Mono>
        <View style={{ flexDirection: "row", gap: 14 }}>
          <Pressable onPress={onDuplicate} hitSlop={6}>
            <Mono color={C.inkMute} size={11}>duplicate</Mono>
          </Pressable>
          <Pressable onPress={onDelete} hitSlop={6}>
            <Mono color={C.red} size={11}>delete</Mono>
          </Pressable>
        </View>
      </View>

      {!onScreen && (
        <View style={styles.warnBox}>
          <Mono color={C.device} size={10}>
            Hidden at {t.toFixed(2)}s — this layer runs {layer.tIn.toFixed(1)}–{layer.tOut.toFixed(1)}s.
          </Mono>
        </View>
      )}

      <Pressable onPress={onAddKeyframe} style={styles.kfBtn}>
        <Text style={styles.kfBtnText}>◆  Keyframe at {t.toFixed(2)}s</Text>
      </Pressable>
      <Mono color={C.inkFaint} size={9.5}>
        {layer.keyframes.length <= 1
          ? "One keyframe = static. Drag it on the canvas to place it, then add a second keyframe to start animating."
          : "Animated — dragging on the canvas writes a keyframe at the playhead."}
      </Mono>

      <Ctrl label="Size">
        <Slider value={Math.round(pose.scale * 100)} min={10} max={500} step={5} onChange={(v) => onPatchPose({ scale: v / 100 })} width={132} />
      </Ctrl>
      <Ctrl label="Rotate">
        <Slider value={Math.round(pose.rotation)} min={-180} max={180} step={1} onChange={(v) => onPatchPose({ rotation: v })} width={132} />
      </Ctrl>
      <Ctrl label="Opacity">
        <Slider value={Math.round(pose.opacity)} min={0} max={100} step={5} onChange={(v) => onPatchPose({ opacity: v })} width={132} />
      </Ctrl>
      <Ctrl label="Easing → next">
        <Segmented
          options={["linear", "in", "out", "inOut"] as const}
          value={pose.easing}
          onChange={(v: Easing) => onPatchPose({ easing: v })}
        />
      </Ctrl>

      <Text style={styles.groupLabel}>Timing · pop in / pop out</Text>
      <Ctrl label={`In · ${layer.tIn.toFixed(1)}s`}>
        <Slider value={layer.tIn} min={0} max={Math.max(0.1, duration)} step={0.05} onChange={(v) => onPatchLayer({ tIn: Math.min(v, layer.tOut - 0.1) })} width={132} />
      </Ctrl>
      <Ctrl label={`Out · ${layer.tOut.toFixed(1)}s`}>
        <Slider value={layer.tOut} min={0} max={Math.max(0.1, duration)} step={0.05} onChange={(v) => onPatchLayer({ tOut: Math.max(v, layer.tIn + 0.1) })} width={132} />
      </Ctrl>
      <Ctrl label={`Fade in · ${layer.fadeIn.toFixed(1)}s`}>
        <Slider value={layer.fadeIn} min={0} max={3} step={0.1} onChange={(v) => onPatchLayer({ fadeIn: v })} width={132} />
      </Ctrl>
      <Ctrl label={`Fade out · ${layer.fadeOut.toFixed(1)}s`}>
        <Slider value={layer.fadeOut} min={0} max={3} step={0.1} onChange={(v) => onPatchLayer({ fadeOut: v })} width={132} />
      </Ctrl>

      {layer.kind === "text" && (
        <>
          <Text style={styles.groupLabel}>Text</Text>
          <Ctrl label="Font size">
            <Slider value={layer.fontSize} min={12} max={90} step={2} onChange={(v) => onPatchLayer({ fontSize: v })} width={132} />
          </Ctrl>
          <View style={styles.swatchRow}>
            {["#FFFFFF", "#000000", "#E0231C", "#37B36B", "#4C8DFF", "#E0A62A"].map((hex) => (
              <Pressable
                key={hex}
                onPress={() => onPatchLayer({ color: hex })}
                style={[styles.swatch, { backgroundColor: hex }, layer.color === hex && styles.swatchOn]}
              />
            ))}
          </View>
        </>
      )}

      {keyable && (
        <>
          <Text style={styles.groupLabel}>Green screen</Text>
          <View style={styles.rowBetween}>
            <Mono color={C.inkMute} size={10.5}>Cut out a key colour</Mono>
            <Pressable
              onPress={() => onPatchLayer({ chroma: layer.chroma ? null : { ...DEFAULT_CHROMA } })}
              style={[styles.pill, layer.chroma && styles.pillOn]}
            >
              <Mono color={layer.chroma ? "#fff" : C.inkMute} size={10}>{layer.chroma ? "ON" : "OFF"}</Mono>
            </Pressable>
          </View>
          {layer.chroma && (
            <>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                {([
                  ["green", [0.06, 0.72, 0.2]],
                  ["blue", [0.05, 0.35, 0.75]],
                ] as const).map(([name, col]) => (
                  <Pressable
                    key={name}
                    onPress={() => onPatchLayer({ chroma: { ...layer.chroma!, keyColor: [...col] as [number, number, number] } })}
                    style={[
                      styles.keyPreset,
                      { backgroundColor: name === "green" ? "#1a5c2e" : "#1a3a5c" },
                      layer.chroma!.keyColor[2] === col[2] && styles.keyPresetOn,
                    ]}
                  >
                    <Text style={{ color: "#fff", fontFamily: F.mono, fontSize: 11 }}>{name}</Text>
                  </Pressable>
                ))}
              </View>
              <Ctrl label="Threshold">
                <Slider value={Math.round(layer.chroma.threshold * 100)} min={5} max={80} step={1} onChange={(v) => onPatchLayer({ chroma: { ...layer.chroma!, threshold: v / 100 } })} width={132} />
              </Ctrl>
              <Ctrl label="Edge softness">
                <Slider value={Math.round(layer.chroma.smoothing * 100)} min={2} max={50} step={1} onChange={(v) => onPatchLayer({ chroma: { ...layer.chroma!, smoothing: v / 100 } })} width={132} />
              </Ctrl>
              <Mono color={C.inkFaint} size={9.5}>
                The key is applied in the baked export. The preview above shows the layer un-keyed.
              </Mono>
            </>
          )}
        </>
      )}

      <Text style={styles.groupLabel}>Keyframes ({layer.keyframes.length})</Text>
      <View style={{ gap: 6 }}>
        {layer.keyframes.map((k) => (
          <View key={k.t} style={styles.kfRow}>
            <Pressable onPress={() => onSeek(k.t)} hitSlop={6}>
              <Mono color={C.redBright} size={11}>{k.t.toFixed(2)}s</Mono>
            </Pressable>
            <Mono color={C.inkFaint} size={9.5}>
              {Math.round(k.x)},{Math.round(k.y)} · {Math.round(k.scale * 100)}% · {Math.round(k.opacity)}% · {k.easing}
            </Mono>
            {layer.keyframes.length > 1 && (
              <Pressable onPress={() => onRemoveKeyframe(k.t)} hitSlop={6}>
                <Text style={{ color: C.inkMute, fontSize: 13 }}>✕</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

function ClipPanel({
  clips,
  starts,
  activeIndex,
  selectedClipId,
  sourceDuration,
  busy,
  onSelectClip,
  onPatchClip,
  onRemoveClip,
  onMoveClip,
  onAppendClip,
}: {
  clips: BaseClip[];
  starts: number[];
  activeIndex: number;
  selectedClipId: string | null;
  sourceDuration: number;
  busy: boolean;
  onSelectClip: (id: string, index: number) => void;
  onPatchClip: (id: string, patch: Partial<BaseClip>) => void;
  onRemoveClip: (id: string) => void;
  onMoveClip: (index: number, dir: -1 | 1) => void;
  onAppendClip: () => void;
}) {
  const selected = clips.find((c) => c.id === selectedClipId) ?? null;
  const selectedIndex = clips.findIndex((c) => c.id === selectedClipId);
  // Only the clip currently loaded in the player has a known source length;
  // for the others the slider is capped by whatever trim they already carry.
  const max = selected
    ? selectedIndex === activeIndex && sourceDuration > 0
      ? sourceDuration
      : Math.max(selected.trimOut, 0.1)
    : 0.1;

  return (
    <View style={{ gap: 4 }}>
      <View style={styles.rowBetween}>
        <Text style={styles.groupLabelFlush}>Sequence ({clips.length})</Text>
        <Pressable onPress={onAppendClip} disabled={busy} style={[styles.addClipBtn, busy && { opacity: 0.5 }]}>
          <Mono color="#fff" size={10.5}>+ Add clip</Mono>
        </Pressable>
      </View>

      <View style={{ gap: 8, marginTop: 8 }}>
        {clips.map((c, i) => (
          <Pressable
            key={c.id}
            onPress={() => onSelectClip(c.id, i)}
            style={[styles.layerRow, c.id === selectedClipId && styles.layerRowOn]}
          >
            <View style={[styles.layerThumb, styles.layerThumbAlt]}>
              <Mono color={i === activeIndex ? C.redBright : C.inkMute} size={11}>{i + 1}</Mono>
            </View>
            <View style={{ flex: 1 }}>
              <Mono color={C.ink} size={11}>{c.uri.split("/").pop()?.slice(0, 20) ?? "clip"}</Mono>
              <Mono color={C.inkFaint} size={9.5} style={{ marginTop: 2 }}>
                starts {(starts[i] ?? 0).toFixed(1)}s · {clipOutputDuration(c).toFixed(1)}s
                {c.speed !== 1 ? ` · ${c.speed}×` : ""}
                {i > 0 && c.transition === "dip" ? " · dip" : ""}
              </Mono>
            </View>
            <View style={{ flexDirection: "row", gap: 4 }}>
              <Pressable onPress={() => onMoveClip(i, -1)} hitSlop={6} style={styles.orderBtn}>
                <Text style={styles.orderText}>▲</Text>
              </Pressable>
              <Pressable onPress={() => onMoveClip(i, 1)} hitSlop={6} style={styles.orderBtn}>
                <Text style={styles.orderText}>▼</Text>
              </Pressable>
            </View>
          </Pressable>
        ))}
      </View>

      {!selected ? (
        <Mono color={C.inkFaint} size={11} style={{ marginTop: 14 }}>Tap a clip above to trim it, set its speed, or give it a transition.</Mono>
      ) : (
        <>
          {selectedIndex > 0 && (
            <>
              <Text style={styles.groupLabel}>Transition in</Text>
              <Ctrl label="Style">
                <Segmented
                  options={["none", "dip"] as const}
                  value={selected.transition}
                  onChange={(v: Transition) => onPatchClip(selected.id, { transition: v })}
                  format={(v) => (v === "none" ? "Cut" : "Dip to black")}
                />
              </Ctrl>
              {selected.transition === "dip" && (
                <Ctrl label={`Length · ${selected.transitionDur.toFixed(1)}s`}>
                  <Slider value={selected.transitionDur} min={0.2} max={2} step={0.1} onChange={(v) => onPatchClip(selected.id, { transitionDur: v })} width={132} />
                </Ctrl>
              )}
            </>
          )}

          <Text style={styles.groupLabel}>Trim (source time)</Text>
          <Ctrl label={`Start · ${selected.trimIn.toFixed(1)}s`}>
            <Slider value={selected.trimIn} min={0} max={max} step={0.1} onChange={(v) => onPatchClip(selected.id, { trimIn: Math.min(v, selected.trimOut - 0.2) })} width={132} />
          </Ctrl>
          <Ctrl label={`End · ${selected.trimOut.toFixed(1)}s`}>
            <Slider value={selected.trimOut} min={0} max={max} step={0.1} onChange={(v) => onPatchClip(selected.id, { trimOut: Math.max(v, selected.trimIn + 0.2) })} width={132} />
          </Ctrl>
          {selectedIndex !== activeIndex && (
            <Mono color={C.inkFaint} size={9}>
              Tap this clip to load it in the player for exact trimming.
            </Mono>
          )}

          <Text style={styles.groupLabel}>Speed</Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {[0.25, 0.5, 1, 1.5, 2, 3, 4].map((sp) => (
              <Pressable key={sp} onPress={() => onPatchClip(selected.id, { speed: sp })} style={[styles.speedChip, selected.speed === sp && styles.speedChipOn]}>
                <Text style={{ color: selected.speed === sp ? "#fff" : C.inkSoft, fontFamily: F.mono, fontSize: 11 }}>{sp}×</Text>
              </Pressable>
            ))}
          </View>
          <Mono color={C.inkFaint} size={9.5} style={{ marginTop: 6 }}>
            This clip runs {clipOutputDuration(selected).toFixed(1)}s on the timeline
          </Mono>

          <View style={[styles.rowBetween, { marginTop: 16 }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Mono color={C.inkSoft} size={11}>Keep original pitch</Mono>
              <Mono color={C.inkFaint} size={9.5} style={{ marginTop: 2 }}>
                Off = chipmunk / slow-mo voice, the classic speed-change sound.
              </Mono>
            </View>
            <Pressable onPress={() => onPatchClip(selected.id, { preservePitch: !selected.preservePitch })} style={[styles.pill, selected.preservePitch && styles.pillOn]}>
              <Mono color={selected.preservePitch ? "#fff" : C.inkMute} size={10}>{selected.preservePitch ? "ON" : "OFF"}</Mono>
            </Pressable>
          </View>

          <View style={[styles.rowBetween, { marginTop: 12 }]}>
            <Mono color={C.inkSoft} size={11}>Mute this clip</Mono>
            <Pressable onPress={() => onPatchClip(selected.id, { muted: !selected.muted })} style={[styles.pill, selected.muted && styles.pillOn]}>
              <Mono color={selected.muted ? "#fff" : C.inkMute} size={10}>{selected.muted ? "ON" : "OFF"}</Mono>
            </Pressable>
          </View>

          {selected.speed !== 1 && (
            <View style={styles.warnBox}>
              <Mono color={C.device} size={10}>
                The preview plays speed-changed audio (both pitch modes), but in a baked export this
                clip is silent — retimed audio needs real resampling or time-stretching, which isn't
                built yet. The video speed itself bakes correctly.
              </Mono>
            </View>
          )}

          {clips.length > 1 && (
            <Pressable onPress={() => onRemoveClip(selected.id)} style={styles.removeClipBtn}>
              <Mono color={C.red} size={11}>Remove this clip</Mono>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ sprite --

function Sprite({
  layer,
  t,
  selected,
  onSelect,
  onDrag,
  onPinch,
}: {
  layer: Layer;
  t: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onDrag: (x: number, y: number) => void;
  onPinch: (scale: number) => void;
}) {
  const pose = transformAt(layer, t);
  const alpha = alphaAt(layer, t);
  const start = useRef({ x: 0, y: 0, scale: 1, dist: 0 });

  // Rebuilt each render so the gesture always starts from the current pose —
  // a ref-memoized responder here would capture a stale transform.
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      onSelect(layer.id);
      const touches = e.nativeEvent.touches;
      start.current = {
        x: pose.x,
        y: pose.y,
        scale: pose.scale,
        dist: touches.length >= 2 ? touchDistance(touches) : 0,
      };
    },
    onPanResponderMove: (e, g) => {
      const touches = e.nativeEvent.touches;
      if (touches.length >= 2) {
        const d = touchDistance(touches);
        if (start.current.dist > 0) {
          onPinch(Math.max(0.1, Math.min(6, start.current.scale * (d / start.current.dist))));
        }
        return;
      }
      onDrag(start.current.x + g.dx, start.current.y + g.dy);
    },
  });

  // Out-of-window layers stay mounted (a video layer keeps its playback
  // position) but go fully transparent and stop taking touches.
  const hidden = alpha <= 0.001;

  return (
    <View
      {...pan.panHandlers}
      pointerEvents={hidden ? "none" : "auto"}
      style={{
        position: "absolute",
        left: pose.x,
        top: pose.y,
        opacity: hidden ? 0 : alpha,
        transform: [{ rotate: `${pose.rotation}deg` }, { scale: pose.scale }],
      }}
    >
      <View style={selected && !hidden ? styles.spriteSel : undefined}>
        {layer.kind === "text" ? (
          <Text style={{ color: layer.color, fontSize: layer.fontSize, fontWeight: "800", fontFamily: F.sansMed }}>
            {layer.text}
          </Text>
        ) : layer.kind === "video" ? (
          <VideoLayerPreview uri={layer.uri!} />
        ) : (
          <Image source={{ uri: layer.uri! }} style={{ width: IMAGE_BOX, height: IMAGE_BOX }} contentFit="contain" />
        )}
      </View>
    </View>
  );
}

/**
 * Its own component rather than an inline branch, so every video layer gets
 * its own useVideoPlayer instance — hooks can't run in a loop, and this is
 * what makes several video overlays play live instead of showing the static
 * placeholder box the old editor used.
 */
function VideoLayerPreview({ uri }: { uri: string }) {
  const p = useVideoPlayer(uri, (pl) => {
    pl.loop = true;
    pl.muted = true;
    pl.play();
  });
  return <VideoView player={p} style={{ width: VIDEO_BOX_W, height: VIDEO_BOX_H }} contentFit="contain" nativeControls={false} />;
}

function touchDistance(touches: { pageX: number; pageY: number }[]): number {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

// -------------------------------------------------------------------- bits --

function AddBtn({ label, glyph, onPress, disabled }: { label: string; glyph: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.addBtn, disabled && { opacity: 0.5 }]}>
      <Text style={{ fontSize: 17, color: C.inkSoft }}>{glyph}</Text>
      <Mono color={C.inkSoft} size={10} style={{ marginTop: 5 }}>{label}</Mono>
    </Pressable>
  );
}

function Ctrl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.ctrl}>
      <Text style={styles.ctrlLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Toast({ msg }: { msg: string }) {
  return (
    <View pointerEvents="none" style={styles.toast}>
      <Mono color={C.ink} size={12}>{msg}</Mono>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  title: { color: C.ink, fontFamily: F.sansMed, fontSize: 22, fontWeight: "700", marginTop: 6 },
  body: { color: C.inkSoft, fontSize: 14, lineHeight: 21, marginTop: 8 },
  sub: { color: C.inkMute, fontFamily: F.mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 26, marginBottom: 12 },
  primaryBtn: { marginTop: 20, backgroundColor: C.red, borderRadius: 8, paddingVertical: 15, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 15 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  videoCell: { width: 92, height: 92, borderRadius: 10, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", padding: 6 },
  exportChip: { backgroundColor: C.red, borderRadius: 40, paddingHorizontal: 14, paddingVertical: 7, minWidth: 62, alignItems: "center" },
  canvasWrap: { height: 240, backgroundColor: "#000", marginHorizontal: 12, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: C.line },
  spriteSel: { borderWidth: 1, borderColor: C.redBright, borderStyle: "dashed" },
  transport: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  playBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.red, alignItems: "center", justifyContent: "center" },
  zoomBtn: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center", backgroundColor: C.surface },
  zoomText: { color: C.inkSoft, fontSize: 14, lineHeight: 16 },
  tabRow: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingTop: 10 },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 40, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface, alignItems: "center" },
  tabBtnOn: { backgroundColor: C.red, borderColor: C.red },
  tabBtnText: { color: C.inkSoft, fontFamily: F.mono, fontSize: 11 },
  panel: { flex: 1 },
  addGrid: { flexDirection: "row", gap: 8 },
  addBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface, alignItems: "center" },
  layerRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  layerRowOn: { borderColor: C.red, backgroundColor: "rgba(224,35,28,0.10)" },
  layerThumb: { width: 34, height: 34, borderRadius: 6, backgroundColor: C.bg2 },
  layerThumbAlt: { alignItems: "center", justifyContent: "center" },
  orderBtn: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: C.bg2 },
  orderText: { color: C.inkMute, fontSize: 9 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  warnBox: { marginTop: 8, backgroundColor: C.surface, borderLeftWidth: 3, borderLeftColor: C.device, borderRadius: 6, padding: 10 },
  kfBtn: { marginTop: 12, backgroundColor: C.red, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  kfBtnText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 12.5 },
  ctrl: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 7, gap: 10 },
  ctrlLabel: { color: C.inkMute, fontFamily: F.mono, fontSize: 10.5, flex: 1 },
  groupLabel: { color: C.inkMute, fontFamily: F.mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginTop: 18, marginBottom: 4 },
  groupLabelFlush: { color: C.inkMute, fontFamily: F.mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" },
  addClipBtn: { backgroundColor: C.red, borderRadius: 40, paddingHorizontal: 12, paddingVertical: 6 },
  removeClipBtn: { marginTop: 18, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, paddingVertical: 11, alignItems: "center", backgroundColor: C.surface },
  swatchRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "transparent" },
  swatchOn: { borderColor: "#fff" },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 40, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.bg2 },
  pillOn: { backgroundColor: C.go, borderColor: C.go },
  keyPreset: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: "transparent" },
  keyPresetOn: { borderColor: "#fff" },
  speedChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 40, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface },
  speedChipOn: { backgroundColor: C.red, borderColor: C.red },
  kfRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: C.bg2, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", backgroundColor: C.surface, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 12, padding: 20 },
  input: { marginTop: 12, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, color: C.ink, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 16 },
  modalBtn: { flex: 1, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  modalBtnText: { color: C.inkSoft, fontFamily: F.sansMed, fontWeight: "600", fontSize: 14 },
  toast: { position: "absolute", bottom: 24, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.85)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 40, borderWidth: 1, borderColor: C.line },
});
