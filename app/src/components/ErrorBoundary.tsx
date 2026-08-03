import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { C, F } from "../theme";
import { Mono } from "./ui";
import { Mark } from "./Mark";

/**
 * Catches a render/lifecycle crash anywhere below it and shows a recovery
 * screen instead of letting the process die.
 *
 * This does not paper over bugs — the error is shown, not swallowed — but it
 * means one bad screen costs you that screen rather than the whole session.
 * Studio autosaves its project, so "Try again" generally lands you back where
 * you were with the work intact.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.inner}>
          <Mark size={56} />
          <Text style={styles.title}>That screen hit a snag</Text>
          <Text style={styles.body}>
            Something in the last screen threw an error. Your captures are on disk and any Studio
            project was saved automatically — nothing you shot is lost.
          </Text>
          <View style={styles.detail}>
            <Mono color={C.inkMute} size={10}>{error.message || String(error)}</Mono>
          </View>
          <Pressable onPress={() => this.setState({ error: null })} style={styles.btn}>
            <Text style={styles.btnText}>Try again</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  inner: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 30 },
  title: { color: C.ink, fontFamily: F.sansMed, fontSize: 22, fontWeight: "700", marginTop: 20, textAlign: "center" },
  body: { color: C.inkSoft, fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: "center", maxWidth: 340 },
  detail: {
    marginTop: 18,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderLeftWidth: 3,
    borderLeftColor: C.red,
    borderRadius: 8,
    padding: 12,
    maxWidth: 360,
  },
  btn: { marginTop: 22, backgroundColor: C.red, borderRadius: 8, paddingHorizontal: 26, paddingVertical: 14 },
  btnText: { color: "#fff", fontFamily: F.sansMed, fontWeight: "700", fontSize: 15 },
});
