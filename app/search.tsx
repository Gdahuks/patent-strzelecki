import { Stack, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  InteractionManager,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { announce } from '../src/a11y/announce';
import { LawLink, lawAccessibilityAction, openLaw } from '../src/components/LawLink';
import { useBottomInset } from '../src/components/safeArea';
import { Marked } from '../src/components/Marked';
import { Muted } from '../src/components/ui';
import { type ActHit, searchActs, warmActText } from '../src/content/actSearch';
import { allActs, isReadable } from '../src/content/acts';
import {
  MIN_QUERY_LENGTH,
  type SearchHit,
  search,
  warmLessonText,
} from '../src/content/search';
import { content } from '../src/content/store';
import { startLabel } from '../src/content/versions';
import { useTheme } from '../src/theme';

type Row = SearchHit | ActHit;

/**
 * The delay between the last keystroke and recomputing results.
 *
 * Search runs synchronously during render, so without this, every character froze the
 * thread for the time it takes to sweep through 656 questions and the acts' text. 160 ms is
 * shorter than the gap between characters during ordinary typing, so results still appear
 * to update "as you type".
 */
const SEARCH_DELAY = 160;

/** Polish plural form for a count: 1 trafienie, 2 trafienia, 5 trafień, 12 trafień. */
function hitLabel(count: number): string {
  const last = count % 10;
  const teen = count % 100 >= 12 && count % 100 <= 14;
  if (count === 1) return '1 trafienie';
  if (!teen && last >= 2 && last <= 4) return `${count} trafienia`;
  return `${count} trafień`;
}

/** The same, for acts: 1 akt prawny, 3 akty prawne, 5 aktów prawnych. */
function actLabel(count: number): string {
  if (count === 1) return '1 akt prawny';
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) {
    return `${count} akty prawne`;
  }
  return `${count} aktów prawnych`;
}

export default function SearchScreen() {
  const theme = useTheme();
  const paddingBottom = useBottomInset(32);
  const router = useRouter();
  // Every way out of this screen goes through here. The phrase is typed, so the keyboard is up
  // at the moment a result is tapped, and nothing on the target screen takes it down — it would
  // cover the lower part of the very passage the reader came to see. Leaving it to each call
  // site is how a fourth one would arrive without it.
  const open = (path: Href) => {
    Keyboard.dismiss();
    router.push(path);
  };
  const [query, setQuery] = useState('');
  // The phrase results are actually computed against — trailing the input field by `SEARCH_DELAY`.
  const [phrase, setPhrase] = useState('');

  // Parsing the acts and lessons costs a fraction of a second. We do it after the screen
  // mounts, not on the third character typed, where it would show up as keyboard lag.
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      warmActText(allActs());
      warmLessonText(content.lessons);
    });
    return () => task.cancel();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setPhrase(query), SEARCH_DELAY);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useMemo(
    () => search(content.lessons, content.questions, phrase),
    [phrase],
  );

  const actHits = useMemo(() => searchActs(allActs(), phrase), [phrase]);

  // Lessons, acts, questions: the lecture first, then the primary-source provision, and
  // individual exam questions last — since a broad phrase turns up the most of those.
  const rows: Row[] = useMemo(
    () => [...results.lessons, ...actHits, ...results.questions],
    [results, actHits],
  );

  const total = results.lessons.length + actHits.length + results.questions.length;

  // The question list is capped, so its own length said nothing about anything being cut
  // off: the phrase „broni" matches 458 questions, and the counter showed „60".
  const questionSummary =
    results.questions.length < results.questionTotal
      ? `${results.questions.length} z ${results.questionTotal} w pytaniach`
      : `${results.questions.length} w pytaniach`;

  const summary =
    phrase.trim().length === 0
      ? ''
      : results.tooShort
        ? `Wpisz co najmniej ${MIN_QUERY_LENGTH} znaki`
        : total === 0
          ? 'Brak wyników'
          : `${results.lessons.length} w lekcjach · ${actHits.length} w aktach · ${questionSummary}`;

  // The summary changes in place while typing, so a screen reader stays silent about
  // results. `phrase` sits in the dependency list alongside the content: two different
  // phrases can produce the same message (most often „Brak wyników"), and comparing just
  // the string silenced the second announcement. The separator goes into the announcement
  // as a comma — a screen reader names a middle dot literally.
  useEffect(() => {
    if (summary) announce(summary.replaceAll(' · ', ', '));
  }, [phrase, summary]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <Stack.Screen options={{ title: 'Szukaj' }} />

      <View
        style={[
          styles.searchBar,
          { backgroundColor: theme.surface, borderBottomColor: theme.border },
        ]}
      >
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Fraza z przepisu, pytania albo lekcji"
          placeholderTextColor={theme.muted}
          autoFocus
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.bg, borderColor: theme.border },
          ]}
        />
        {summary ? (
          <Text style={[styles.summary, { color: theme.muted }]}>{summary}</Text>
        ) : null}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) =>
          row.kind === 'lesson'
            ? `l:${row.lesson.slug}`
            : row.kind === 'act'
              ? `a:${row.act.slug}`
              : `q:${row.question.id}`
        }
        contentContainerStyle={[styles.list, { paddingBottom }]}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          phrase.trim().length === 0 ? (
            <View style={styles.hint}>
              <Muted>
                Szukanie obejmuje treść {content.questions.length} pytań wraz z poprawną odpowiedzią
                i podstawą prawną, tekst {content.lessons.length} lekcji oraz{' '}
                {actLabel(allActs().filter(isReadable).length)}. Wielkość liter
                i polskie znaki nie mają znaczenia — „bron" znajdzie „broń".
              </Muted>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === 'lesson') {
            // Zero hits to highlight means the phrase lands in the title, or matches across
            // a markup boundary. The lesson is still worth opening, but without the phrase
            // in the address and without promising to step through hits — that would just
            // find „brak trafień" (no hits).
            const steppable = item.count > 0;

            return (
              <Pressable
                // The phrase travels along with the path: the lesson opens with hits
                // highlighted and scrolls to the first one, instead of to the very top.
                onPress={() =>
                  open(
                    steppable
                      ? `/learn/${item.lesson.slug}?q=${encodeURIComponent(phrase.trim())}`
                      : `/learn/${item.lesson.slug}`,
                  )
                }
                accessibilityRole="button"
                // The kind badge is written in all caps, and a screen reader can spell those
                // out letter by letter ("L, E, K, C, J, A"). The label uses normal casing
                // instead.
                accessibilityLabel={
                  `Lekcja: ${item.lesson.title}`
                  + `${steppable ? `, ${hitLabel(item.count)}` : ''}. ${item.excerpt}`
                }
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.rowHeader}>
                  <Text style={[styles.badge, { color: theme.accent }]}>LEKCJA</Text>
                  {steppable ? (
                    <Text style={[styles.count, { color: theme.muted }]}>
                      {hitLabel(item.count)}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.title, { color: theme.text }]}>{item.lesson.title}</Text>
                <Marked
                  text={item.excerpt}
                  mark={item.mark}
                  style={[styles.excerpt, { color: theme.muted }]}
                />
                <Text style={[styles.hintRow, { color: theme.accent }]}>
                  {steppable ? 'Otwórz i przejdź po trafieniach →' : 'Otwórz lekcję →'}
                </Text>
              </Pressable>
            );
          }

          if (item.kind === 'act') {
            // Same as with a lesson: zero hits to highlight means the phrase matches across
            // a markup boundary — the act is still worth opening, but without the phrase in
            // the address, since in-page search would report „brak trafień" (no hits).
            const steppable = item.count > 0;

            return (
              <Pressable
                // Same as a lesson: the act opens with hits highlighted, scrolled to the
                // first one, and the remaining ones are reached with the arrows.
                onPress={() =>
                  open(
                    steppable
                      ? `/act/${item.act.slug}?q=${encodeURIComponent(phrase.trim())}`
                      : `/act/${item.act.slug}`,
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={
                  `Akt prawny: ${item.act.title}`
                  + `${steppable ? `, ${hitLabel(item.count)}` : ''}`
                  + `${item.future ? `. Przepis ${startLabel(item.future)}` : ''}`
                  + `. ${item.excerpt}`
                }
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.rowHeader}>
                  {/* "AKT", not "USTAWA": one of the three entries is a regulation, not a
                      statute. */}
                  <Text style={[styles.badge, { color: theme.good }]}>AKT</Text>
                  {steppable ? (
                    <Text style={[styles.count, { color: theme.muted }]}>
                      {hitLabel(item.count)}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.title, { color: theme.text }]}>{item.act.title}</Text>
                {/* The date label sits in the act next to the unit, and an excerpt around a
                    hit in § 3 has no reason to include it — without this line, the card
                    presented a not-yet-binding provision exactly like a binding one. The
                    label's wording matches the act and the table of contents: the card only
                    ever shows hits in provisions that don't exist yet (a currently-binding
                    provision's future wording lives in an attribute, so it never reaches the
                    search index), so it's always „wejdzie w życie" (comes into force). */}
                {item.future ? (
                  <Text style={[styles.future, { color: theme.critical }]}>
                    Przepis {startLabel(item.future)}
                  </Text>
                ) : null}
                <Marked
                  text={item.excerpt}
                  mark={item.mark}
                  style={[styles.excerpt, { color: theme.muted }]}
                />
                <Text style={[styles.hintRow, { color: theme.accent }]}>
                  {steppable ? 'Otwórz i przejdź po trafieniach →' : 'Otwórz akt →'}
                </Text>
              </Pressable>
            );
          }

          const lesson = item.question.lesson ? content.lesson(item.question.lesson) : undefined;
          const correct = item.question.answers[item.question.correct] ?? '';
          const lawAction = lawAccessibilityAction(item.question.law);
          // The row is only disabled once it leads nowhere at all: no lesson and no legal
          // basis. A missing lesson alone can't disable it, because on a `disabled` element
          // the platform can refuse to run a rotor action — and opening the act is sometimes
          // the row's only remaining action.
          const inert = !lesson && !lawAction;

          return (
            <Pressable
              disabled={inert}
              onPress={() =>
                lesson &&
                open(`/learn/${lesson.slug}?q=${encodeURIComponent(phrase.trim())}`)
              }
              accessibilityRole="button"
              // The legal basis is a separate, tappable element nested inside this row, and
              // a container's own label replaces the text assembled from its children —
              // without this, it dropped out of what got read.
              accessibilityLabel={
                `Pytanie: ${item.question.question}. `
                + `Poprawna odpowiedź: ${correct}`
                + `${item.question.law ? `. Podstawa prawna: ${item.question.law}` : ''}`
                + `${lesson ? `. Otwiera lekcję ${lesson.title}` : ''}`
              }
              accessibilityState={{ disabled: inert }}
              // The label above rescues the legal basis's **content**, but not the action:
              // a merged `Pressable` doesn't hand focus down to the nested `LawLink`. The
              // action comes back as a rotor action — the same way as in the question-review
              // row.
              accessibilityActions={lawAction ? [lawAction] : undefined}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'law' && item.question.law) {
                  openLaw(item.question.law, router, theme);
                }
              }}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: theme.surface, borderColor: theme.border },
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.rowHeader}>
                <Text style={[styles.badge, { color: theme.muted }]}>PYTANIE</Text>

              </View>
              <Marked
                text={item.question.question}
                mark={item.questionMark}
                style={[styles.title, { color: theme.text }]}
              />
              <Marked
                text={correct}
                mark={item.answerMark}
                style={[styles.answer, { color: theme.good }]}
              />
              {item.question.law ? <LawLink law={item.question.law} /> : null}
              {lesson ? (
                <Text style={[styles.excerpt, { color: theme.accent }]}>{lesson.title} →</Text>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchBar: { padding: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
  },
  summary: { fontSize: 12, paddingHorizontal: 2 },
  list: { padding: 12, gap: 10, paddingBottom: 32 },
  hint: { padding: 8 },
  row: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 5,
  },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  count: { fontSize: 11 },
  title: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  answer: { fontSize: 14, lineHeight: 20 },
  excerpt: { fontSize: 13, lineHeight: 19 },
  future: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  hintRow: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  pressed: { opacity: 0.7 },
});
