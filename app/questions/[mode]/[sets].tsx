import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { LawLink, lawAccessibilityAction, openLaw } from '../../../src/components/LawLink';
import { useBottomInset } from '../../../src/components/safeArea';
import { Muted } from '../../../src/components/ui';
import { WEAK_SET_SLUG, content } from '../../../src/content/store';
import type { Question } from '../../../src/content/types';
import {
  type PracticeMode,
  loadCards,
  resetProgress,
  saveCard,
  weakQuestionIds,
} from '../../../src/db/database';
import type { Card } from '../../../src/engine/leitner';
import { plural } from '../../../src/engine/plural';
import {
  type CardState,
  cardLabel,
  cardState,
  groupByState,
  markMastered,
  markNeedsWork,
  stateLabel,
} from '../../../src/engine/questionList';
import { useSettings } from '../../../src/settings/SettingsContext';
import { useTheme } from '../../../src/theme';

/**
 * A set's question list, split by state.
 *
 * The "moje błędy" (my mistakes) set shows mistakes but doesn't let you review them as a
 * whole or see what's still untouched. This screen is for browsing, not quizzing: a question
 * expands on tap, and its state can be corrected by hand when the recorded progress doesn't
 * match what's actually known.
 */
export default function QuestionListScreen() {
  const params = useLocalSearchParams<{ mode: string; sets: string }>();
  const mode: PracticeMode = params.mode === 'flashcards' ? 'flashcards' : 'test';
  const setSlugs = useMemo(() => params.sets.split(',').filter(Boolean), [params.sets]);
  const isWeak = setSlugs.length === 1 && setSlugs[0] === WEAK_SET_SLUG;

  const theme = useTheme();
  const router = useRouter();
  const paddingBottom = useBottomInset(32);
  const { levels } = useSettings();

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [cards, setCards] = useState<Map<string, Card>>(new Map());
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const pool = isWeak
        ? content.questionsByIds(await weakQuestionIds(mode))
        : content.questionsForSets(setSlugs);
      if (cancelled) return;

      const known = await loadCards(
        pool.map((question) => question.id),
        mode,
      );
      if (cancelled) return;

      setQuestions(pool);
      setCards(known);
    })();

    return () => {
      cancelled = true;
    };
  }, [setSlugs, isWeak, mode]);

  const sections = useMemo(() => {
    if (!questions) return [];
    const ids = questions.map((question) => question.id);
    return groupByState(ids, cards, levels).map((group) => ({
      state: group.state,
      title: stateLabel(group.state),
      data: group.questionIds,
    }));
  }, [questions, cards, levels]);

  /** The write goes to the database, and the card map is swapped so the row switches section right away. */
  const apply = useCallback(
    (questionId: string, next: Card | null) => {
      setCards((previous) => {
        const copy = new Map(previous);
        if (next) copy.set(questionId, next);
        else copy.delete(questionId);
        return copy;
      });

      if (next) void saveCard(next, mode);
      else void resetProgress([questionId], mode);
    },
    [mode],
  );

  const colorFor = (state: CardState): string =>
    state === 'needsWork'
      ? theme.bad
      : state === 'learning'
        ? theme.accent
        : state === 'mastered'
          ? theme.good
          : theme.muted;

  const title = content.titleForSets(setSlugs);

  if (!questions) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Stack.Screen options={{ title }} />
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(id) => id}
      contentContainerStyle={[styles.list, { paddingBottom }]}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={[styles.heading, { color: theme.text }]}>{title}</Text>
          <Muted>
            {questions.length} {plural(questions.length, 'pytanie', 'pytania', 'pytań')} w trybie{' '}
            {mode === 'flashcards' ? 'fiszek' : 'testu ABC'}.
            Dotknij pytania, żeby zobaczyć odpowiedź i poprawić jego stan.
          </Muted>
        </View>
      }
      ListEmptyComponent={
        <Muted>
          {isWeak
            ? 'Nie masz jeszcze pomyłek w tym trybie.'
            : 'Ten zestaw nie zawiera pytań.'}
        </Muted>
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colorFor(section.state) }]}>
            {section.title}
          </Text>
          <Text style={[styles.sectionCount, { color: theme.muted }]}>
            {section.data.length}
          </Text>
        </View>
      )}
      renderItem={({ item: id, section }) => {
        const question = content.question(id);
        if (!question) return null;

        const card = cards.get(id);
        const open = openId === id;
        const lesson = question.lesson ? content.lesson(question.lesson) : undefined;
        const lawAction = lawAccessibilityAction(question.law);

        return (
          <Pressable
            onPress={() => setOpenId(open ? null : id)}
            accessibilityRole="button"
            // The dot on the left carries the state through colour alone. That's enough for
            // a sighted user, since the section header with the same name sits right next to
            // it — but a screen reader reads a row in isolation from its header, so the state
            // has to be in the label.
            //
            // The label **must** enumerate the row's entire visible content. A container's
            // own label replaces the text assembled from its children, so a shorter version
            // silenced the correct answer and the progress caption — the very reason the row
            // expands in the first place.
            accessibilityLabel={
              `${stateLabel(section.state)}. ${question.question}. ${cardLabel(card, levels)}`
              + (open ? `. Poprawna odpowiedź: ${question.answers[question.correct] ?? ''}` : '')
            }
            accessibilityState={{ expanded: open }}
            // The state-correction buttons, the legal-basis link and the lesson link all sit
            // inside this row, and a `Pressable` is a single accessibility element by
            // default — on iOS, VoiceOver merges it into one and the nested elements become
            // unreachable. Exposing the same actions through `accessibilityActions` puts them
            // on the rotor, so they stay reachable despite the merge. The action order
            // mirrors the order the elements appear on screen.
            accessibilityActions={
              open
                ? [
                    ...(lawAction ? [lawAction] : []),
                    ...(lesson ? [{ name: 'lesson', label: `Otwórz lekcję: ${lesson.title}` }] : []),
                    ...(cardState(card, levels) === 'needsWork'
                      ? []
                      : [{ name: 'needsWork', label: 'Oznacz jako do poprawy' }]),
                    ...(cardState(card, levels) === 'mastered'
                      ? []
                      : [{ name: 'mastered', label: 'Oznacz jako opanowane' }]),
                    ...(card ? [{ name: 'reset', label: 'Wyzeruj postęp pytania' }] : []),
                  ]
                : undefined
            }
            onAccessibilityAction={(event) => {
              const action = event.nativeEvent.actionName;
              if (action === 'law' && question.law) openLaw(question.law, router, theme);
              else if (action === 'lesson' && lesson) router.push(`/learn/${lesson.slug}`);
              else if (action === 'needsWork') apply(id, markNeedsWork(id, card));
              else if (action === 'mastered') apply(id, markMastered(id, card, levels));
              else if (action === 'reset') apply(id, null);
            }}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: theme.surface, borderColor: theme.border },
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.rowHeader}>
              <View style={[styles.dot, { backgroundColor: colorFor(section.state) }]} />
              <Text
                style={[styles.question, { color: theme.text }]}
                numberOfLines={open ? undefined : 2}
              >
                {question.question}
              </Text>
            </View>

            <Text style={[styles.meta, { color: theme.muted }]}>{cardLabel(card, levels)}</Text>

            {open ? (
              <View style={styles.details}>
                {/* No letter: flashcards don't have variants, and in the quiz the order is
                    shuffled, so the letter from the source means nothing here. */}
                <Text style={[styles.answer, { color: theme.good }]}>
                  {question.answers[question.correct]}
                </Text>

                {question.law ? <LawLink law={question.law} /> : null}

                {lesson ? (
                  <Pressable
                    onPress={() => router.push(`/learn/${lesson.slug}`)}
                    // Gaps in the expanded row are 7 px, and the row itself is tappable, so
                    // a hit area bigger than half the gap would steal taps from collapsing it.
                    hitSlop={{ top: 3, bottom: 3, left: 4, right: 4 }}
                    accessibilityRole="link"
                    accessibilityLabel={`Otwórz lekcję: ${lesson.title}`}
                  >
                    <Text style={{ color: theme.accent, fontSize: 13 }}>
                      Lekcja: {lesson.title} →
                    </Text>
                  </Pressable>
                ) : null}

                {/* A manual state fix — for questions you know despite the recorded progress,
                    or the other way around. Visible buttons, because a hidden gesture would
                    be undiscoverable. */}
                <View style={styles.actions}>
                  {cardState(card, levels) === 'needsWork' ? null : (
                    <Pressable
                      onPress={() => apply(id, markNeedsWork(id, card))}
                      accessibilityRole="button"
                      accessibilityLabel="Oznacz jako do poprawy"
                      // Above sits a tappable lesson link 7 px away; below is just the card's
                      // own padding — hence the asymmetric widening instead of an even one.
                      hitSlop={{ top: 3, bottom: 8, left: 4, right: 4 }}
                      style={({ pressed }) => [
                        styles.action,
                        { borderColor: theme.bad },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.actionLabel, { color: theme.bad }]}>Do poprawy</Text>
                    </Pressable>
                  )}

                  {cardState(card, levels) === 'mastered' ? null : (
                    <Pressable
                      onPress={() => apply(id, markMastered(id, card, levels))}
                      accessibilityRole="button"
                      accessibilityLabel="Oznacz jako opanowane"
                      hitSlop={{ top: 3, bottom: 8, left: 4, right: 4 }}
                      style={({ pressed }) => [
                        styles.action,
                        { borderColor: theme.good },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.actionLabel, { color: theme.good }]}>Opanowane</Text>
                    </Pressable>
                  )}

                  {card ? (
                    <Pressable
                      onPress={() => apply(id, null)}
                      accessibilityRole="button"
                      accessibilityLabel="Wyzeruj postęp tego pytania"
                      hitSlop={{ top: 3, bottom: 8, left: 4, right: 4 }}
                      style={({ pressed }) => [
                        styles.action,
                        { borderColor: theme.border },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.actionLabel, { color: theme.muted }]}>Wyzeruj</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { gap: 8, marginBottom: 6 },
  heading: { fontSize: 22, fontWeight: '700' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 18,
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionCount: { fontSize: 13, fontWeight: '600' },
  row: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    gap: 5,
    marginBottom: 8,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  question: { fontSize: 15, lineHeight: 21, flex: 1 },
  meta: { fontSize: 11, marginLeft: 17 },
  details: { gap: 7, marginTop: 4, marginLeft: 17 },
  answer: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 2, flexWrap: 'wrap' },
  action: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 11, paddingVertical: 7 },
  actionLabel: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.65 },
});
