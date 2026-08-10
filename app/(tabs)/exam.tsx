import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Muted } from '../../src/components/ui';
import { content } from '../../src/content/store';
import {
  type StoredAttempt,
  clearAttempts,
  deleteAttempt,
  missedQuestionIds,
  recentAttempts,
} from '../../src/db/database';
import { CRITICAL_COUNT, PASS_THRESHOLD, QUESTION_COUNT, isCritical } from '../../src/engine/exam';
import { plural } from '../../src/engine/plural';
import { useTheme } from '../../src/theme';

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EgzaminScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [attempts, setAttempts] = useState<StoredAttempt[]>([]);

  /**
   * How many questions go into "egzamin z moich błędów" (exam from my mistakes).
   *
   * Exam mistakes only — the same source an attempt draws its pool from. This used to be
   * quiz-mode practice progress, so someone who took exams but never practised with the ABC
   * quiz never saw the button, despite having actual mistakes of their own. The exam is a
   * separate progress track and doesn't connect to practice mode in either direction.
   */
  const [missedCount, setMissedCount] = useState(0);

  const refresh = useCallback(() => {
    void recentAttempts().then(setAttempts);
    void missedQuestionIds().then((ids) => setMissedCount(ids.length));
  }, []);

  useFocusEffect(refresh);

  const onDelete = useCallback(
    (attempt: StoredAttempt) => {
      Alert.alert(
        'Usunąć to podejście?',
        `${attempt.score}/${QUESTION_COUNT} z ${formatDate(attempt.finishedAt)}. Tej operacji nie da się cofnąć.`,
        [
          { text: 'Anuluj', style: 'cancel' },
          {
            text: 'Usuń',
            style: 'destructive',
            onPress: () => {
              void deleteAttempt(attempt.id).then(refresh);
            },
          },
        ],
      );
    },
    [refresh],
  );

  const onClearAll = useCallback(() => {
    Alert.alert(
      'Wyczyścić całą historię?',
      'Znikną wszystkie zapisane podejścia do egzaminu. Postęp w ćwiczeniach zostaje nietknięty.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Wyczyść',
          style: 'destructive',
          onPress: () => {
            void clearAttempts().then(refresh);
          },
        },
      ],
    );
  }, [refresh]);

  const criticalPool = content.questions.filter(isCritical).length;
  const passed = attempts.filter((attempt) => attempt.passed).length;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={[styles.heading, { color: theme.text }]}>Egzamin próbny</Text>

      <Card>
        <Text style={[styles.rules, { color: theme.text }]}>
          {QUESTION_COUNT} pytań · 20 minut · próg {PASS_THRESHOLD}/{QUESTION_COUNT}
        </Text>
        <Muted>
          Pierwsze {CRITICAL_COUNT} pytania pochodzą z UoBiA i zasad bezpieczeństwa. Każdy błąd
          w tej czwórce oznacza niezdanie niezależnie od reszty wyniku — tak samo jak na
          prawdziwym egzaminie PZSS.
        </Muted>
        <Muted>
          Kolejność pytań i odpowiedzi jest losowana, żeby nie dało się wkuwać pozycji.
          Losujemy z {content.questions.length} pytań, w tym {criticalPool} krytycznych.
        </Muted>
      </Card>

      <Button label="Rozpocznij egzamin" onPress={() => router.push('/exam/attempt')} />

      {missedCount > 0 ? (
        <>
          <Button
            label="Egzamin z moich błędów"
            tone="neutral"
            onPress={() => router.push('/exam/attempt?pool=weak')}
          />
          <Muted>
            Losowany z {missedCount} {plural(missedCount, 'pytania', 'pytań', 'pytań')}, na których
            pomyliłeś się w egzaminach. Zasady te same; gdy błędów nie starcza na pełny zestaw
            albo na czwórkę krytyczną, pula dopełniana jest z całej bazy.
          </Muted>
        </>
      ) : null}

      <View style={styles.historyHeader}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Historia</Text>
        {attempts.length > 0 ? (
          <Muted>
            {passed} {plural(passed, 'zdane', 'zdane', 'zdanych')} z {attempts.length}
          </Muted>
        ) : null}
      </View>

      {attempts.length === 0 ? (
        <Muted>Jeszcze nie podchodziłeś do egzaminu.</Muted>
      ) : (
        attempts.map((attempt) => (
          <Card
            key={attempt.id}
            onPress={() => router.push(`/exam/result/${attempt.id}`)}
            onLongPress={() => onDelete(attempt)}
            longPressLabel="Usuń to podejście"
            accessibilityLabel={
              `${attempt.passed ? 'Zdane' : 'Niezdane'}, ${attempt.score} na ${QUESTION_COUNT}`
              + `${attempt.criticalFailed ? ', błąd w pytaniach krytycznych' : ''}`
              + `, ${formatDate(attempt.finishedAt)}`
            }
          >
            <View style={styles.attemptRow}>
              <Text style={[styles.attemptScore, { color: attempt.passed ? theme.good : theme.bad }]}>
                {attempt.score}/{QUESTION_COUNT}
              </Text>
              <View style={styles.grow}>
                {/* Neuter gender, as in the summary and in attempt history: this is about
                    the attempt, and the masculine "Zdany" read like a verdict about someone
                    else. */}
                <Text style={[styles.attemptVerdict, { color: theme.text }]}>
                  {attempt.passed ? 'Zdane' : 'Niezdane'}
                </Text>
                {attempt.criticalFailed ? (
                  <Text style={[styles.critical, { color: theme.critical }]}>
                    błąd w pytaniach krytycznych
                  </Text>
                ) : null}
              </View>
              <Muted>{formatDate(attempt.finishedAt)}</Muted>
            </View>
          </Card>
        ))
      )}

      {attempts.length > 0 ? (
        <>
          <Muted>Przytrzymaj podejście, żeby je usunąć.</Muted>
          <Pressable
            onPress={onClearAll}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => [styles.clearAll, pressed && { opacity: 0.6 }]}
          >
            <Text style={{ color: theme.bad, fontSize: 15, fontWeight: '600' }}>
              Wyczyść całą historię
            </Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 32 },
  heading: { fontSize: 26, fontWeight: '700' },
  rules: { fontSize: 16, fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '600' },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 12,
  },
  clearAll: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  attemptRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  attemptScore: { fontSize: 20, fontWeight: '700', minWidth: 52 },
  attemptVerdict: { fontSize: 15, fontWeight: '600' },
  critical: { fontSize: 12 },
  grow: { flex: 1, gap: 2 },
});
