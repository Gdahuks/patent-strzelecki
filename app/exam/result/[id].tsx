import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AttemptAnswerCard } from '../../../src/components/AttemptAnswerCard';
import { Card, Muted } from '../../../src/components/ui';
import { type AttemptDetail, attemptDetail, deleteAttempt } from '../../../src/db/database';
import { PASS_THRESHOLD, QUESTION_COUNT } from '../../../src/engine/exam';
import { useTheme } from '../../../src/theme';

export default function AttemptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const [attempt, setAttempt] = useState<AttemptDetail | null | 'loading'>('loading');

  useEffect(() => {
    let cancelled = false;
    void attemptDetail(Number(id)).then((result) => {
      if (!cancelled) setAttempt(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const onDelete = useCallback(() => {
    Alert.alert('Usunąć to podejście?', 'Tej operacji nie da się cofnąć.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: () => {
          void deleteAttempt(Number(id)).then(() => router.back());
        },
      },
    ]);
  }, [id, router]);

  if (attempt === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Stack.Screen options={{ title: 'Podejście' }} />
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (!attempt) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Stack.Screen options={{ title: 'Podejście' }} />
        <Text style={{ color: theme.muted }}>Nie znaleziono tego podejścia.</Text>
      </View>
    );
  }

  const mistakes = attempt.answers.filter((answer) => !answer.wasCorrect);
  const correct = attempt.answers.filter((answer) => answer.wasCorrect);
  const minutes = Math.max(1, Math.round((attempt.finishedAt - attempt.startedAt) / 60000));

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Stack.Screen
        options={{
          title: new Date(attempt.finishedAt).toLocaleString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }),
        }}
      />

      <Card>
        <Text style={[styles.score, { color: attempt.passed ? theme.good : theme.bad }]}>
          {attempt.score}/{QUESTION_COUNT} — {attempt.passed ? 'zdane' : 'niezdane'}
        </Text>
        {/* The condition allows a score equal to the threshold, so „powyżej progu" (above
            the threshold) used to be false. */}
        {attempt.criticalFailed && attempt.score >= PASS_THRESHOLD ? (
          <Text style={{ color: theme.critical, fontSize: 14 }}>
            Wynik wystarczał na zaliczenie, ale błąd padł w pytaniach krytycznych — to niezdanie.
          </Text>
        ) : null}
        <Muted>Czas rozwiązywania: około {minutes} min.</Muted>
      </Card>

      {attempt.answers.length === 0 ? (
        <Muted>Szczegóły odpowiedzi nie są dostępne dla tego podejścia.</Muted>
      ) : null}

      {mistakes.length > 0 ? (
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Błędy ({mistakes.length})</Text>
      ) : attempt.answers.length > 0 ? (
        <Muted>Komplet poprawnych odpowiedzi.</Muted>
      ) : null}

      {mistakes.map((answer) => (
        <AttemptAnswerCard key={answer.questionId} answer={answer} />
      ))}

      {correct.length > 0 ? (
        <>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            Poprawne ({correct.length})
          </Text>
          {correct.map((answer) => (
            <AttemptAnswerCard key={answer.questionId} answer={answer} />
          ))}
        </>
      ) : null}

      <Pressable
        onPress={onDelete}
        accessibilityRole="button"
        style={({ pressed }) => [styles.delete, pressed && { opacity: 0.6 }]}
      >
        <Text style={{ color: theme.bad, fontSize: 15, fontWeight: '600' }}>
          Usuń to podejście
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  score: { fontSize: 24, fontWeight: '700' },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginTop: 8 },
  question: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  badge: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  delete: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 16, marginTop: 8 },
});
