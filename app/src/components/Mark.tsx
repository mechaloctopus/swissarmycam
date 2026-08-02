import React from "react";
import Svg, { Circle, Path, G } from "react-native-svg";
import { C } from "../theme";

/**
 * The aperture blade linkage. Exported because the boot animation opens this
 * exact geometry rather than a lookalike — one source of truth for the mark.
 */
export const IRIS =
  "M50 19 L76.85 34.5 M50 19 L75.16 12.69 M76.85 34.5 L76.85 65.5 M76.85 34.5 L94.89 53.14 M76.85 65.5 L50 81 M76.85 65.5 L69.73 90.45 M50 81 L23.15 65.5 M50 81 L24.84 87.31 M23.15 65.5 L23.15 34.5 M23.15 65.5 L5.11 46.86 M23.15 34.5 L50 19 M23.15 34.5 L30.27 9.55";
export const CROSS = "M46 37 h8 v9 h9 v8 h-9 v9 h-8 v-9 h-9 v-8 h9 z";

/** The brand mark: aperture iris + Swiss cross. Ring colour follows `color`. */
export function Mark({ size = 28, color = C.ink }: { size?: number; color?: string }) {
  const sw = 3.2;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <G fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
        <Circle cx={50} cy={50} r={45} strokeWidth={sw} />
        <Path d={IRIS} strokeWidth={sw * 0.8} opacity={0.85} />
      </G>
      <Path d={CROSS} fill={C.red} />
    </Svg>
  );
}
