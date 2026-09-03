import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button } from '../src/components/ui';
import { HeaderTitle } from '../src/components/HeaderTitle';
import { materializeContent } from '../src/content/materialize';
import { SettingsProvider, useSettings } from '../src/settings/SettingsContext';
import { lessonCss } from '../src/content/lessonCss';
import { useTheme } from '../src/theme';

/**
 * Parent screen for link-based entries.
 *
 * Landing straight into a lesson or an act (deep link, notification, external link) has no
 * history behind it, so the header was left without a back arrow, and the system "back" on
 * Android closed the app outright. With an initial route set, the router adds a tab screen
 * underneath, so there's somewhere to go back to. The key is called `anchor`;
 * `initialRouteName` is its older name and the router accepts both.
 */
export const unstable_settings = { anchor: '(tabs)' };

/**
 * A guard against exceptions thrown while rendering any screen.
 *
 * The router wraps a route in error handling **only** when its module exports
 * `ErrorBoundary`. Without that export, the exception bubbles up to React's root, which then
 * unmounts the whole tree — a Release build shows no red screen, so on a phone this looks like
 * the app spontaneously closing, with no trace of what happened. The export sits in this
 * top-level layout because every screen renders inside its subtree: one boundary here catches
 * anything a closer one didn't.
 *
 * A custom component instead of `export { ErrorBoundary } from 'expo-router'`, because the
 * router's default screen is in English while the app's interface is entirely in Polish — an
 * English "Something went wrong" inside a Polish app reads like a system failure, not like a
 * state with a way out.
 *
 * `retry` re-renders the route without killing the process. For transient errors (a database
 * read racing a write, a race while switching screens) that's enough; for a persistent error
 * the user will see the same screen again, not a blank one.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const theme = useTheme();

  return (
    <View style={[styles.center, { backgroundColor: theme.bg }]}>
      <Text style={[styles.title, { color: theme.text }]}>Coś poszło nie tak</Text>
      <Text style={[styles.detail, { color: theme.muted }]}>{error.message}</Text>
      <Text style={[styles.detail, { color: theme.muted }]}>
        Postęp nauki jest zapisany na urządzeniu — nic nie przepadło.
      </Text>
      <View style={styles.action}>
        {/* `retry` returns a promise, but `onPress` expects a synchronous function. */}
        <Button label="Spróbuj ponownie" onPress={() => void retry()} />
      </View>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  );
}

function AppShell() {
  const theme = useTheme();
  // Content text size in pixels. It feeds into the materialization version marker, so a
  // change to the setting — the app's own, or the system's until the user picks one —
  // rewrites the lessons to disk on its own.
  const { contentSize, loaded } = useSettings();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;

    setError(null);
    materializeContent(
      lessonCss(theme, contentSize),
      `${theme.dark ? 'dark' : 'light'}:${contentSize}`,
    )
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [theme, contentSize, loaded]);

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[styles.title, { color: theme.text }]}>Nie udało się przygotować treści</Text>
        <Text style={[styles.detail, { color: theme.muted }]}>{error}</Text>
        <Text style={[styles.detail, { color: theme.muted }]}>
          Zamknij i otwórz aplikację ponownie — pobieranie zacznie się od nowa.
        </Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
        <Text style={[styles.detail, { color: theme.muted }]}>Przygotowuję materiały…</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.surface },
          headerTintColor: theme.text,
          headerTitleStyle: { fontSize: 17 },
          // No alignment is set here, and that's a result of measurement, not neglect. The
          // gap between the back arrow and the title is the standard Material app-bar
          // indent (72 dp from the edge, when there's a nav icon) — it can't be recovered
          // either through `headerTitleAlign` or by dropping the custom component. Compared
          // both variants on a device: the screenshots came out pixel-identical, truncated
          // at the same character. So `HeaderTitle` stays — since we lose nothing on width,
          // we get the full name on tap for free.
          headerTitle: ({ children }) => <HeaderTitle title={String(children ?? '')} />,
          contentStyle: { backgroundColor: theme.bg },
          // Without this the back button shows the parent route's name — i.e. "(tabs)".
          headerBackButtonDisplayMode: 'minimal',
          headerBackTitle: '',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: 'Ustawienia', presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  detail: { fontSize: 14, textAlign: 'center' },
  action: { marginTop: 8, alignSelf: 'stretch' },
});
