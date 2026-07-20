// react-native-reanimated is intentionally NOT a dependency of this app (see
// src/chroma.ts for why: pulling it in for real just to satisfy one optional
// type reference inside @shopify/react-native-skia's source isn't worth the
// extra native module/babel-plugin weight). This ambient shim exists purely
// so `tsc` can resolve that package's `import type { SharedValue } from
// "react-native-reanimated"` — it has no effect on the built app; type-only
// imports are erased before Metro ever emits a require() for them.
declare module "react-native-reanimated" {
  export type SharedValue<T = unknown> = { value: T };
}
