import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { content } from '../content/store';
import type { AttemptAnswer } from '../db/database';
import { useTheme } from '../theme';
import { Card, Muted } from './ui';
import { LawLink } from './LawLink';

/**
 * A question from an exam attempt — one card for both hits and misses.
 *
 * The look has to be the same in both sections, because it's the same content and the same
 * things get done with it: read the correct answer, check the legal basis, jump back to the
 * lesson. The only difference is the line with the user's own answer, which has nothing to add
 * when the answer was correct.
 *
 * The same component serves the summary right after the exam and the attempt history —
 * previously the two copies of the card lived separately and drifted apart on every change.
 */
export function AttemptAnswerCard({ answer }: { answer: AttemptAnswer }) {
  const theme = useTheme();
  const router = useRouter();

  const question = content.question(answer.questionId);
  if (!question) {
    return (
      <Card>
        <Muted>Pytania nie ma już w bieżącej paczce treści.</Muted>
      </Card>
    );
  }

  const lesson = question.lesson ? content.lesson(question.lesson) : undefined;

  return (
    <Card>
      {answer.critical ? (
        <Text style={[styles.badge, { color: theme.critical }]}>krytyczne</Text>
      ) : null}

      <Text style={[styles.question, { color: theme.text }]}>{question.question}</Text>

      {answer.wasCorrect ? null : answer.chosen ? (
        <Text style={{ color: theme.bad, fontSize: 14 }}>
          Twoja odpowiedź: {question.answers[answer.chosen]}
        </Text>
      ) : (
        <Text style={{ color: theme.bad, fontSize: 14 }}>Bez odpowiedzi</Text>
      )}

      <Text style={{ color: theme.good, fontSize: 14 }}>
        Poprawna: {question.answers[question.correct]}
      </Text>

      {question.law ? <LawLink law={question.law} /> : null}

      {lesson ? (
        <Pressable
          onPress={() => router.push(`/learn/${lesson.slug}`)}
          // The attempt card itself isn't tappable, so there's free space below the link
          // (4 px of margin plus 16 px of card padding), and the target can be stretched to
          // 44 px without taking anything away from a neighbour.
          hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
          accessibilityRole="link"
          accessibilityLabel={`Powtórz lekcję: ${lesson.title}`}
        >
          <Text style={{ color: theme.accent, fontSize: 14, marginTop: 4 }}>
            Powtórz lekcję: {lesson.title} →
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  badge: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  question: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
});
