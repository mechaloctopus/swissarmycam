import { useRef } from "react";
import { PanResponder, PanResponderGestureState, GestureResponderEvent } from "react-native";

/**
 * The one correct way to write a drag in this codebase.
 *
 * Hand-rolled PanResponders here failed in two opposite ways, repeatedly:
 *
 *  - Built fresh each render, so a drag that re-renders (which is every drag
 *    worth having — it moves the thing you are dragging) received a new
 *    PanResponder mid-gesture carrying a new gestureState. `g.dx` reset to ~0
 *    on every event and nothing moved.
 *  - Built once with `useRef`, which keeps gestureState intact but freezes the
 *    closure: props and state stay at their first-render values, so handlers
 *    write to whatever was selected when the component mounted.
 *
 * Both bugs shipped, in five places, and each looked like a different feature
 * being broken. This helper makes the correct shape the easy one: the
 * responder is created exactly once, while `live` is refreshed every render
 * and handed to each handler. Do not call PanResponder.create directly.
 */
export type LiveGestureHandlers<T> = {
  /** Claim the gesture on touch-down. Defaults to true. */
  shouldStart?: (live: T, e: GestureResponderEvent) => boolean;
  /** Claim it once movement begins. Defaults to true. */
  shouldMove?: (live: T, e: GestureResponderEvent, g: PanResponderGestureState) => boolean;
  onStart?: (live: T, e: GestureResponderEvent, g: PanResponderGestureState) => void;
  onMove?: (live: T, e: GestureResponderEvent, g: PanResponderGestureState) => void;
  onEnd?: (live: T, e: GestureResponderEvent, g: PanResponderGestureState) => void;
  /**
   * Whether a parent (usually a ScrollView) may steal an in-flight gesture.
   * Defaults to false: once a control has claimed a drag, it keeps it.
   */
  allowTermination?: boolean;
};

export function useLiveGesture<T extends object>(live: T, handlers: LiveGestureHandlers<T>) {
  // Refreshed every render — this is what keeps handlers current.
  const ref = useRef(live);
  ref.current = live;

  const h = useRef(handlers);
  h.current = handlers;

  // Created once — this is what keeps gestureState continuous across the
  // re-renders a drag causes.
  return useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (e) => h.current.shouldStart?.(ref.current, e) ?? true,
      onMoveShouldSetPanResponder: (e, g) => h.current.shouldMove?.(ref.current, e, g) ?? true,
      onPanResponderTerminationRequest: () => h.current.allowTermination ?? false,
      onPanResponderGrant: (e, g) => h.current.onStart?.(ref.current, e, g),
      onPanResponderMove: (e, g) => h.current.onMove?.(ref.current, e, g),
      onPanResponderRelease: (e, g) => h.current.onEnd?.(ref.current, e, g),
      onPanResponderTerminate: (e, g) => h.current.onEnd?.(ref.current, e, g),
    })
  ).current;
}
