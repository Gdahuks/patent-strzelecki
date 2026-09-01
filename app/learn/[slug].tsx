import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { parseReadingSample, readerPosition, readingScript } from '../../src/content/readingScript';
import { content } from '../../src/content/store';
import {
  READ_THRESHOLD,
  type ReadingState,
  loadReading,
  resumePosition,
  saveConfirmedProgress,
  saveReadingPosition,
  setReadingState,
} from '../../src/db/reading';
import {
  type Viewport,
  newDwell,
  pause,
  sample as takeSample,
} from '../../src/engine/readingDwell';
import { plural } from '../../src/engine/plural';
import { fileUrlToHref, isSameDocument, resolveLink, routeFor } from '../../src/navigation/links';
import { useTheme } from '../../src/theme';
import { useBottomInset } from '../../src/components/safeArea';

export default function LessonScreen() {
  const { slug, q } = useLocalSearchParams<{ slug: string; q?: string }>();
  const theme = useTheme();
  const router = useRouter();
  const webview = useRef<WebView>(null);
  // Holds "Oznacz jako przeczytane" — under a three-button navigation bar it was untappable.
  const footerPadding = useBottomInset();
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

  // How long each piece of the lesson has been on screen during this visit. Lives here and
  // nowhere else: only the peak it produces is worth keeping between visits.
  const dwell = useRef(newDwell(0));
  const savedPeak = useRef(0);
  const pageHeight = useRef(0);

  useEffect(() => {
    let cancelled = false;

    void loadReading(slug).then((reading) => {
      if (cancelled) return;
      setStartPosition(resumePosition(reading));
      setReadState(reading?.state ?? null);
      dwell.current = newDwell(reading?.maxPosition ?? 0);
      savedPeak.current = reading?.maxPosition ?? 0;
      pageHeight.current = 0;
    });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  /**
   * A link from the content — the shared path for both an in-page click and the navigation
   * guard.
   */
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

  /**
   * Takes in one sample of where the reader is, and persists the peak when it moves.
   *
   * The peak advances a segment at a time, so writing on advance is a handful of writes per
   * lesson rather than one per sample.
   */
  const track = useCallback(
    (viewport: Viewport) => {
      dwell.current = takeSample(dwell.current, viewport, Date.now());
      const confirmed = dwell.current.confirmed;
      if (confirmed <= savedPeak.current) return;

      savedPeak.current = confirmed;
      void saveConfirmedProgress(slug, confirmed);
      if (confirmed >= READ_THRESHOLD) setReadState('read');
      else setReadState((current) => current ?? 'started');
    },
    [slug],
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

      const reading = parseReadingSample(event.nativeEvent.data);
      if (reading === null) return;

      // A reflow — a rotation, or a change of system font size — moves every place in the
      // document, so counters gathered against the old layout no longer describe the text
      // they were counted for. The peak survives; only the partial time is dropped.
      if (reading.height > 0) {
        const previous = pageHeight.current;
        if (previous > 0 && Math.abs(reading.height - previous) > previous * 0.02) {
          dwell.current = newDwell(dwell.current.confirmed);
        }
        pageHeight.current = reading.height;
      }

      // The position is only saved for movement the reader caused. The samples the page sends
      // on load exist to give the tracker a window, and writing them would leave "zaczęte" on
      // a lesson that was opened by accident and closed straight away.
      const position = readerPosition(reading);
      if (position !== null) void saveReadingPosition(slug, position);
      track(reading);
    },
    [slug, openLink, acceptFind, track],
  );

  /**
   * Keeps counting while the reader sits still.
   *
   * At the bottom of a lesson no further scroll event ever arrives, and a lesson shorter than
   * the screen fires none at all, so "this text has been on screen for two seconds" has to be
   * able to become true without any movement. It counts only while the lesson is in front of
   * the reader: a lesson left open in a pocket must not earn progress.
   */
  useFocusEffect(
    useCallback(() => {
      // Android keeps JS timers running while the app sits in the background, so pausing on
      // the way out is not enough on its own: the pause drops the first gap, and the ticks
      // after it would credit the rest of the time in the pocket, half a second at a time.
      // Hence the flag as well — the tick has to know the app is in front of the reader.
      // Defaults to counting unless the state is known not to be active, so an unexpected
      // value can't leave a foreground lesson silently earning nothing.
      let active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';

      const tick = setInterval(() => {
        const shown = dwell.current.shown;
        if (active && shown !== null) track(shown);
      }, 500);

      const subscription = AppState.addEventListener('change', (state) => {
        // Same test as the initialisation above, and for the same reason: only a state known
        // to be away from the reader stops the counting.
        active = state !== 'background' && state !== 'inactive';
        if (!active) dwell.current = pause(dwell.current);
      });

      return () => {
        clearInterval(tick);
        subscription.remove();
        dwell.current = pause(dwell.current);
      };
    }, [track]),
  );

  const toggleRead = useCallback(() => {
    const next: ReadingState = readState === 'read' ? 'started' : 'read';
    setReadState(next);
    void setReadingState(slug, next);
    // Marking it read by hand puts the peak at the end, so the tracker has nothing left to
    // raise and won't write over the state that was just chosen.
    // The tracker only ever writes a peak that beats the stored one, so its in-memory copy has
    // to follow the state chosen by hand — otherwise unmarking a lesson would leave the peak at
    // the end and the tracker could never mark it read again.
    dwell.current = newDwell(next === 'read' ? 1 : 0);
    savedPeak.current = next === 'read' ? 1 : 0;
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
          autoFocus={find.focusOnOpen}
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

      <View
        style={[
          styles.footer,
          {
            backgroundColor: theme.surface,
            borderTopColor: theme.border,
            paddingBottom: footerPadding,
          },
        ]}
      >
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
            {
              borderTopColor: theme.border,
              borderTopWidth: sets.length > 0 ? StyleSheet.hairlineWidth : 0,
            },
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
