// `usePreventRemove` lives in React Navigation's core and expo-router doesn't re-export it,
// so it comes straight from the package expo-router itself depends on.
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { announce } from '../../src/a11y/announce';
import { useScreenReader } from '../../src/a11y/useScreenReader';
import { AttemptAnswerCard } from '../../src/components/AttemptAnswerCard';
import { ExamStrip } from '../../src/components/ExamStrip';
import { positionLabel } from '../../src/content/answers';
import { useBottomInset } from '../../src/components/safeArea';
import { Button, Card, Muted } from '../../src/components/ui';
import { profileMisses, profileQuestions } from '../../src/content/examPool';
import type { Letter } from '../../src/content/types';
import { missedQuestionIds, saveAttempt } from '../../src/db/database';
import {
  type ExamProfile,
  type ExamQuestion,
  type ExamResult,
  buildPool,
  drawExam,
  examProfile,
  formatRemaining,
  gradeExam,
  solvingMinutes,
  unansweredNumbers,
} from '../../src/engine/exam';
import { plural } from '../../src/engine/plural';
import { useTheme } from '../../src/theme';

export default function ExamAttemptScreen() {
  const theme = useTheme();
  const router = useRouter();
  const screenReader = useScreenReader();
  // The bar holds "Zakończ", so without the inset the exam cannot be submitted at all on a
  // phone with three-button navigation. See `useBottomInset`.
  const paddingBottom = useBottomInset(14);

  const { pool, profile: profileId } = useLocalSearchParams<{ pool?: string; profile?: string }>();
  const fromWeak = pool === 'weak';
  const profile = examProfile(profileId);

  const startedAt = useRef(Date.now());
  /**
   * Guards against grading twice. The native `Alert` doesn't block JavaScript, so if the
   * timer runs out while the "oddać niekompletny arkusz?" dialog is open, the timer grades
   * the exam, and a later tap on "Oddaj" would grade it again — producing a second entry in
   * history. The `result` state alone isn't enough here, because the dialog's closure is
   * stale by then.
   */
  const finished = useRef(false);
  // The weak-question pool lives in the database, so the set is assembled asynchronously.
  const [exam, setExam] = useState<ExamQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<Map<string, Letter | null>>(new Map());
  const [remaining, setRemaining] = useState(profile.timeLimitSeconds);
  const [result, setResult] = useState<ExamResult | null>(null);
  /** How long the finished attempt took — frozen at hand-in, so re-renders can't grow it. */
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const base = profileQuestions(profile);
      // The pool is drawn exclusively from exam mistakes. Flashcards, the ABC quiz and the
      // exam are three independent progress tracks — mixing in questions flagged as needing
      // work from practice mode would blend the measurement with the training and desync the
      // counter next to the button from what actually goes into the draw. `buildPool` stays
      // in the mix because there can be fewer mistakes than the paper has questions, and none
      // of them has to be critical.
      //
      // The mistakes come from this profile's own attempts and are then narrowed to its pool.
      // Sharing them across profiles was tried and reported as a bug: a question missed on the
      // licence exam surfaced under WPA whenever it sat on the course's WPA list, so a profile
      // with no attempts at all still offered an exam built from mistakes in it.
      const questions = fromWeak
        ? buildPool(profileMisses(await missedQuestionIds(profile.id), base), base, profile)
        : base;
      if (cancelled) return;

      startedAt.current = Date.now();
      finished.current = false;
      setRemaining(profile.timeLimitSeconds);
      setExam(drawExam(questions, profile));
    })();

    return () => {
      cancelled = true;
    };
  }, [fromWeak, profile]);

  const finish = useCallback(
    (answers: Map<string, Letter | null>) => {
      if (!exam || finished.current) return;
      finished.current = true;

      const graded = gradeExam(exam, answers, profile);
      setResult(graded);

      // The exam doesn't touch practice progress: it's a measurement, not training, and a
      // single attempt used to be able to knock a question mastered in practice back down.
      // Its mistakes aren't lost, though — the saved attempt is the source of the pool for
      // "exam from weak questions".

      const finishedAt = Date.now();
      setElapsed(finishedAt - startedAt.current);

      void saveAttempt({
        startedAt: startedAt.current,
        finishedAt,
        score: graded.score,
        passed: graded.passed,
        criticalFailed:
          graded.failedOnCritical || graded.answers.some((a) => a.critical && !a.wasCorrect),
        answers: graded.answers,
        profile: profile.id,
      });
    },
    [exam, profile],
  );

  useEffect(() => {
    if (result || !exam) return;

    const timer = setInterval(() => {
      setRemaining((left) => {
        if (left <= 1) {
          clearInterval(timer);
          setChosen((current) => {
            finish(current);
            return current;
          });
          return 0;
        }
        return left - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [result, exam, finish]);

  const current = exam?.[index];
  const picked = current ? chosen.get(current.question.id) ?? null : null;
  const answeredCount = useMemo(
    () => (exam ?? []).filter((entry) => chosen.get(entry.question.id)).length,
    [exam, chosen],
  );

  /**
   * Picking an answer advances to the next question on its own — with ten questions, a
   * separate "Dalej" tap after every pick would be ten pointless clicks. The short delay
   * lets you see what got selected. On the last question we don't advance anywhere: handing
   * in the paper stays a deliberate action.
   */
  const onPick = useCallback(
    (letter: Letter) => {
      if (!current) return;
      setChosen((previous) => new Map(previous).set(current.question.id, letter));

      // With a screen reader running, we stay on the question. 220 ms isn't enough time for
      // the pick to be announced, so the paper would scroll out from under the finger without
      // confirming what actually got selected — and the exam has no verdict to reveal that
      // later. "Dalej" is always present in the bar, so nothing disappears: moving on becomes
      // a deliberate tap instead.
      if (index < profile.questionCount - 1 && !screenReader) {
        setTimeout(() => {
          setIndex((value) => (value === index ? value + 1 : value));
        }, 220);
      }
    },
    [current, index, screenReader, profile],
  );

  /**
   * Leaving a started attempt asks first.
   *
   * The attempt lives only in memory, so navigating away destroys it — up to thirty minutes
   * of a WPA paper, with no trace left in history. Everything else costly in this app has a
   * guard: handing in an incomplete paper asks, deleting an attempt needs a long press,
   * clearing the history has its own dialog. This was the only exception, and
   * `predictiveBackGestureEnabled` makes an accidental edge swipe enough to trigger it.
   *
   * Sending the app to the background is deliberately *not* affected — the attempt survives
   * `HOME` untouched, and it would be strange for the gentler interruption to be the one
   * that asks questions.
   *
   * The guard lifts the moment the paper is graded: the summary is a normal screen to leave.
   */
  const navigation = useNavigation();
  usePreventRemove(Boolean(exam) && !result, ({ data }) => {
    Alert.alert(
      'Przerwać egzamin?',
      'Podejście przepadnie razem z odpowiedziami i czasem. W historii nie zostanie po nim ślad.',
      [
        { text: 'Wróć do egzaminu', style: 'cancel' },
        {
          text: 'Przerwij',
          style: 'destructive',
          onPress: () => navigation.dispatch(data.action),
        },
      ],
    );
  });

  const low = remaining <= 120;

  // A sighted user gets the clock turning red at two minutes left; that signal never reaches
  // a screen reader at all, and in a timed exam this is the one moment that information still
  // has value. One announcement, not a countdown: repeating it would interrupt reading the
  // questions.
  useEffect(() => {
    if (low && !finished.current) announce('Zostały 2 minuty');
  }, [low]);

  const onSubmit = useCallback(() => {
    // Numbers, not just a count: „bez odpowiedzi zostały 3 pytania" didn't say which ones to
    // look for, and the paper would then get clicked through blind.
    const missing = exam ? unansweredNumbers(exam.map((entry) => entry.question.id), chosen) : [];

    if (missing.length > 0) {
      Alert.alert(
        'Oddać niekompletny arkusz?',
        `Bez odpowiedzi: ${missing.join(', ')}. ${plural(
          missing.length,
          'Liczy się jak błąd.',
          'Liczą się jak błędy.',
          'Liczą się jak błędy.',
        )}`,
        [
          { text: `Przejdź do pytania ${missing[0]}`, onPress: () => setIndex(missing[0] - 1) },
          { text: 'Wróć', style: 'cancel' },
          { text: 'Oddaj', style: 'destructive', onPress: () => finish(chosen) },
        ],
      );
      return;
    }
    finish(chosen);
  }, [exam, chosen, finish]);

  if (result && exam) {
    return (
      <ExamSummary
        result={result}
        profile={profile}
        elapsed={elapsed}
        onClose={() => router.back()}
      />
    );
  }

  if (!exam || !current) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.bg }]}>
        <Stack.Screen
          options={{ title: fromWeak ? 'Egzamin z moich błędów' : `Egzamin — ${profile.title}` }}
        />
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <Stack.Screen
        options={{
          title: `Pytanie ${index + 1} z ${profile.questionCount}`,
          headerRight: () => (
            <Text
              style={{ color: low ? theme.bad : theme.muted, fontSize: 16, fontWeight: '600' }}
              // A bare „02:00" gets read out by a screen reader as two numbers with no
              // context, and the red colour — the only signal that time is running out —
              // never reaches it at all.
              accessibilityLabel={`Pozostały czas ${formatRemaining(remaining)}${low ? ', mało czasu' : ''}`}
            >
              {formatRemaining(remaining)}
            </Text>
          ),
        }}
      />

      <ExamStrip
        count={profile.questionCount}
        answered={(position) => Boolean(chosen.get(exam[position]?.question.id ?? ''))}
        current={index}
        onJump={setIndex}
      />

      <ScrollView contentContainerStyle={styles.body}>
        {current.critical ? (
          <Text style={[styles.criticalBadge, { color: theme.critical }]}>
            Pytanie krytyczne — błąd oznacza niezdanie
          </Text>
        ) : null}

        <Text style={[styles.question, { color: theme.text }]}>{current.question.question}</Text>

        {current.order.map((letter, index) => {
          const selected = picked === letter;
          const answer = current.question.answers[letter] ?? '';
          return (
            <Pressable
              key={letter}
              onPress={() => onPick(letter)}
              accessibilityRole="radio"
              accessibilityLabel={`${positionLabel(index)}. ${answer}`}
              // The selection here is shown only by a filled background, so without this
              // state a screen-reader user has no way to check what's already picked — and
              // the exam shows no verdict that would let them infer it later.
              accessibilityState={{ checked: selected, selected }}
              style={({ pressed }) => [
                styles.answer,
                {
                  backgroundColor: selected ? theme.accent : theme.surface,
                  borderColor: selected ? theme.accent : theme.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.answerLetter, { color: selected ? theme.onFill : theme.muted }]}>
                {positionLabel(index)}
              </Text>
              <Text style={[styles.answerText, { color: selected ? theme.onFill : theme.text }]}>
                {answer}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View
        style={[
          styles.nav,
          { borderTopColor: theme.border, backgroundColor: theme.surface, paddingBottom },
        ]}
      >
        <Pressable
          disabled={index === 0}
          onPress={() => setIndex((value) => value - 1)}
          accessibilityRole="button"
          accessibilityLabel="Poprzednie pytanie"
          accessibilityState={{ disabled: index === 0 }}
          style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
        >
          {/* Dimmed, not the border colour: the border colour is only 1.29:1 against the
              background, so "Wstecz" on the first question disappeared instead of looking
              disabled. */}
          <Text style={{ color: index === 0 ? theme.muted : theme.accent, fontSize: 16 }}>
            Wstecz
          </Text>
        </Pressable>

        <Text
          style={[styles.counter, { color: theme.muted }]}
          accessibilityLabel={`Odpowiedzi: ${answeredCount} z ${profile.questionCount}`}
        >
          {answeredCount}/{profile.questionCount}
        </Text>

        {index === profile.questionCount - 1 ? (
          <Pressable
            onPress={onSubmit}
            accessibilityRole="button"
            accessibilityLabel="Zakończ egzamin i oddaj arkusz"
            style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
          >
            <Text style={{ color: theme.accent, fontSize: 16, fontWeight: '700' }}>Zakończ</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setIndex((value) => value + 1)}
            accessibilityRole="button"
            accessibilityLabel="Następne pytanie"
            style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
          >
            <Text style={{ color: theme.accent, fontSize: 16 }}>Dalej</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ExamSummary({
  result,
  profile,
  elapsed,
  onClose,
}: {
  result: ExamResult;
  profile: ExamProfile;
  /** Milliseconds the attempt took. */
  elapsed: number;
  onClose: () => void;
}) {
  const theme = useTheme();
  const paddingBottom = useBottomInset(32);
  const mistakes = result.answers.filter((answer) => !answer.wasCorrect);
  const correct = result.answers.filter((answer) => answer.wasCorrect);

  // The summary replaces the screen without a navigation event, so a screen reader doesn't
  // read it on its own — and the verdict is the one thing the exam is taken for.
  useEffect(() => {
    announce(
      `Egzamin ${result.passed ? 'zdany' : 'niezdany'}: ${result.score} z ${profile.questionCount}`
        + (result.failedOnCritical ? '. Błąd padł w pytaniach krytycznych' : ''),
    );
  }, [result, profile]);

  return (
    <ScrollView contentContainerStyle={[styles.body, { paddingBottom }]}>
      {/* The result is already saved, so going back loses nothing — without this button the
          only way out was scrolling through the whole mistake list to the very bottom. */}
      {/* The clock is cleared, not left to fall through from the attempt's own options. It
          froze at whatever time was left when the paper went in, and sitting where a
          countdown had been ticking for half an hour, it read as one still running. What
          the reader wants here is the opposite number — how long it took — and that goes
          into the card below, worded exactly as on the attempt screen reached from
          history. */}
      <Stack.Screen options={{ title: 'Wynik', headerRight: () => null }} />

      <Card>
        <Text style={[styles.score, { color: result.passed ? theme.good : theme.bad }]}>
          {result.score}/{profile.questionCount} — {result.passed ? 'zdane' : 'niezdane'}
        </Text>
        {/* „Powyżej progu" (above the threshold) was false when the score equaled the
            threshold exactly, and that's the most common case: a mistake in the critical
            four gives exactly 9/10. */}
        {result.failedOnCritical ? (
          <Text style={{ color: theme.critical, fontSize: 14 }}>
            Wynik wystarczał na zaliczenie (próg {profile.passThreshold}/{profile.questionCount}),
            ale błąd padł w pierwszych {profile.criticalCount} pytaniach — to oznacza niezdanie.
          </Text>
        ) : null}
        {result.passed ? <Muted>Taki wynik zalicza prawdziwy egzamin.</Muted> : null}
        <Muted>Czas rozwiązywania: około {solvingMinutes(elapsed)} min.</Muted>
      </Card>

      {mistakes.length > 0 ? (
        <Text style={[styles.sectionTitle, { color: theme.text }]}>
          Błędy ({mistakes.length})
        </Text>
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

      <Button label="Wróć do egzaminów" onPress={onClose} tone="neutral" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 18, gap: 12, paddingBottom: 32 },
  question: { fontSize: 20, fontWeight: '600', lineHeight: 27, marginBottom: 6 },
  criticalBadge: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  answer: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    alignItems: 'flex-start',
  },
  answerLetter: { fontSize: 16, fontWeight: '700', minWidth: 18 },
  answerText: { fontSize: 16, lineHeight: 22, flex: 1 },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navButton: { paddingVertical: 6, paddingHorizontal: 10, minWidth: 74 },
  counter: { fontSize: 14 },
  score: { fontSize: 24, fontWeight: '700' },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginTop: 8 },
  mistakeQuestion: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  pressed: { opacity: 0.7 },
});
