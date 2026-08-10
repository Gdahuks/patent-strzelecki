import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';

import { Card, Muted, Title } from '../../src/components/ui';
import {
  allActs,
  driftCount,
  externalActs,
  isReadable,
  needsSourceList,
  sourceLabels,
  sourceUrl,
} from '../../src/content/acts';
import { openInAppBrowser } from '../../src/content/openSource';
import { content } from '../../src/content/store';
import type { Lesson } from '../../src/content/types';
import {
  type Reading,
  clearReading,
  loadAllReading,
  readingLabel,
  setReadingState,
} from '../../src/db/reading';
import { plural } from '../../src/engine/plural';
import { formatDay } from '../../src/engine/dates';
import { useTheme } from '../../src/theme';

export default function NaukaScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [reading, setReading] = useState<Map<string, Reading>>(new Map());

  const refresh = useCallback(() => {
    void loadAllReading().then(setReading);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadAllReading().then((all) => {
        if (!cancelled) setReading(all);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  /**
   * Long-pressing a lesson changes its reading state. A separate clear action is needed here
   * because just opening a lesson sets it to "started" — and opening one by accident
   * shouldn't leave a trace.
   */
  const onLongPress = useCallback(
    (lesson: Lesson, state: Reading | undefined) => {
      const buttons: Parameters<typeof Alert.alert>[2] = [{ text: 'Anuluj', style: 'cancel' }];

      buttons.push(
        state?.state === 'read'
          ? {
              text: 'Oznacz jako nieprzeczytane',
              onPress: () => void setReadingState(lesson.slug, 'started').then(refresh),
            }
          : {
              text: 'Oznacz jako przeczytane',
              onPress: () => void setReadingState(lesson.slug, 'read').then(refresh),
            },
      );

      if (state) {
        buttons.push({
          text: 'Wyczyść stan',
          style: 'destructive',
          onPress: () => void clearReading(lesson.slug).then(refresh),
        });
      }

      // Branching on the label itself, not on `state`: `readingLabel` returns null exactly
      // when there's no state, so the condition is the same either way — but without
      // interpolating into the string a value the type allows to be null.
      const label = readingLabel(state);

      Alert.alert(
        lesson.title,
        label
          ? `Stan: ${label}. Wyczyszczenie usuwa też zapamiętane miejsce czytania.`
          : 'Lekcja jeszcze nietknięta.',
        buttons,
      );
    },
    [refresh],
  );

  const read = [...reading.values()].filter((entry) => entry.state === 'read').length;

  return (
    <FlatList
      data={content.lessons}
      keyExtractor={(lesson) => lesson.slug}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={[styles.heading, { color: theme.text }]}>Spis treści</Text>
          <Muted>
            Kurs teoretyczny na patent strzelecki PZSS. Materiał w całości offline —
            {' '}{content.questions.length} pytań i {content.lessons.length} lekcji.
          </Muted>
          {read > 0 ? (
            <Muted>
              Przeczytane {read} z {content.lessons.length}.
            </Muted>
          ) : null}
          <Muted>Przytrzymaj lekcję, żeby zmienić lub wyczyścić jej stan.</Muted>
        </View>
      }
      ListFooterComponent={
        <View style={styles.acts}>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <Text style={[styles.actsHeading, { color: theme.text }]}>Akty prawne</Text>
          <Muted>
            Źródła, na których stoi kurs. Otwierają się w miejscu, w którym skończyłeś —
            bez liczenia postępu, bo do ustawy się zagląda.
          </Muted>

          {allActs()
            .filter(isReadable)
            .map((act) => (
              <Card key={act.slug} onPress={() => router.push(`/act/${act.slug}`)}>
                <Title>{act.short}</Title>
                <Muted>{act.title}</Muted>
                {/* No "full text in the app" wording here: the section headings already
                    separate one group from the other, so repeating it on every row would
                    just be noise. */}
                <Text style={[styles.actMeta, { color: theme.good }]}>
                  {act.index.length}{' '}
                  {act.index.some((entry) => entry.kind === 'para')
                    ? plural(act.index.length, 'paragraf', 'paragrafy', 'paragrafów')
                    : plural(act.index.length, 'artykuł', 'artykuły', 'artykułów')}
                  {' · stan na '}
                  {formatDay(act.changed)}
                </Text>
                {/* An amendment passed after the consolidated text's date never made it in.
                    The date alone doesn't say that — without this line a learner would see
                    "stan na 07.12.2023" with no sign that eight changes are missing from
                    this text.

                    "nowelizacji" is left undeclined on purpose: after a negated verb the
                    object takes the genitive case, and that form is the same for 1, 2 and 8.

                    When there's no drift, this same spot shows the list of amendments that
                    were absorbed instead. Silence isn't a substitute for the warning here:
                    "stan na" (as of) with no word on what that state rests on reads
                    identically whether the text is complete or nobody ever checked. */}
                {driftCount(act) > 0 ? (
                  <Text style={[styles.actMeta, { color: theme.critical }]}>
                    nie obejmuje {driftCount(act)} nowelizacji po tej dacie
                  </Text>
                ) : sourceLabels(act).length > 0 ? (
                  <Text style={[styles.actMeta, { color: theme.muted }]}>
                    na podstawie: {sourceLabels(act).join(', ')}
                  </Text>
                ) : null}
              </Card>
            ))}

          {/* Separate and clearly marked: these lead out of the app and need the internet.
              Without the split, there'd be no way to tell what stays inside from what
              doesn't. */}
          <Text style={[styles.actsSubheading, { color: theme.muted }]}>
            Nie offline — podgląd w aplikacji, wymaga internetu
          </Text>
          {externalActs().map((act) => (
            <Card
              key={act.slug}
              onPress={() =>
                needsSourceList(act)
                  ? router.push(`/act/${act.slug}`)
                  : openInAppBrowser(sourceUrl(act), theme)
              }
            >
              <Title>{act.short} ↗</Title>
              {act.title !== act.short ? <Muted>{act.title}</Muted> : null}
              <Text style={[styles.actMeta, { color: theme.muted }]}>
                {!act.eli
                  ? // The document count signals that this card leads to a list, not a
                    // single file — without it the ISSF rules would look like the plain
                    // external link they used to be. When discovery falls back to the
                    // backup address, there's no list, and the card tells the truth about
                    // itself again.
                    act.documents?.length
                    ? `nie jest aktem prawnym · ${act.documents.length} ${plural(
                        act.documents.length,
                        'dokument',
                        'dokumenty',
                        'dokumentów',
                      )}`
                    : 'nie jest aktem prawnym'
                  : act.amendments.length > 0
                    ? `skan Dziennika Ustaw · akt bazowy i ${act.amendments.length} ${plural(
                        act.amendments.length,
                        'nowelizacja',
                        'nowelizacje',
                        'nowelizacji',
                      )}`
                    : 'skan Dziennika Ustaw'}
              </Text>
            </Card>
          ))}
        </View>
      }
      renderItem={({ item }) => {
        const sets = content.setsForLesson(item.slug);
        const questions = content.questionsForSets(item.sets).length;
        const state = reading.get(item.slug);
        const label = readingLabel(state);
        const summary =
          sets.length > 0
            ? `${sets.length} ${plural(sets.length, 'zestaw', 'zestawy', 'zestawów')} ćwiczeń · ${questions} ${plural(questions, 'pytanie', 'pytania', 'pytań')}`
            : 'materiał teoretyczny';

        return (
          <Card
            onPress={() => router.push(`/learn/${item.slug}`)}
            onLongPress={() => onLongPress(item, state)}
            longPressLabel="Zmień lub wyczyść stan lekcji"
            // The state marker is "✓" or "◐" — a screen reader announces those as character
            // names ("check mark", "circle half filled"), which says nothing about the
            // lesson. The summary has to be spelled out here: a container's own
            // accessibility label replaces the text built from its children, so without it
            // the row lost the set count and question count entirely.
            accessibilityLabel={`${item.title}. ${summary}${label ? `. ${label}` : ''}`}
          >
            <View style={styles.row}>
              {/* A marker instead of a number once the lesson has some reading state —
                  the number can still be inferred from position in the list anyway. */}
              {state?.state === 'read' ? (
                <Text style={[styles.order, { color: theme.good }]}>✓</Text>
              ) : state ? (
                <Text style={[styles.order, { color: theme.accent }]}>◐</Text>
              ) : (
                <Text style={[styles.order, { color: theme.muted }]}>{item.order}</Text>
              )}

              <View style={styles.grow}>
                <Title>{item.title}</Title>
                <Muted>{summary}</Muted>
                {label ? (
                  <Text
                    style={[
                      styles.reading,
                      { color: state?.state === 'read' ? theme.good : theme.accent },
                    ]}
                  >
                    {label}
                  </Text>
                ) : null}
              </View>
            </View>
          </Card>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  header: { gap: 6, marginBottom: 6 },
  heading: { fontSize: 26, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  order: { fontSize: 18, fontWeight: '600', minWidth: 22, textAlign: 'center' },
  grow: { flex: 1, gap: 3 },
  reading: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  acts: { gap: 10, marginTop: 18 },
  divider: { height: StyleSheet.hairlineWidth, marginBottom: 8 },
  actsHeading: { fontSize: 20, fontWeight: '700' },
  actsSubheading: { fontSize: 13, fontWeight: '600', marginTop: 12 },
  actMeta: { fontSize: 12, marginTop: 2 },
});
