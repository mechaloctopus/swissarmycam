import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import * as FileSystem from "expo-file-system/legacy";
import { C, F } from "../theme";
import { Mono } from "./ui";

/**
 * Traversable 3D Gaussian Splat viewer — orbit / pan / zoom, in a WebView.
 *
 * Renders with @mkkellogg/GaussianSplats3D (the standard Three.js splat
 * renderer), loaded from CDN inside the page: splats rasterize with plain
 * WebGL, which is exactly why this works in a WebView where a true NeRF
 * (neural-net inference per frame) never could. The scan zip itself is read
 * locally over file:// — only the renderer library comes from the network,
 * so viewing needs internet the same way the reconstruction itself did.
 *
 * sharedMemoryForWorkers is off deliberately: SharedArrayBuffer needs
 * cross-origin-isolation headers a file:// page can never have.
 */
const VIEWER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  html,body{margin:0;padding:0;background:#0B0B0C;height:100%;overflow:hidden}
  #status{position:fixed;top:14px;left:0;right:0;text-align:center;color:#8B9298;
    font:12px monospace;z-index:10;pointer-events:none;text-shadow:0 1px 4px #000}
</style>
<script type="importmap">
{"imports":{
  "three":"https://unpkg.com/three@0.160.0/build/three.module.js",
  "@mkkellogg/gaussian-splats-3d":"https://unpkg.com/@mkkellogg/gaussian-splats-3d@0.4.7/build/gaussian-splats-3d.module.js"
}}
</script>
<script src="https://unpkg.com/fflate@0.8.2/umd/index.js"></script>
</head>
<body>
<div id="status">loading renderer…</div>
<script type="module">
const status = (m) => { document.getElementById("status").textContent = m; };
try {
  const GS = await import("@mkkellogg/gaussian-splats-3d");
  const file = new URLSearchParams(location.search).get("file");
  status("reading scan…");

  const buf = await new Promise((resolve, reject) => {
    // XHR rather than fetch: fetch() refuses file:// URLs in Android WebView,
    // XHR honours allowFileAccessFromFileURLs.
    const xhr = new XMLHttpRequest();
    xhr.open("GET", file, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => (xhr.response ? resolve(xhr.response) : reject(new Error("empty file")));
    xhr.onerror = () => reject(new Error("could not read the scan file"));
    xhr.send();
  });

  let bytes = new Uint8Array(buf);
  let name = file.toLowerCase();
  if (name.endsWith(".zip")) {
    status("unpacking…");
    const entries = fflate.unzipSync(bytes);
    const entry = Object.keys(entries).find((k) => /\\.(ply|splat|ksplat)$/i.test(k));
    if (!entry) throw new Error("no splat/ply found inside the zip");
    bytes = entries[entry];
    name = entry.toLowerCase();
  }

  const format = name.endsWith(".ply") ? GS.SceneFormat.Ply
    : name.endsWith(".ksplat") ? GS.SceneFormat.KSplat
    : GS.SceneFormat.Splat;
  const blobUrl = URL.createObjectURL(new Blob([bytes]));

  status("building scene…");
  const viewer = new GS.Viewer({
    cameraUp: [0, -1, 0],
    initialCameraPosition: [0, 0, 3],
    initialCameraLookAt: [0, 0, 0],
    sharedMemoryForWorkers: false,
  });
  await viewer.addSplatScene(blobUrl, { format, splatAlphaRemovalThreshold: 5, showLoadingUI: false });
  viewer.start();
  status("drag to orbit · two fingers to pan · pinch to zoom");
  setTimeout(() => status(""), 4000);
} catch (e) {
  status("failed: " + (e && e.message ? e.message : e));
}
</script>
</body>
</html>`;

export function SplatViewer({ modelPath, onClose }: { modelPath: string; onClose: () => void }) {
  const [pageUri, setPageUri] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const htmlPath = (FileSystem.cacheDirectory ?? "") + "splat-viewer.html";
        await FileSystem.writeAsStringAsync(htmlPath, VIEWER_HTML);
        const fileParam = encodeURIComponent(modelPath.startsWith("file://") ? modelPath : `file://${modelPath}`);
        setPageUri(`${htmlPath}?file=${fileParam}`);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not prepare the viewer");
      }
    })();
  }, [modelPath]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {pageUri ? (
          <WebView
            source={{ uri: pageUri }}
            style={{ flex: 1, backgroundColor: "#0B0B0C" }}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            mixedContentMode="always"
          />
        ) : (
          <View style={styles.center}>
            {err ? <Mono color={C.red} size={12}>{err}</Mono> : <ActivityIndicator color={C.red} />}
          </View>
        )}
        <Pressable onPress={onClose} style={styles.close} hitSlop={10}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0B0B0C" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  close: {
    position: "absolute",
    top: 46,
    right: 18,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderWidth: 1,
    borderColor: C.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: C.ink, fontSize: 16, fontFamily: F.sansMed },
});
