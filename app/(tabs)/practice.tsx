import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Muted, SegmentedBar } from '../../src/components/ui';
import { WEAK_SET_SLUG, WEAK_SET_TITLE, content } from '../../src/content/store';
import {
  type PracticeMode,
  loadCards,
  resetProgress,
  weakQuestionIds,
} from '../../src/db/database';
import { createDeck, deckProgress } from '../../src/engine/leitner';
import { plural } from '../../src/engine/plural';
import { useSettings } from '../../src/settings/SettingsContext';
import { useTheme } from '../../src/theme';

interface Row {
  slug: string;
  title: string;
  /** Set's question ids — for the review screen and for resetting without re-querying the database. */
  ids: string[];
  count: number;
  /** 0..1 — how far along toward mastery; for the percentage label. */
  ratio: number;
  untouched: number;
  needsWork: number;
  learning: number;
  mastered: number;
  /** The mistakes set is measured differently: what counts is leaving the zero bucket. */
  weak: boolean;
}

const MODES: { key: PracticeMode; label: string }[] = [
  { key: 'flashcards', label: 'Fiszki' },
  { key: 'test', label: 'Test ABC' },
];

export default function CwiczeniaScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { levels } = useSettings();

  // Progress is separate per mode, so the list shows the one currently selected. It used to
  // be shared, and a separate "Postęp" tab duplicated the same list of sets.
  const [mode, setMode] = useState<PracticeMode>('flashcards');
  const [rows, setRows] = useState<Row[] | null>(null);
  /** Bumping this recalculates the list without leaving the screen — after resetting a set. */
  const [reload, setReload] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const cards = await loadCards(
          content.questions.map((question) => question.id),
          mode,
        );
        const weakIds = await weakQuestionIds(mode);
        if (cancelled) return;

        const sets: Row[] = content.sets.map((set) => {
          const progress = deckProgress(createDeck(set.questionIds, cards, levels));
          return {
            slug: set.slug,
            title: set.title,
            ids: set.questionIds,
            count: progress.total,
            ratio: progress.ratio,
            untouched: progress.untouched,
            needsWork: progress.needsWork,
            learning: progress.learning,
            mastered: progress.mastered,
            weak: false,
          };
        });

        if (weakIds.length > 0) {
          const progress = deckProgress(createDeck(weakIds, cards, levels));
          sets.unshift({
            slug: WEAK_SET_SLUG,
            title: WEAK_SET_TITLE,
            ids: weakIds,
            count: weakIds.length,
            ratio: progress.clearedRatio,
            untouched: 0,
            needsWork: progress.needsWork,
            learning: progress.learning,
            mastered: progress.mastered,
            weak: true,
          });
        }

        setRows(sets);
      })();

      return () => {
        cancelled = true;
      };
    }, [mode, levels, reload]),
  );

  /**
   * The menu triggered by long-pressing a set.
   *
   * A tap starts the exercise, so review and reset need another way in — and the labels in
   * the row are too small to turn into separate touch targets on their own. This is the same
   * gesture used to change a lesson's state in Nauka.
   */
  const onLongPress = useCallback(
    (row: Row) => {
      const questions = `${row.count} ${plural(row.count, 'pytanie', 'pytania', 'pytań')}`;

      Alert.alert(row.title, `${questions} w tym trybie.`, [
        {
          text: 'Przejrzyj pytania',
          onPress: () => router.push(`/questions/${mode}/${row.slug}`),
        },
        {
          text: 'Wyzeruj postęp tego zestawu',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Wyzerować postęp?',
              // Both the noun and the verb inflect: "22 pytania wrócą", but "25 pytań wróci".
              `${questions} ${plural(row.count, 'wróci', 'wrócą', 'wróci')} do stanu nietkniętego w trybie ${
                mode === 'flashcards' ? 'fiszek' : 'testu ABC'
              }. Tej operacji nie da się cofnąć.`,
              [
                { text: 'Anuluj', style: 'cancel' },
                {
                  text: 'Wyzeruj',
                  style: 'destructive',
                  onPress: () => {
                    void resetProgress(row.ids, mode).then(() =>
                      setReload((value) => value + 1),
                    );
                  },
                },
              ],
            ),
        },
        { text: 'Anuluj', style: 'cancel' },
      ]);
    },
    [mode, router],
  );

  return (
    <FlatList
      data={rows ?? []}
      keyExtractor={(row) => row.slug}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={[styles.heading, { color: theme.text }]}>Ćwiczenia</Text>

          <View style={[styles.switch, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {MODES.map((entry) => {
              const active = entry.key === mode;
              return (
                <Pressable
                  key={entry.key}
                  onPress={() => setMode(entry.key)}
                  accessibilityRole="tab"
                  // The selected mode is shown purely through the background fill — without
                  // this state, a screen reader announces two identical options and there's
                  // no way to tell which list you're actually looking at.
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.switchOption,
                    active && { backgroundColor: theme.accent },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.switchLabel,
                      { color: active ? theme.onFill : theme.text },
                    ]}
                  >
                    {entry.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Muted>
            {mode === 'flashcards'
              ? 'Fiszka pokazuje poprawną odpowiedź — chodzi o zapamiętanie jej treści.'
              : 'Test sprawdza, czy rozpoznajesz poprawną odpowiedź wśród trzech wariantów.'}{' '}
            Postęp jest liczony osobno dla każdego trybu. Przytrzymaj zestaw, żeby przejrzeć
            jego pytania albo wyzerować postęp.
          </Muted>
        </View>
      }
      ListEmptyComponent={rows === null ? <Muted>Liczę postęp…</Muted> : null}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/practice/${mode}/${item.slug}`)}
          onLongPress={() => onLongPress(item)}
          accessibilityRole="button"
          // The row is five separate labels plus a bar — a screen reader would read them as
          // a string of numbers with no announcement of what set they belong to. The
          // accessibility label turns it into a sentence.
          accessibilityLabel={
            `${item.title}. ${item.count} pytań, ${Math.round(item.ratio * 100)} procent. `
            + `Do poprawy ${item.needsWork}, w trakcie ${item.learning}, opanowane ${item.mastered}`
            + `${item.weak ? '' : `, nietknięte ${item.untouched}`}`
          }
          // Long-pressing is the only way to review questions and reset a set, and for a
          // screen reader that gesture is practically nonexistent — VoiceOver and TalkBack
          // have it claimed for their own purposes. This action exposes the same menu in the
          // rotor.
          accessibilityActions={[{ name: 'longpress', label: 'Przegląd i zerowanie zestawu' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'longpress') onLongPress(item);
          }}
          style={({ pressed }) => [
            styles.row,
            {
              backgroundColor: theme.surface,
              borderColor: item.weak ? theme.bad : theme.border,
              borderWidth: item.weak ? 1 : StyleSheet.hairlineWidth,
            },
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.rowHeader}>
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[styles.percent, { color: theme.muted }]}>
              {Math.round(item.ratio * 100)}%
            </Text>
          </View>

          {/* The bar shows the whole distribution, not just the average: from questions
              needing work, through untouched and in-progress, to mastered. */}
          <SegmentedBar
            segments={[
              { value: item.needsWork, color: theme.bad },
              { value: item.learning, color: theme.accent },
              { value: item.mastered, color: theme.good },
              { value: item.untouched, color: theme.border },
            ]}
          />

          <Text style={[styles.detail, { color: theme.muted }]}>
            {item.count} {plural(item.count, 'pytanie', 'pytania', 'pytań')}
            {item.weak ? ' z pomyłkami' : ''}
          </Text>
          <Text style={[styles.detail, { color: theme.muted }]}>
            <Text style={{ color: theme.bad }}>do poprawy {item.needsWork}</Text>
            {'  ·  '}
            <Text style={{ color: theme.accent }}>w trakcie {item.learning}</Text>
            {'  ·  '}
            <Text style={{ color: theme.good }}>opanowane {item.mastered}</Text>
            {item.weak ? '' : `  ·  nietknięte ${item.untouched}`}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  header: { gap: 10, marginBottom: 6 },
  heading: { fontSize: 26, fontWeight: '700' },
  switch: {
    flexDirection: 'row',
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  switchOption: { flex: 1, borderRadius: 9, paddingVertical: 9, alignItems: 'center' },
  switchLabel: { fontSize: 15, fontWeight: '600' },
  row: { borderRadius: 14, padding: 16, gap: 8 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: 10 },
  percent: { fontSize: 14, fontWeight: '600' },
  detail: { fontSize: 12 },
  pressed: { opacity: 0.65 },
});
