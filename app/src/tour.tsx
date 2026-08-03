import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SEEN_KEY = "lensii.tour.seen";

export type TourStep = {
  /** Tab to switch to before this step shows — the tour drives real navigation. */
  tab?: string;
  /** Registered target id to spotlight. Omitted = a centered card with no cutout. */
  target?: string;
  title: string;
  body: string;
};

/**
 * The tour walks the tab bar, because in Lensii every feature *is* a tab.
 * Spotlighting each tab while actually switching to it means you see the real
 * screen behind the bubble rather than a screenshot of one, and it keeps the
 * whole thing anchored to elements that are always mounted — no target refs
 * threaded through eleven screens to go stale.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to Lensii",
    body:
      "A camera instrument with a workshop attached. This is a quick pass through everything — about a minute. You can skip it at any point and restart it from Settings.",
  },
  {
    tab: "capture",
    target: "tab.capture",
    title: "Capture",
    body:
      "Photo and video, with the controls a real camera gives you: grid, level, reticle, self-timer, torch and zoom. Analyze reads your last shot on-device — colour palette, text, and objects — without anything leaving the phone. Free forever.",
  },
  {
    tab: "library",
    target: "tab.library",
    title: "Library",
    body:
      "Everything you shoot lands here first, on your device. Crop, rotate, play back, share, or save to Photos — saving out is always a deliberate act, never automatic unless you ask. Also free forever.",
  },
  {
    tab: "studio",
    target: "tab.studio",
    title: "Studio",
    body:
      "The keyframe video editor. Sequence clips, layer images, video and text over them, and keyframe position, scale, rotation and opacity with easing. Undo/redo, snapping and frame-stepping throughout. Import music or a voiceover on its own track, then export a real MP4 with everything baked in.",
  },
  {
    tab: "trace",
    target: "tab.trace",
    title: "Trace",
    body:
      "Project a reference onto real paper or a wall and draw along it. Print the marker for a lock that holds to the millimetre, or tap Auto lock to track whatever texture is already on the surface. Lines mode shows just the edges so you can see your own pencil.",
  },
  {
    tab: "clay",
    target: "tab.clay",
    title: "Clay",
    body:
      "Stop-motion. Onion skin ghosts up to three previous frames so you can judge spacing, and review mode sits you between frames to check the motion before you commit. Bakes to MP4.",
  },
  {
    tab: "timelapse",
    target: "tab.timelapse",
    title: "Timelapse",
    body: "Set an interval and let it run. Frames are saved as a set, then baked into a real MP4 at the frame rate you pick.",
  },
  {
    tab: "scan",
    target: "tab.scan",
    title: "Scan",
    body:
      "Guided multi-angle capture, plus cloud 3D reconstruction: hand it a short video and get back a Gaussian splat you can orbit, pan and zoom right here. This is the one feature that sends anything off your device, and only when you tap it.",
  },
  {
    tab: "screen",
    target: "tab.screen",
    title: "Screen",
    body: "System-wide screen recording through Android's own consent flow, with a persistent indicator the whole time it runs. Saves straight to Library.",
  },
  {
    tab: "tools",
    target: "tab.tools",
    title: "Tools & Attachments",
    body:
      "A unit converter, and an honest inventory of your hardware — real Camera2 sensor characteristics per lens, and the microphones your device actually reports.",
  },
  {
    tab: "settings",
    target: "tab.settings",
    title: "Settings",
    body:
      "Everything is adjustable here, and the Capability map tells you plainly what this app can and can't do on your hardware — including the things that aren't built yet. Restart this tour from here any time.",
  },
  {
    tab: "capture",
    title: "That's the tour",
    body: "Capture and Library are free forever. Everything else runs on a trial, subscription, or access code. Go make something.",
  },
];

type Ctx = {
  active: boolean;
  step: number;
  steps: TourStep[];
  rect: { x: number; y: number; width: number; height: number } | null;
  start: () => void;
  next: () => void;
  back: () => void;
  stop: () => void;
  register: (id: string, node: View | null) => void;
  /** Shell supplies this so the tour can drive real tab navigation. */
  setNavigator: (fn: (tab: string) => void) => void;
};

const TourContext = createContext<Ctx | null>(null);

export function useTour(): Ctx {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used inside <TourProvider>");
  return ctx;
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Ctx["rect"]>(null);
  const targets = useRef(new Map<string, View>()).current;
  const navigate = useRef<(tab: string) => void>(() => {});

  const register = useCallback(
    (id: string, node: View | null) => {
      if (node) targets.set(id, node);
      else targets.delete(id);
    },
    [targets],
  );

  const setNavigator = useCallback((fn: (tab: string) => void) => {
    navigate.current = fn;
  }, []);

  const start = useCallback(() => {
    setStep(0);
    setRect(null);
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setRect(null);
    AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {});
  }, []);

  const next = useCallback(() => {
    setStep((s) => {
      if (s + 1 >= TOUR_STEPS.length) {
        stop();
        return s;
      }
      return s + 1;
    });
  }, [stop]);

  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  // First launch only. Deliberately not awaited anywhere — if storage fails the
  // worst case is the tour offers itself again, which beats it never showing.
  useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY)
      .then((v) => {
        if (!v) setTimeout(() => setActive(true), 2600);
      })
      .catch(() => {});
  }, []);

  // Drive navigation, then measure. The delay lets the tab switch and the tab
  // bar's scroll settle before measureInWindow reads a position we'd otherwise
  // draw a spotlight around in the wrong place.
  useEffect(() => {
    if (!active) return;
    const s = TOUR_STEPS[step];
    if (s.tab) navigate.current(s.tab);
    setRect(null);
    if (!s.target) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      const node = targets.get(s.target!);
      if (!node) return;
      node.measureInWindow((x, y, width, height) => {
        if (!cancelled && width > 0 && height > 0) setRect({ x, y, width, height });
      });
    }, 420);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, step, targets]);

  return (
    <TourContext.Provider
      value={{ active, step, steps: TOUR_STEPS, rect, start, next, back, stop, register, setNavigator }}
    >
      {children}
    </TourContext.Provider>
  );
}
