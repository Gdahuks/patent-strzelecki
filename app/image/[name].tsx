import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { assetExists, assetUri } from '../../src/content/materialize';
import { useTheme } from '../../src/theme';

/**
 * A diagram preview opened from lesson content.
 *
 * Firearm-anatomy diagrams are sometimes wider than the screen, so we show them in a
 * WebView — pinch-to-zoom and scrolling on both axes come for free.
 */
export default function ImageScreen() {
  // `useLocalSearchParams` returns the value **already decoded** (expo-router 6). A second
  // `decodeURIComponent` call crashed the screen with a URIError on a name containing a
  // literal percent sign, even though the file was right there on disk.
  const { name } = useLocalSearchParams<{ name: string }>();
  const theme = useTheme();

  // Sibling screens (lesson, act) state plainly what's missing from the bundle. Without
  // this, a missing image produced a blank page with the title "Schemat" and nothing else.
  if (!assetExists(name)) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.bg }]}>
        <Stack.Screen options={{ title: 'Nie znaleziono' }} />
        <Text style={{ color: theme.muted }}>Tego obrazka nie ma w pobranej paczce treści.</Text>
      </View>
    );
  }

  const src = assetUri(name).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  // `lang` and `alt` are here for the same reason as in lessons: without the language, a
  // screen reader pronounces Polish words with English phonetics, and without a description
  // it reads out the file name instead. The description is deliberately generic — the real
  // caption sits next to the image in the lesson this screen is opened from, and the scraper
  // writes it there as `alt`. Repeating it here would require threading captions through the
  // content bundle, for no real gain: the user just heard it.
  const html = `<!doctype html>
<html lang="pl"><head>
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=6">
<style>
  html, body { margin: 0; height: 100%; background: ${theme.bg}; }
  body { display: flex; align-items: center; justify-content: center; }
  img { max-width: 100%; height: auto; }
</style>
</head><body><img src="${src}" alt="Powiększony obrazek z lekcji"></body></html>`;

  return (
    <View style={[styles.fill, { backgroundColor: theme.bg }]}>
      <Stack.Screen options={{ title: 'Schemat' }} />
      <WebView
        source={{ html }}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        javaScriptEnabled={false}
        scalesPageToFit
        style={{ backgroundColor: theme.bg }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
