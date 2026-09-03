import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useBottomInset } from '../../src/components/safeArea';
import { Card, Muted } from '../../src/components/ui';
import { category } from '../../src/content/categories';
import { content } from '../../src/content/store';
import { type PracticeMode, areaStandings, loadCards } from '../../src/db/database';
import { type Card as ProgressCard, createDeck, deckProgress } from '../../src/engine/leitner';
import { examProfile } from '../../src/engine/exam';
import { plural } from '../../src/engine/plural';
import { useSettings } from '../../src/settings/SettingsContext';
import { useTheme } from '../../src/theme';

/**
 * One subject area of the exam: how it stands, and the ways into it.
 *
 * This screen exists because the diagnosis on the exam screen used to open a quiz question
 * straight away, and that jump hid two things behind one tap. The exam counts **distinct
 * questions it has asked, by their latest verdict**; practice counts **Leitner buckets per
 * mode**. Both render as a percentage of the same area, and they mean different things — so
 * "0/3" turning into "24 untouched" on the next screen read like a bug. Here both are named,
 * side by side, and going on to answer questions is a choice rather than a side effect.
 *
 * A practice row is state *and* the way in: it opens exactly the questions its numbers
 * describe, so the arrow needs no explaining. The exam row is neither — an exam is composed
 * from all five areas at once, so there is nothing here to open, and the row shows its state
 * only. What the exam leaves behind, its mistakes, is a different action on a different set of
 * questions, and it sits below the card with the other action rather than inside a row. That
 * row used to carry it as "powtórz 6 →", which made one row of three two lines tall and the
 * odd one out for doing something the others don't.
 */
export default function AreaScreen() {
  const params = useLocalSearchParams<{ slug: string; profile?: string }>();
  const slug = params.slug;
  const profile = examProfile(params.profile);

  const router = useRouter();
  const { levels } = useSettings();
  const paddingBottom = useBottomInset(28);

  const questions = content.questionsForSets([slug]);
  const ids = questions.map((question) => question.id);
  const entry = category(slug);

  /** Course sets the area is made of — shown only when it is more than one. */
  const composition = (entry?.setSlugs ?? [])
    .map((setSlug) => content.set(setSlug)?.title)
    .filter((title): title is string => title !== undefined);

  const [exam, setExam] = useState({ seen: 0, correct: 0, mistakes: 0 });
  type Tally = { mastered: number; untouched: number };
  const [practice, setPractice] = useState<Record<PracticeMode, Tally>>({
    flashcards: { mastered: 0, untouched: 0 },
    test: { mastered: 0, untouched: 0 },
  });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const standings = await areaStandings(profile.id);
        const cards = await Promise.all(
          (['flashcards', 'test'] as PracticeMode[]).map((mode) => loadCards(ids, mode)),
        );
        if (cancelled) return;

        const tally = standings.areas.get(slug) ?? { seen: 0, correct: 0, missed: [] };
        setExam({ seen: tally.seen, correct: tally.correct, mistakes: tally.missed.length });
        setPractice({
          flashcards: summarize(ids, cards[0], levels),
          test: summarize(ids, cards[1], levels),
        });
      })();

      return () => {
        cancelled = true;
      };
      // `ids` is derived from the slug and stable for it, so the slug alone says when to reload.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug, profile.id, levels]),
  );

  return (
    <ScrollView contentContainerStyle={[styles.body, { paddingBottom }]}>
      <Stack.Screen options={{ title: content.titleForSets([slug]) }} />

      <Muted>
        {questions.length} {plural(questions.length, 'pytanie', 'pytania', 'pytań')}
        {composition.length > 1 ? ` · ${composition.join(' + ')}` : ''}
      </Muted>

      <Card>
        <Row
          label="Na egzaminach"
          value={
            exam.seen > 0
              ? `pytano o ${exam.seen} · ${exam.correct} poprawnie`
              : 'jeszcze nie pytano'
          }
        />
        <Row
          label="Fiszki"
          value={`opanowane ${practice.flashcards.mastered} · nietknięte ${practice.flashcards.untouched}`}
          onPress={() => router.push(`/practice/flashcards/${slug}`)}
        />
        <Row
          label="Test ABC"
          value={`opanowane ${practice.test.mastered} · nietknięte ${practice.test.untouched}`}
          onPress={() => router.push(`/practice/test/${slug}`)}
        />
      </Card>

      <View>
        {/* Flashcards rather than the quiz: a question you got wrong is one whose answer you
            don't know yet, and that is what a flashcard is for. Gone entirely at zero — there
            is nothing to repeat, and a disabled line would only invite a tap. */}
        {exam.mistakes > 0 ? (
          <Action
            label={`Powtórz ${exam.mistakes} ${plural(exam.mistakes, 'pomyłkę', 'pomyłki', 'pomyłek')}`}
            onPress={() => router.push(`/practice/flashcards/${slug}?bledy=${profile.id}`)}
          />
        ) : null}
        <Action label="Przejrzyj pytania" onPress={() => router.push(`/questions/test/${slug}`)} />
      </View>
    </ScrollView>
  );
}

/** One thing this screen can do, under the card of what it knows. */
function Action({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Text style={{ color: theme.accent, fontSize: 14 }}>{label} →</Text>
    </Pressable>
  );
}

function Row({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const theme = useTheme();

  const leads = onPress !== undefined;

  return (
    <Pressable
      onPress={onPress}
      disabled={!leads}
      accessibilityRole={leads ? 'button' : undefined}
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [styles.row, pressed && leads && styles.pressed]}
    >
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <View style={styles.values}>
        <Text style={[styles.value, { color: theme.muted }]}>
          {value}
          {/* The arrow marks the row as a way in — the same affordance the rest of the app
              uses. The exam row has none, because it isn't one. */}
          {leads ? <Text style={{ color: theme.accent }}>{'  →'}</Text> : null}
        </Text>
      </View>
    </Pressable>
  );
}

/** Mastered and untouched counts for one mode, by the same rules as the practice list. */
function summarize(
  ids: string[],
  cards: Map<string, ProgressCard>,
  levels: number,
): { mastered: number; untouched: number } {
  const progress = deckProgress(createDeck(ids, cards, levels));
  return { mastered: progress.mastered, untouched: progress.untouched };
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingVertical: 10 },
  pressed: { opacity: 0.65 },
  label: { flex: 1, fontSize: 15, fontWeight: '600' },
  values: { alignItems: 'flex-end' },
  value: { fontSize: 13 },
  action: { alignSelf: 'flex-start', paddingVertical: 8 },
});
