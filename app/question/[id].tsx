import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { LawLink } from '../../src/components/LawLink';
import { useBottomInset } from '../../src/components/safeArea';
import { Button, Muted } from '../../src/components/ui';
import { content } from '../../src/content/store';
import type { AnswerOption } from '../../src/content/types';
import { questionSheet } from '../../src/engine/questionSheet';
import { useTheme } from '../../src/theme';

/**
 * One question, read rather than asked — where a search result for a question leads.
 *
 * The result used to open the question's lesson scrolled to the search phrase, which sits in
 * the lesson's text by coincidence, not because the question is there: "wyższej" landed on a
 * paragraph about the civil code. Here the reader sees the question itself, the correct answer
 * first and the wrong ones under it, with the legal basis visible straight away — the answer
 * is already on screen, so there is nothing for it to give away.
 *
 * Nothing is written: looking a question up is not practising it.
 */
export default function QuestionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const paddingBottom = useBottomInset(28);

  const question = content.question(id);

  if (!question) {
    return (
      <View style={styles.body}>
        <Stack.Screen options={{ title: 'Pytanie' }} />
        <Muted>Pytania nie ma już w bieżącej paczce treści.</Muted>
      </View>
    );
  }

  const sheet = questionSheet(question);
  const lesson = question.lesson ? content.lesson(question.lesson) : undefined;

  return (
    <ScrollView contentContainerStyle={[styles.body, { paddingBottom }]}>
      <Stack.Screen options={{ title: 'Pytanie' }} />

      <Text style={[styles.question, { color: theme.text }]}>{question.question}</Text>

      {/* The statements a "both answers…" key speaks about: true, so neither marked wrong. */}
      {sheet.referred.map((option) => (
        <Answer key={option.id} option={option} kind="referred" />
      ))}

      <Answer option={sheet.correct} kind="correct" />

      {/* A gap rather than a heading: the ✗ already says what these are, and a caption is one
          more line between the reader and the answers. */}
      {sheet.wrong.length > 0 ? (
        <View style={styles.wrong}>
          {sheet.wrong.map((option) => (
            <Answer key={option.id} option={option} kind="wrong" />
          ))}
        </View>
      ) : null}

      {question.law ? (
        <View style={styles.law}>
          <LawLink law={question.law} />
        </View>
      ) : null}

      {lesson ? (
        // Opens the lesson where the reader left it, with no search: the question's phrase is
        // not what the lesson is about at that spot.
        <Button
          label={`Lekcja: ${lesson.title} →`}
          tone="neutral"
          onPress={() => router.push(`/learn/${lesson.slug}`)}
        />
      ) : null}
    </ScrollView>
  );
}

/**
 * One answer. The verdict carries a shape as well as a colour — ✓ and ✗, as in the quiz —
 * because a green and a red box are the same box under deuteranopia.
 */
function Answer({
  option,
  kind,
}: {
  option: AnswerOption;
  kind: 'correct' | 'wrong' | 'referred';
}) {
  const theme = useTheme();

  const correct = kind === 'correct';
  const mark = correct ? '✓' : kind === 'wrong' ? '✗' : '';
  const color = correct ? theme.onFill : kind === 'wrong' ? theme.muted : theme.text;
  const label =
    correct ? 'Poprawna odpowiedź' : kind === 'wrong' ? 'Błędna odpowiedź' : 'Odpowiedź';

  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${option.text}`}
      style={[
        styles.answer,
        {
          backgroundColor: correct ? theme.good : theme.surface,
          borderColor: theme.border,
        },
      ]}
    >
      {mark ? (
        <Text style={[styles.mark, { color: kind === 'wrong' ? theme.bad : color }]}>{mark}</Text>
      ) : null}
      <Text style={[styles.answerText, { color }]}>{option.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 18, gap: 12 },
  question: { fontSize: 20, fontWeight: '600', lineHeight: 27, marginBottom: 6 },
  answer: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    alignItems: 'flex-start',
  },
  mark: { fontSize: 16, fontWeight: '700', minWidth: 18 },
  answerText: { fontSize: 16, lineHeight: 22, flex: 1 },
  wrong: { gap: 12, marginTop: 10 },
  law: { marginTop: 8 },
});
