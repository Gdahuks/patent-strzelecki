import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { FindBar, useFindInPage } from '../../src/components/FindBar';
import { HeaderIcon } from '../../src/components/HeaderIcon';
import { HeaderTitle } from '../../src/components/HeaderTitle';
import { useBottomInset } from '../../src/components/safeArea';
import { Muted } from '../../src/components/ui';
import { findAct, isReadable, sourceDocuments } from '../../src/content/acts';
import {
  type FuturePassage,
  futureScript,
  parseFutureMessage,
} from '../../src/content/futureScript';
import { glossaryScript } from '../../src/content/glossaryScript';
import { openInAppBrowser } from '../../src/content/openSource';
import { findHelpersScript } from '../../src/content/findInPage';
import { applyVersions, dateLabel, unitLabel } from '../../src/content/versions';
import { SCROLL_PROPS } from '../../src/content/webviewProps';
import { parseReadingSample, readingScript } from '../../src/content/readingScript';
import { loadActPosition, saveActPosition } from '../../src/db/reading';
import { lessonCss, useTheme } from '../../src/theme';
import { useSettings } from '../../src/settings/SettingsContext';

/**
 * Script that scrolls to the unit a question's legal basis points to.
 *
 * `ref` comes from a route parameter, and the route is also reachable through a deep link
 * (`patentstrzelecki://act/uobia?ref=…`) — i.e. a value from outside the app. It therefore
 * goes through `JSON.stringify`: inserted raw, it could close the string early and let
 * arbitrary code be appended to the script executed inside the WebView.
 *
 * We compare the attribute in a loop instead of building a `[data-id=…]` selector.
 * `JSON.stringify` produces a **JS string literal**, so its quotes bound the string and never
 * make it into the selector — the result was `[data-id=arti_4]`, a value with no quotes at
 * all. For every unit in the bundle that happens to be a valid CSS identifier this works,
 * but a `ref` starting with a digit, or containing a space, a dot or a `]`, made
 * `querySelector` throw `SyntaxError`, which aborted the whole injected function.
 * The loop has no syntax left to break.
 */
function jumpTo(ref: string): string {
  return `(function () {
  var want = ${JSON.stringify(ref)};
  var units = document.querySelectorAll('[data-id]');
  for (var i = 0; i < units.length; i += 1) {
    if (units[i].getAttribute('data-id') === want) {
      units[i].scrollIntoView({ block: 'start' });
      break;
    }
  }
  true;
})();`;
}

export default function ActScreen() {
  const { slug, ref, q } = useLocalSearchParams<{ slug: string; ref?: string; q?: string }>();
  const theme = useTheme();
  // Same size as in lessons — an act reads the same way as a lesson's text.
  const { contentSize } = useSettings();
  // An act has no footer, so its text runs all the way to the window's bottom edge — and
  // under a three-button navigation bar the last line of a document was unreachable. The
  // inset goes into the page's own CSS, so the text keeps scrolling full-bleed.
  const bottomInset = useBottomInset();
  const webview = useRef<WebView>(null);

  const act = findAct(slug);
  const [startPosition, setStartPosition] = useState<number | null>(null);
  const [showIndex, setShowIndex] = useState(false);
  // A future wording opened in a bottom sheet. Short changes are shown by a tooltip and
  // never reach here — the sheet is for the ones that wouldn't fit inside a tooltip.
  const [passage, setPassage] = useState<FuturePassage | null>(null);
  // Arriving from a search result opens the search bar with the query right away —
  // otherwise the highlight would appear with no visible cause and there'd be no way to
  // jump between hits.
  const find = useFindInPage(webview, q ?? '');

  useEffect(() => {
    let cancelled = false;
    // An act is something you look things up in, so we return exactly where you left off —
    // without the "almost finished" threshold that only makes sense for lessons.
    void loadActPosition(slug).then((position) => {
      if (!cancelled) setStartPosition(ref || q ? 0 : position);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, ref, q]);

  // Choosing a wording, together with the index of units that hold a provision not yet in
  // force: the index is the second surface where an article is visible, and without this it
  // presented one exactly the same way as a binding provision.
  const wordings = useMemo(
    () => (act ? applyVersions(act.html, new Date()) : null),
    // The day is taken when entering the act. An app left open across midnight will keep
    // showing the wording from before it — same as the search screen, which fixes the day
    // when it first warms up the texts.
    [act],
  );

  const page = useMemo(() => {
    if (!act || !wordings) return '';
    return `<!doctype html><html lang="pl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>${lessonCss(theme, contentSize)}
  .unit { margin: 0 0 0.2em; }
  .unit_arti > h3 { margin: 1.5em 0 0.3em; font-size: 1.05em; }
  .unit_chpt > h3 { margin: 2em 0 0.6em; }
  .unit-inner { padding-left: 0; }

  /* A unit smaller than an article stays on the same line as its text — that's how the
     Dziennik Ustaw itself sets it, and a line break before a bare "§ 1." thinned the text
     out until an act left only a few words per screen. Articles and chapters stay on their
     own line, since they structure the document. Nested units (points inside a paragraph)
     stay block-level, so a list doesn't merge into one run of text. */
  .unit:not(.unit_arti):not(.unit_chpt) > h3 { display: inline; font-size: 1em; margin: 0 0.35em 0 0; }
  .unit:not(.unit_arti):not(.unit_chpt) > .unit-inner { display: inline; }
  /* The :not(.unit) exclusion matters here: nested units also carry the pro-text class,
     so without it the points inside a paragraph merged into a single block of text. */
  .unit:not(.unit_arti):not(.unit_chpt) > .unit-inner > .pro-text:not(.unit) { display: inline; }
  /* The registry keeps the sentence and the sanction in separate blocks, with no gap
     between them. */
  .unit-inner > .pro-text:not(.unit) + .pro-text:not(.unit)::before { content: " "; }
  .unit:not(.unit_arti):not(.unit_chpt) { margin-bottom: 0.9em; }

  /* Units sit on a single margin: on a phone, indenting every nesting level would eat into
     the text width, and the numbering already says whose sub-point something is.

     Bullets are a separate problem. With the default list-style-position, the marker is
     drawn OUTSIDE the list's box, and that box starts at the page margin — so the dots
     landed at the screen edge, outside the text column, and increasing the indent didn't
     move them, since it only shifted the text. That's why the marker is moved inside the
     line instead. */
  .unit-inner ul.enum {
    list-style: none;
    padding-left: 0;
    margin: 0.35em 0 0.6em;
  }
  .unit-inner ul.enum li { margin-bottom: 0.35em; }
  /* An entry's text is a block in the registry's markup, so without this the dot ended up
     on its own line above the text. The :not(.unit) exclusion covers a unit nested inside
     the list. */
  .unit-inner ul.enum li .pro-text:not(.unit) { display: inline; }
  .pro-lexlink { color: inherit; }
  /* The registry's own tooltips run on its own stylesheet, which we don't ship —
     without this rule a footnote's text spills straight into the flow of the text. */
  .tooltip-text, .pro-gloss-inner { display: none; }
  abbr.przypis { border-bottom: none; }
  abbr.przypis sup { color: ${theme.accent}; font-weight: 700; }

  /* A reference to a wording not yet in force: a tooltip for a short change (the "skrot"
     class, handled by glossaryScript) and a sheet handle for a longer one. */
  abbr.przyszle, abbr.przyszle-arkusz { border-bottom: none; text-decoration: none; }
  /* sup.przyszle-moc rides the same rule even though it isn't a handle: it's the same
     message class (the date next to a provision), so it has to look the same. It doesn't
     get a touch target and can't get one — nothing opens when it's tapped. */
  abbr.przyszle sup, abbr.przyszle-arkusz sup, sup.przyszle-data, sup.przyszle-moc {
    color: ${theme.accent};
    font-weight: 700;
    white-space: nowrap;
    padding: 0 0.35em;
  }
  /* The sheet handle gets a bit of touch target in the vertical direction too, but less
     than it had when it stood alone on its own line: now it sits inline with the
     provision's text, so lines from the same paragraph run above and below it. The gap
     between lines is 0.62em (line-height 1.62), and the rule from CLAUDE.md says: never
     more than half the gap to the neighbour — otherwise the handle would steal taps from a
     footnote link on the line next to it. The negative margin removes from layout exactly
     what the padding adds, so the lines don't drift apart by half a row. */
  abbr.przyszle-arkusz sup {
    display: inline-block;
    padding: 0.25em 0.35em;
    margin: -0.25em 0;
  }
  /* A unit that was added but hasn't come into force yet stays in the text: hiding it
     would desync the unit index from the content, since a jump from the index would land
     on nothing.

     Italics, not just colour. The date appears once, at the start of the provision, and
     the provision itself can run two screens long (art. 89a of the Code of Petty
     Offences) — a
     reader halfway through it has no way to know it's still a not-yet-effective provision.
     Dimming alone won't say that under deuteranopia, which affects close to 8% of men, a
     group that sits this exact exam; the typeface is visible regardless of colour
     perception. The same rule as the verdict in the ABC quiz. */
  .przyszle-tresc { color: ${theme.muted}; font-style: italic; }
  body { padding-bottom: ${bottomInset}px; }
</style></head><body>${wordings.html}</body></html>`;
  }, [act, wordings, theme, contentSize, bottomInset]);

  const { accept: acceptFind, query: findQuery, rerun: rerunFind } = find;

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (acceptFind(event.nativeEvent.data)) return;

      const future = parseFutureMessage(event.nativeEvent.data);
      if (future) {
        setPassage(future);
        return;
      }

      // An act keeps a bookmark, not progress, so the position is all it takes from a sample.
      const reading = parseReadingSample(event.nativeEvent.data);
      if (reading !== null) void saveActPosition(slug, reading.position);
    },
    [slug, acceptFind],
  );

  // A phrase from search results wins over a unit jump: the highlight scrolls to the first
  // hit on its own, and a unit ref only ever arrives from a question's legal basis, where
  // there's no phrase.
  const onLoaded = useCallback(() => {
    if (findQuery) {
      rerunFind();
      return;
    }
    if (ref) webview.current?.injectJavaScript(jumpTo(ref));
  }, [findQuery, rerunFind, ref]);

  if (!act) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Stack.Screen options={{ title: 'Nie znaleziono' }} />
        <Text style={{ color: theme.muted }}>Tego aktu nie ma w pobranej paczce.</Text>
      </View>
    );
  }

  if (!isReadable(act)) {
    const documents = sourceDocuments(act);
    // Two kinds of textless entries, one list. An act from the Sejm registry has a **base
    // act** surrounded by amendments, so the first entry is highlighted with a filled
    // background and the explanation talks about merging wordings. Rules from outside the
    // registry (ISSF) are independent chapters with no "base plus amending" relationship
    // between them — highlighting the first one there would misrepresent a hierarchy that
    // doesn't exist.
    const fromRegistry = (act.documents?.length ?? 0) === 0;

    return (
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={styles.sourceList}
      >
        <Stack.Screen options={{ title: act.short }} />
        <Text style={[styles.title, { color: theme.text }]}>{act.title}</Text>
        <Muted>
          {fromRegistry
            ? 'Rejestr Sejmu nie ma tekstu jednolitego tego rozporządzenia — są akt bazowy '
              + 'i osobne nowelizacje, wyłącznie jako skany Dziennika Ustaw. Scalenie ich '
              + 'tutaj groziłoby błędnym tekstem prawnym, więc pokazujemy oryginały. '
              + 'Aktualne brzmienie to akt bazowy z uwzględnieniem wszystkich zmian.'
            : 'Przepisy ISSF publikuje Kolegium Sędziów PZSS — po polsku rozdziałami, '
              + 'w całości po angielsku. Czego nie ma po polsku, szukaj w Rule Booku.'}
        </Muted>

        {documents.map((document, position) => {
          const highlighted = fromRegistry && position === 0;
          return (
            <Pressable
              key={document.url}
              onPress={() => openInAppBrowser(document.url, theme)}
              accessibilityRole="button"
              accessibilityLabel={
                `${document.label}. Otwiera ${fromRegistry ? 'skan' : 'dokument'} `
                + 'w przeglądarce, wymaga internetu'
              }
              style={({ pressed }) => [
                styles.button,
                highlighted
                  ? { backgroundColor: theme.accent }
                  : {
                      backgroundColor: theme.surface,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: theme.border,
                    },
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.buttonLabel,
                  styles.documentLabel,
                  { color: highlighted ? theme.onFill : theme.text },
                ]}
              >
                {document.label}
              </Text>
            </Pressable>
          );
        })}

        <Muted>
          {fromRegistry
            ? 'Skany otwierają się w przeglądarce wewnątrz aplikacji. Wymagają internetu.'
            : 'Pliki otwierają się w przeglądarce wewnątrz aplikacji. Wymagają internetu.'}
        </Muted>
      </ScrollView>
    );
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: act.short,
          // The full official title ("Obwieszczenie Ministra… z dnia…") doesn't fit in the
          // header and is nowhere else to be seen once inside the act — tapping the title is
          // the only place it can be shown without adding a line of text above the act.
          headerTitle: () => <HeaderTitle title={act.short} full={act.title} />,
          headerRight: () => (
            <View style={styles.headerActions}>
              {/* An icon instead of the word "Spis" (index): the right-hand group sets the
                  title's available width, so those four letters cost ~90 px here, i.e. a
                  dozen or so characters of the act's name. A list glyph reads unambiguously
                  and sits next to the magnifier, which is already an icon — the set stays
                  consistent. */}
              <HeaderIcon
                name="list"
                label="Spis jednostek"
                expanded={showIndex}
                onPress={() => setShowIndex((open) => !open)}
              />
              <HeaderIcon name="search" label="Szukaj w akcie" onPress={find.toggle} />
            </View>
          ),
        }}
      />

      {find.open ? (
        <FindBar
          placeholder={`Szukaj w ${act.short}`}
          query={find.query}
          state={find.state}
          onChange={find.change}
          onStep={find.step}
          onClose={find.close}
        />
      ) : null}

      {showIndex ? (
        <FlatList
          style={[
            styles.index,
            { backgroundColor: theme.surface, borderBottomColor: theme.border },
          ]}
          data={act.index}
          keyExtractor={(entry) => entry.ref}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => (
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border }} />
          )}
          renderItem={({ item }) => {
            // The same label as the one on a provision in the body text, with the same
            // distinction it draws: the index used to list an article coming into force a
            // year from now exactly like one in force for years, and said nothing at all
            // about an announced change of wording.
            const upcoming = wordings?.units.get(item.ref);
            const label = upcoming ? unitLabel(upcoming) : '';

            return (
              <Pressable
                onPress={() => {
                  webview.current?.injectJavaScript(jumpTo(item.ref));
                  setShowIndex(false);
                }}
                accessibilityRole="link"
                accessibilityLabel={
                  `${item.title}${label ? `, ${label}` : ''}`
                  + `${item.hint ? `. ${item.hint}` : ''}`
                }
                style={({ pressed }) => [styles.indexRow, pressed && styles.pressed]}
              >
                {/* The number and the start of the text together — "Art. 15." on its own
                    doesn't say what it's about. */}
                <View style={styles.indexHeader}>
                  <Text style={[styles.indexTitle, { color: theme.accent }]}>{item.title}</Text>
                  {label ? (
                    <Text style={[styles.indexFuture, { color: theme.critical }]}>
                      {label}
                    </Text>
                  ) : null}
                </View>
                {item.hint ? (
                  <Text style={[styles.indexHint, { color: theme.muted }]} numberOfLines={2}>
                    {item.hint}
                  </Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      ) : null}

      {startPosition === null ? null : (
        <WebView
          ref={webview}
          source={{ html: page }}
          originWhitelist={['*']}
          onMessage={onMessage}
          // A jump from a question's legal basis only works once the content has loaded.
          onLoadEnd={onLoaded}
          injectedJavaScript={
            `${readingScript(startPosition)}\n${findHelpersScript()}\n${glossaryScript()}`
            + `\n${futureScript()}`
          }
          {...SCROLL_PROPS}
          setSupportMultipleWindows={false}
          style={{ backgroundColor: theme.bg }}
        />
      )}

      {/* A bottom sheet, not a separate route: a new file under `app/` breaks the typecheck
          until the dev server has been started, and `make ios`/`make android` chain through
          `tsc` — so the build would silently fail to be produced at all. */}
      <Modal
        visible={passage !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPassage(null)}
      >
        <View style={styles.sheetRoot}>
          {/* The backdrop is the first child, so a screen reader used to start on it instead
              of the sheet's title. The button below and the back gesture already handle
              closing, so the backdrop doesn't need to be an action — and as an action, it
              was the first thing to skip past. */}
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setPassage(null)}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.surface,
                borderTopColor: theme.border,
                paddingBottom: bottomInset + 32,
              },
            ]}
          >
            {/* "Nowe brzmienie" (new wording), not just "Brzmienie": the sheet opens from a
                provision that is in force today, so without that word the title read like an
                announcement that the provision below it was about to lapse. */}
            <Text style={[styles.sheetTitle, { color: theme.text }]}>
              Nowe brzmienie od {passage ? dateLabel(passage.from) : ''}
            </Text>
            {/* Scrolling is essential here, not a nicety: what lands in the sheet is a
                provision that didn't fit inside a tooltip, i.e. as a rule a whole article
                of the code. */}
            <ScrollView style={styles.sheetScroll}>
              <Text style={[styles.sheetText, { color: theme.text }]}>{passage?.content}</Text>
            </ScrollView>
            <Pressable
              onPress={() => setPassage(null)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: theme.accent },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonLabel, { color: theme.onFill }]}>Zamknij</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  // The same as `center`, but inside a scroll container: `flexGrow` centres short content
  // and still lets long content scroll. The ISSF rules list is seven entries plus two
  // paragraphs — at a larger system text size it doesn't fit on a phone screen.
  sourceList: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  button: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 22 },
  // Document names are sometimes a whole sentence ("Dodatkowe wyjaśnienia nowego
  // przepisu…"), so they need to wrap and read centred inside the button.
  documentLabel: { textAlign: 'center' },
  // The text colour is overridden at the point of use instead of `theme.onFill`: in dark
  // mode, white on a light fill has too little contrast.
  buttonLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerButton: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerGlyph: { fontSize: 17, lineHeight: 32, textAlign: 'center' },
  index: { maxHeight: 380, borderBottomWidth: StyleSheet.hairlineWidth },
  indexRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
  indexHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  indexTitle: { fontSize: 14, fontWeight: '700' },
  indexFuture: { fontSize: 12, fontWeight: '700' },
  indexHint: { fontSize: 12, lineHeight: 16 },
  pressed: { opacity: 0.65 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  // The backdrop is dimmed with its own colour, not one from the theme: it covers the
  // screen the same way in both themes, and the theme palette has no translucent colour.
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  sheet: {
    maxHeight: '75%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
    gap: 12,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  // `flexShrink` is essential for scrolling here, not cosmetic: Yoga's default
  // `flexShrink` is 0, so content taller than the sheet would spill past its bottom edge
  // instead of scrolling — exactly the case this sheet was built to handle.
  sheetScroll: { flexShrink: 1 },
  sheetText: { fontSize: 15, lineHeight: 23 },
});
