import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { FindBar, useFindInPage } from '../../src/components/FindBar';
import { HeaderIcon } from '../../src/components/HeaderIcon';
import { findHelpersScript } from '../../src/content/findInPage';
import { glossaryScript } from '../../src/content/glossaryScript';
import { linkClickScript, parseLinkMessage } from '../../src/content/linkScript';
import { schematicScript } from '../../src/content/schematicScript';
import { openInAppBrowser } from '../../src/content/openSource';
import { contentDirUri, lessonFileUri } from '../../src/content/materialize';
import { SCROLL_PROPS } from '../../src/content/webviewProps';
import { parseScrollMessage, readingScript } from '../../src/content/readingScript';
import { content } from '../../src/content/store';
import {
  READ_THRESHOLD,
  type ReadingState,
  loadReading,
  resumePosition,
  saveReadingPosition,
  setReadingState,
} from '../../src/db/reading';
import { plural } from '../../src/engine/plural';
import { fileUrlToHref, isSameDocument, resolveLink, routeFor } from '../../src/navigation/links';
import { useTheme } from '../../src/theme';

export default function LessonScreen() {
  const { slug, q } = useLocalSearchParams<{ slug: string; q?: string }>();
  const theme = useTheme();
  const router = useRouter();
  const webview = useRef<WebView>(null);
  const [showExercises, setShowExercises] = useState(false);

  // A phrase passed in from search results opens the lesson with the find bar already active.
  const find = useFindInPage(webview, q ?? '');

  const lesson = content.lesson(slug);
  const uri = useMemo(() => (lesson ? lessonFileUri(lesson.slug) : ''), [lesson]);
  const sets = useMemo(() => (lesson ? content.setsForLesson(lesson.slug) : []), [lesson]);

  // The starting position has to be known before the WebView mounts — the scroll-restoring
  // script is injected once, when the page loads.
  const [startPosition, setStartPosition] = useState<number | null>(null);
  const [readState, setReadState] = useState<ReadingState | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadReading(slug).then((reading) => {
      if (cancelled) return;
      setStartPosition(resumePosition(reading));
      setReadState(reading?.state ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  /** A link from the content — the shared path for both an in-page click and the navigation guard. */
  const openLink = useCallback(
    (href: string) => {
      const target = resolveLink(href, content.lessonSlugs);

      if (target.kind === 'anchor') return;

      if (target.kind === 'external') {
        openInAppBrowser(target.url, theme);
        return;
      }

      if (target.kind === 'image') {
        router.push(`/image/${encodeURIComponent(target.name)}`);
        return;
      }

      const route = routeFor(target);
      if (route) router.push(route as never);
    },
    [router, theme],
  );

  const acceptFind = find.accept;

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (acceptFind(event.nativeEvent.data)) return;

      const href = parseLinkMessage(event.nativeEvent.data);
      if (href !== null) {
        openLink(href);
        return;
      }

      const position = parseScrollMessage(event.nativeEvent.data);
      if (position === null) return;

      void saveReadingPosition(slug, position);
      if (position >= READ_THRESHOLD) setReadState('read');
      else setReadState((current) => current ?? 'started');
    },
    [slug, openLink, acceptFind],
  );

  const toggleRead = useCallback(() => {
    const next: ReadingState = readState === 'read' ? 'started' : 'read';
    setReadState(next);
    void setReadingState(slug, next);
  }, [readState, slug]);

  /**
   * Guards against navigation that wasn't triggered by a click — a script-driven redirect,
   * or a link added after the listener was injected. Ordinary clicks never reach here, since
   * `linkClickScript` blocks them on the page; this address may already be resolved to
   * `file://`, so it has to be brought back down to a plain link first.
   */
  const onNavigate = useCallback(
    (event: WebViewNavigation) => {
      if (event.url.startsWith('about:') || isSameDocument(event.url, uri)) return true;

      const href = fileUrlToHref(event.url, contentDirUri());
      if (resolveLink(href, content.lessonSlugs).kind === 'anchor') return true;

      openLink(href);
      return false;
    },
    [openLink, uri],
  );

  if (!lesson) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.bg }]}>
        <Stack.Screen options={{ title: 'Nie znaleziono' }} />
        <Text style={{ color: theme.muted }}>Tej lekcji nie ma w pobranej paczce treści.</Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: lesson.title,
          // Only the magnifying glass stays in the header. The read state sits in the
          // bottom bar instead, because next to the lesson title it was cramped and the
          // title got truncated.
          headerRight: () => (
            <HeaderIcon name="search" label="Szukaj w lekcji" onPress={find.toggle} />
          ),
        }}
      />

      {find.open ? (
        <FindBar
          placeholder="Szukaj w tej lekcji"
          query={find.query}
          state={find.state}
          onChange={find.change}
          onStep={find.step}
          onClose={find.close}
        />
      ) : null}

      {/* Waiting for the saved position to be read: the scroll-restoring script goes to the
          page once, when it loads. */}
      {startPosition === null ? null : (
        <WebView
          ref={webview}
          source={{ uri }}
          originWhitelist={['*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          onShouldStartLoadWithRequest={onNavigate}
          onMessage={onMessage}
          // A phrase from search results must only take effect after the content has loaded.
          onLoadEnd={find.rerun}
          injectedJavaScript={
            `${readingScript(startPosition)}\n${glossaryScript()}\n${findHelpersScript()}\n${linkClickScript()}\n${schematicScript()}`
          }
          style={{ backgroundColor: theme.bg }}
          {...SCROLL_PROPS}
          setSupportMultipleWindows={false}
        />
      )}

      <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
        {sets.length > 0 ? (
          <>
            {showExercises ? (
              <ScrollView style={styles.setList} contentContainerStyle={styles.setListInner}>
              {sets.map((set) => (
                <View key={set.slug} style={styles.setRow}>
                  <View style={styles.grow}>
                    <Text style={[styles.setTitle, { color: theme.text }]} numberOfLines={2}>
                      {set.title}
                    </Text>
                    <Text style={[styles.setCount, { color: theme.muted }]}>
                      {set.questionIds.length}{' '}
                      {plural(set.questionIds.length, 'pytanie', 'pytania', 'pytań')}
                    </Text>
                  </View>
                  {/* Widened by half the gap: 4 px sideways (chips are 8 px apart) and
                      5 px vertically (set rows are 10 px apart). */}
                  <Pressable
                    onPress={() => router.push(`/practice/flashcards/${set.slug}`)}
                    hitSlop={{ top: 5, bottom: 5, left: 4, right: 4 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Fiszki: ${set.title}`}
                    style={({ pressed }) => [
                      styles.chip,
                      { borderColor: theme.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={{ color: theme.accent, fontWeight: '600' }}>Fiszki</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push(`/practice/test/${set.slug}`)}
                    hitSlop={{ top: 5, bottom: 5, left: 4, right: 4 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Test ABC: ${set.title}`}
                    style={({ pressed }) => [
                      styles.chip,
                      { borderColor: theme.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={{ color: theme.accent, fontWeight: '600' }}>Test</Text>
                  </Pressable>
                </View>
              ))}
              </ScrollView>
            ) : null}

            <Pressable
              onPress={() => setShowExercises((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showExercises }}
              style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
            >
              <Text style={[styles.toggleLabel, { color: theme.accent }]}>
                {showExercises ? 'Ukryj ćwiczenia' : `Poćwicz tę lekcję (${sets.length})`}
              </Text>
              <Text style={{ color: theme.accent, fontSize: 13 }}>
                {showExercises ? '▾' : '▴'}
              </Text>
            </Pressable>
          </>
        ) : null}

        <Pressable
          onPress={toggleRead}
          accessibilityRole="button"
          // "✓ Przeczytane" isn't a label, it's the current state — a screen reader needs to
          // know that tapping it toggles the state, not that the button is named "read".
          accessibilityLabel={
            readState === 'read' ? 'Przeczytane. Oznacz jako nieprzeczytane' : 'Oznacz jako przeczytane'
          }
          accessibilityState={{ checked: readState === 'read' }}
          style={({ pressed }) => [
            styles.readToggle,
            { borderTopColor: theme.border, borderTopWidth: sets.length > 0 ? StyleSheet.hairlineWidth : 0 },
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={{
              color: readState === 'read' ? theme.good : theme.accent,
              fontSize: 15,
              fontWeight: '600',
            }}
          >
            {readState === 'read' ? '✓ Przeczytane' : 'Oznacz jako przeczytane'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  readToggle: { alignItems: 'center', paddingVertical: 13 },
  // An emoji sits on the baseline and leaves room underneath it, so inside a round header
  // button it landed above centre. A fixed-size container plus a lineHeight equal to its
  // height centres the glyph on both axes.
  headerButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerGlyph: { fontSize: 17, lineHeight: 32, textAlign: 'center' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
  setList: { maxHeight: 220 },
  setListInner: { padding: 12, gap: 10 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  setTitle: { fontSize: 14, fontWeight: '600' },
  setCount: { fontSize: 12 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
  },
  toggleLabel: { fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.65 },
});
