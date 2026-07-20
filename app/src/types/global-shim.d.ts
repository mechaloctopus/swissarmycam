// We deep-import @shopify/react-native-skia's raw .ts source (see
// src/chroma.ts) instead of its compiled .d.ts declarations, to avoid a
// broken optional-dependency subtree. That means tsc compiles that source
// against *our* tsconfig instead of the package's own — which has no
// "node" lib, so the bare `global` reference in its NativeSetup.ts (a
// real Hermes/RN runtime global, just untyped here) doesn't resolve.
declare var global: any;
