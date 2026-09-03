import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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

import { announce } from '../../../src/a11y/announce';
import { useScreenReader } from '../../../src/a11y/useScreenReader';
import { HeaderIcon } from '../../../src/components/HeaderIcon';
import { LawLink } from '../../../src/components/LawLink';
import { positionLabel } from '../../../src/content/answers';
import { useBottomInset } from '../../../src/components/safeArea';
import { SegmentedBar } from '../../../src/components/ui';
import { planPracticeSet, practiceSetTitle } from '../../../src/content/practiceSet';
import { content } from '../../../src/content/store';
import type { Letter, Question } from '../../../src/content/types';
import {
  type PracticeMode,
  loadCards,
  resetProgress,
  saveCard,
  questionsForPlan,
} from '../../../src/db/database';
import {
  type DeckState,
  answerCard,
  applyAnswer,
  createDeck,
  deckProgress,
  nextCard,
  shuffle,
} from '../../../src/engine/leitner';
import { plural } from '../../../src/engine/plural';
import { useSettings } from '../../../src/settings/SettingsContext';
import { useTheme } from '../../../src/theme';

/** How many recent questions can be reviewed backward. Enough to get back to something that
 *  flew by too fast, without growing without bound over a whole session. */
const HISTORY_LIMIT = 30;

export default function ExerciseScreen() {
  const params = useLocalSearchParams<{ mode: string; sets: string; bledy?: string }>();
  const mode: PracticeMode = params.mode === 'flashcards' ? 'flashcards' : 'test';
  const setSlugs = useMemo(() => params.sets.split(',').filter(Boolean), [params.sets]);

  const theme = useTheme();
  const router = useRouter();
  const { levels } = useSettings();
  const screenReader = useScreenReader();
  // The footer is the bottom-most element, so it carries the navigation-bar inset for the
  // whole screen — the "Dalej" row above it then clears the bar on its own.
  const footerPadding = useBottomInset(14);
  // The finished-set screen has no footer, so it keeps its own padding (28 on every side) and
  // only adds the inset on top of it — reusing `footerPadding` here would have shrunk the
  // bottom below the other three sides on a device with no bottom inset.
  const donePadding = useBottomInset(28);

  /**
   * What this route is a set of — a course set, the virtual "moje błędy", or one area narrowed
   * to its exam mistakes (`?bledy=<profil>`).
   *
   * The rule lives in `planPracticeSet` because the question browser needs exactly the same
   * answer, and the two screens working it out separately is what let the browser open all 252
   * questions of an area from a drill of six. Two of the three kinds are assembled from the
   * database, so the questions still load asynchronously.
   */
  const examProfileId = params.bledy;
  const plan = useMemo(() => planPracticeSet(setSlugs, examProfileId), [setSlugs, examProfileId]);
  const isWeak = plan.kind === 'weak';
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [deck, setDeck] = useState<DeckState | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [order, setOrder] = useState<Letter[]>([]);
  const [picked, setPicked] = useState<Letter | null>(null);
  /**
   * The answers picked this session, keyed by question.
   *
   * Previewing an earlier question used to show only the correct answer, so there was no way
   * to see what had actually been picked at the time — which is the whole point of that
   * preview. Kept in screen memory only: there's nothing to restore across sessions, since
   * the preview only ever looks at this one.
   */
  const [picks, setPicks] = useState<Map<string, Letter>>(new Map());
  /**
   * The answer order drawn for a question in this session.
   *
   * The preview used to sort the options for good, so an answer picked as A came back
   * labelled under a different letter and the preview stopped matching what had actually
   * been on screen. Remembering the order fixes this without re-shuffling on every render —
   * which was the reason for that sorting in the first place.
   */
  const [orders, setOrders] = useState<Map<string, Letter[]>>(new Map());
  const [revealed, setRevealed] = useState(false);

  /** Questions shown this session, oldest first. The last one is the current one. */
  const [history, setHistory] = useState<string[]>([]);
  /** Index of the question being reviewed, or null when we're on the current one. */
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  /**
   * Handle to the scheduled advance after a correct answer.
   *
   * Without it, tapping "Wstecz" (back) within that 550 ms window threw you out of previewing
   * an earlier question straight onto the new one — and the whole point of the preview is to
   * calmly read something that flew by too fast.
   */
  const pendingAdvance = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The scheduled advance was cancelled, so moving on now needs a manual step.
   *
   * Without this, entering the preview right after a correct answer ended in a dead end:
   * returning to the current question showed no "Dalej" (next) button — because the answer
   * had been correct — and the automatic advance was no longer coming back either.
   */
  const [needsManualNext, setNeedsManualNext] = useState(false);

  const cancelPendingAdvance = useCallback(() => {
    if (pendingAdvance.current !== null) {
      clearTimeout(pendingAdvance.current);
      pendingAdvance.current = null;
      setNeedsManualNext(true);
    }
  }, []);

  useEffect(() => cancelPendingAdvance, [cancelPendingAdvance]);

  const advance = useCallback((state: DeckState, avoid: string | null = null) => {
    const card = nextCard(state, undefined, avoid);
    setCurrentId(card?.questionId ?? null);
    setPicked(null);
    setRevealed(false);
    setReviewIndex(null);
    setNeedsManualNext(false);

    if (card) {
      const question = content.question(card.questionId);
      const drawn = shuffle(Object.keys(question?.answers ?? {}) as Letter[]);
      setOrder(drawn);
      setOrders((previous) => new Map(previous).set(card.questionId, drawn));
      setHistory((previous) => [...previous, card.questionId].slice(-HISTORY_LIMIT));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const pool = await questionsForPlan(plan, mode);
      if (cancelled) return;

      const ids = pool.map((question) => question.id);
      const known = await loadCards(ids, mode);
      if (cancelled) return;

      const state = createDeck(ids, known, levels);
      setQuestions(pool);
      setDeck(state);
      setHistory([]);
      setPicks(new Map());
      setOrders(new Map());
      advance(state);
    })();

    return () => {
      cancelled = true;
    };
  }, [plan, mode, levels, advance]);

  /**
   * The deck as seen by the refresh effect.
   *
   * It can't go into that effect's dependencies: a refresh replaces the deck, so the effect
   * would keep waking itself up in a loop. The ref gives access to the current state without
   * that loop.
   */
  const deckRef = useRef<DeckState | null>(null);
  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  /**
   * Answer writes in flight — a chain that the refresh-on-return waits on.
   *
   * `commit` saves the card without waiting for it, because the UI is meant to move on right
   * away. But the focus effect reads buckets straight from the database, so without this
   * barrier a return could outrun the save: answer in the quiz, tap the legal basis, come
   * back — and the question you just got right drops back into the zero bucket, with the
   * footer visibly regressing in front of the user. The write sits in a queue behind `db()`
   * and the act screen's position read, so the window is real.
   *
   * A chain instead of a single promise also serialises the writes themselves — successive
   * answers don't overtake one another.
   */
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Returning to this screen reloads the buckets, but doesn't touch the session.
   *
   * From the question-review screen ("Przejrzyj pytania") a question can be marked mastered
   * or needs-work by hand, and the deck lives in screen memory. Without this, the footer kept
   * showing numbers from before the change, a question marked mastered still came up to be
   * asked again, and the "set mastered" condition was computed from stale data.
   *
   * We reload **only the cards**. The current question, the review history and the
   * remembered picks stay untouched, because returning is meant to land on the same question
   * — reloading the whole screen would restart the session. The answer counter stays too: it
   * drives peeking into higher buckets, and resetting it would roll back the spacing rhythm.
   */
  useFocusEffect(
    useCallback(() => {
      const current = deckRef.current;
      // The first entry is handled by the effect that loads the set — by this point we're
      // already past it.
      if (!current) return;

      let cancelled = false;
      const ids = current.cards.map((card) => card.questionId);

      void (async () => {
        // Flush the pending answer write first, or the read would see the state from before it.
        await pendingSave.current.catch(() => undefined);
        if (cancelled) return;

        const known = await loadCards(ids, mode);
        if (cancelled) return;
        setDeck((state) =>
          state ? { ...createDeck(ids, known, levels), counter: state.counter } : state,
        );
      })();

      return () => {
        cancelled = true;
      };
    }, [mode, levels]),
  );

  const reviewing = reviewIndex !== null;
  const shownId = reviewing ? (history[reviewIndex] ?? null) : currentId;
  const shownPick = shownId ? (picks.get(shownId) ?? null) : null;
  const question = shownId ? content.question(shownId) : undefined;

  // In the preview we replay the order from when the question was asked, so the letters
  // match what was actually on screen. Alphabetical sorting is a fallback for questions from
  // outside this session.
  const shownOrder = useMemo(() => {
    if (!reviewing) return order;
    const remembered = shownId ? orders.get(shownId) : undefined;
    return remembered ?? (Object.keys(question?.answers ?? {}) as Letter[]).sort();
  }, [reviewing, shownId, orders, question, order]);

  const commit = useCallback(
    (wasCorrect: boolean) => {
      if (!deck || !currentId) return;

      const card = deck.cards.find((entry) => entry.questionId === currentId);
      if (card) {
        const next = answerCard(card, wasCorrect, levels);
        pendingSave.current = pendingSave.current
          .catch(() => undefined)
          .then(() => saveCard(next, mode));
      }

      const updated = applyAnswer(deck, currentId, wasCorrect);
      setDeck(updated);
      return updated;
    },
    [deck, currentId, mode, levels],
  );

  /**
   * The set's completion condition — a single source for both the end screen and the screen
   * reader's announcements.
   *
   * In the mistakes set, mastering the whole deck up to the top bucket is work spread across
   * many sessions. The goal there is leaving the zero bucket, i.e. answering every question
   * you'd gotten wrong correctly once.
   */
  const deckMastered = useCallback(
    (state: DeckState | null): boolean => {
      if (!state) return false;
      const summary = deckProgress(state);
      return (
        summary.total > 0 &&
        (isWeak ? summary.perBucket[0] === 0 : summary.mastered === summary.total)
      );
    },
    [isWeak],
  );

  const doneTitle = isWeak ? 'Błędy nadrobione' : 'Zestaw opanowany';

  /**
   * ABC quiz: an answer reveals the verdict immediately. A correct one moves on by itself; a
   * wrong one leaves the question on screen together with the correct answer, so it can be
   * read — moving on from there needs the button.
   */
  const onAnswer = useCallback(
    (letter: Letter) => {
      if (!question || reviewing || picked !== null) return;
      setPicked(letter);
      setPicks((previous) => new Map(previous).set(question.id, letter));

      const wasCorrect = letter === question.correct;
      const updated = commit(wasCorrect);

      // The verdict replaces content in place, so a screen reader stays silent on its own —
      // the user would have to tap the answer again just to hear whether it was right. On a
      // wrong answer we also announce the correct one, since that's what stays on screen to
      // be read. When this answer closes out the set, the whole thing goes out as one
      // announcement: the end screen appears within the same render cycle, and a separate
      // announcement would cut the verdict off mid-sentence.
      announce(
        wasCorrect
          ? updated && deckMastered(updated)
            ? `Poprawna odpowiedź. ${doneTitle}`
            : 'Poprawna odpowiedź'
          : `Błędna odpowiedź. Poprawna: ${question.answers[question.correct] ?? ''}`,
      );

      if (wasCorrect && updated) {
        cancelPendingAdvance();

        // With a screen reader active, we don't advance automatically. The verdict
        // announcement takes longer than that 550 ms window, so the screen would change
        // mid-sentence and there'd be no way to hear whether the answer was right. We show
        // "Dalej" (next) instead, the same as after a wrong answer — moving on becomes a
        // decision, not a countdown.
        if (screenReader) {
          setNeedsManualNext(true);
          return;
        }

        pendingAdvance.current = setTimeout(() => {
          pendingAdvance.current = null;
          advance(updated, question.id);
        }, 550);
      }
    },
    // No `currentId` here: the body doesn't touch it, and `commit` already carries it —
    // listing it again only re-created this callback a second time on every question.
    [
      question,
      reviewing,
      picked,
      commit,
      advance,
      cancelPendingAdvance,
      screenReader,
      deckMastered,
      doneTitle,
    ],
  );

  /** Flashcards: you judge yourself whether you knew it. */
  const onSelfAssess = useCallback(
    (knew: boolean) => {
      const updated = commit(knew);
      // We don't announce the verdict — the judgement was the user's own — but completing
      // the set swaps the screen without navigating, and without an announcement that would
      // pass silently for a screen reader.
      if (updated && deckMastered(updated)) announce(doneTitle);
      if (updated) advance(updated, currentId);
    },
    [commit, advance, currentId, deckMastered, doneTitle],
  );

  const onNext = useCallback(() => {
    cancelPendingAdvance();
    if (!reviewing) {
      if (deck) advance(deck, currentId);
      return;
    }
    // From the preview we step forward one question at a time, back to the current one.
    const next = reviewIndex + 1;
    setReviewIndex(next >= history.length - 1 ? null : next);
  }, [reviewing, reviewIndex, history.length, deck, currentId, advance, cancelPendingAdvance]);

  const onBack = useCallback(() => {
    // Entering the preview has to cancel the scheduled advance, or it would throw the user
    // onto a new question a moment later.
    cancelPendingAdvance();
    const from = reviewIndex ?? history.length - 1;
    if (from > 0) setReviewIndex(from - 1);
  }, [reviewIndex, history.length, cancelPendingAdvance]);

  const onReset = useCallback(() => {
    cancelPendingAdvance();
    if (!questions) return;
    Alert.alert(
      'Wyzerować postęp?',
      'Wszystkie pytania z tego zestawu wrócą do stanu nieprzerobionych.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Wyzeruj',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const ids = questions.map((entry) => entry.id);
              await resetProgress(ids, mode);
              const state = createDeck(ids, new Map(), levels);
              setDeck(state);
              setHistory([]);
              advance(state);
            })();
          },
        },
      ],
    );
  }, [questions, mode, levels, advance, cancelPendingAdvance]);

  const title = practiceSetTitle(plan);

  const header = (
    <Stack.Screen
      options={{
        title,
        // A warning colour, not the accent: the icon doesn't say what it does, so the colour
        // is the only signal that this is a destructive action.
        headerRight: () => (
          <HeaderIcon
            name="refresh"
            label="Wyzeruj postęp zestawu"
            tone="danger"
            onPress={onReset}
          />
        ),
      }}
    />
  );

  if (!deck || !questions) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        {header}
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (questions.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        {header}
        <Text style={[styles.emptyTitle, { color: theme.text }]}>
          {isWeak ? 'Nie masz jeszcze błędów' : 'Ten zestaw nie zawiera pytań'}
        </Text>
        {isWeak ? (
          <Text style={{ color: theme.muted, textAlign: 'center' }}>
            Tu trafiają pytania, na których się pomylisz. Poćwicz zestawy z listy, a trafią
            tu same.
          </Text>
        ) : null}
      </View>
    );
  }

  const progress = deckProgress(deck);
  const mastered = deckMastered(deck);

  if (mastered) {
    return (
      <ScrollView contentContainerStyle={[styles.done, { paddingBottom: donePadding }]}>
        {header}
        <Text style={styles.doneMark}>🎯</Text>
        <Text style={[styles.doneTitle, { color: theme.text }]}>{doneTitle}</Text>
        <Text style={[styles.doneText, { color: theme.muted }]}>
          {isWeak
            ? `Odpowiedziałeś poprawnie na ${
                progress.total === 1
                  ? 'pytanie, na którym się myliłeś'
                  : `każde z ${progress.total} pytań, na których się myliłeś`
              }. Wróć tu, gdy uzbiera się kolejna porcja.`
            : `${progress.total} ${plural(progress.total, 'pytanie', 'pytania', 'pytań')} z „${title}” ${plural(progress.total, 'jest opanowane', 'są opanowane', 'jest opanowanych')}. Materiał siedzi — wróć tu za jakiś czas, żeby go odświeżyć.`}
        </Text>

        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.doneButton,
            { backgroundColor: theme.accent },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.doneButtonLabel, { color: theme.onFill }]}>Wróć do ćwiczeń</Text>
        </Pressable>

        {/* Reset only for a regular set: there's nothing to reset in the mistakes set,
            since it's assembled from the progress database and vanishes on its own once
            there are no mistakes left. */}
        {isWeak ? null : (
          <Pressable
            onPress={onReset}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.doneButton,
              {
                backgroundColor: theme.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.border,
              },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.doneButtonLabel, { color: theme.bad }]}>Zacznij od nowa</Text>
          </Pressable>
        )}
      </ScrollView>
    );
  }

  if (!question) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        {header}
        <Text style={{ color: theme.muted }}>Brak pytań do pokazania.</Text>
      </View>
    );
  }

  const canGoBack = (reviewIndex ?? history.length - 1) > 0;
  const showNext =
    reviewing ||
    (mode === 'test' &&
      picked !== null &&
      (picked !== question.correct || needsManualNext));

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      {header}

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.question, { color: theme.text }]}>{question.question}</Text>

        {mode === 'test' || reviewing
          ? shownOrder.map((letter, index) => {
              const isCorrect = letter === question.correct;
              // In the preview, `picked` refers to the current question, not the one being
              // reviewed.
              const chosen = (reviewing ? shownPick : picked) === letter;
              // In the preview we show the correct answer right away — that's exactly what
              // it's there to read.
              const showVerdict = reviewing || picked !== null;

              const background = !showVerdict
                ? theme.surface
                : isCorrect
                  ? theme.good
                  : chosen
                    ? theme.bad
                    : theme.surface;
              const color = showVerdict && (isCorrect || chosen) ? theme.onFill : theme.text;

              /**
               * A verdict can't rest on colour alone.
               *
               * A green and a red background are the same greyish-green rectangle to an eye
               * with deuteranopia (close to 8% of men — the group sitting this exact exam) —
               * there was no way to tell the correct answer apart from your own mistake. The
               * attempt's question card has always got this right, with the words "Twoja
               * odpowiedź" (your answer) and "Poprawna" (correct); here there's no room for
               * words, so a mark takes the letter's place instead.
               *
               * The letter disappears without loss: it points out an option **before** the
               * answer, and after it there's nothing left to point out. Options with no
               * verdict keep theirs.
               */
              const mark =
                showVerdict && isCorrect ? '✓' : showVerdict && chosen ? '✗' : positionLabel(index);

              const answer = question.answers[letter] ?? '';

              const verdict = !showVerdict
                ? ''
                : isCorrect
                  ? chosen
                    ? '. Twoja odpowiedź, poprawna'
                    : '. Poprawna odpowiedź'
                  : chosen
                    ? '. Twoja odpowiedź, błędna'
                    : '';

              return (
                <Pressable
                  key={letter}
                  disabled={reviewing || picked !== null}
                  onPress={() => onAnswer(letter)}
                  accessibilityRole="button"
                  accessibilityLabel={`${positionLabel(index)}. ${answer}${verdict}`}
                  accessibilityState={{
                    selected: chosen,
                    disabled: reviewing || picked !== null,
                  }}
                  style={({ pressed }) => [
                    styles.answer,
                    { backgroundColor: background, borderColor: theme.border },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.answerLetter, { color }]}>{mark}</Text>
                  <Text style={[styles.answerText, { color }]}>{answer}</Text>
                </Pressable>
              );
            })
          : null}

        {/* A flashcard shows only the correct answer — the goal is memorising its content.
            Recognising it among distractors is what the ABC quiz practises. There are no
            letters here, since with a shuffled answer order they wouldn't mean anything
            anyway. */}
        {mode === 'flashcards' && !reviewing ? (
          revealed ? (
            <View style={[styles.flashcardAnswer, { backgroundColor: theme.good }]}>
              <Text style={[styles.flashcardAnswerText, { color: theme.onFill }]}>
                {question.answers[question.correct]}
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={() => setRevealed(true)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.reveal,
                { borderColor: theme.border, backgroundColor: theme.surface },
                pressed && styles.pressed,
              ]}
            >
              <Text style={{ color: theme.accent, fontSize: 16, fontWeight: '600' }}>
                Pokaż odpowiedź
              </Text>
            </Pressable>
          )
        ) : null}

        {/* The legal basis appears only after answering: the act's abbreviation alone gives
            the answer away. For "Handlowanie amunicją bez zezwolenia to…", seeing "KK" rules
            out a misdemeanour, i.e. solves the question without any actual knowledge. In the
            preview of earlier questions it's there right away, since the answer has already
            happened there.

            Tapping it cancels the advance scheduled after a correct answer in the ABC quiz.
            Without that the link appeared and vanished within 550 ms, so after a right
            answer the provision was unreachable — and had the tap landed, the timer would
            have moved the quiz on behind the act, bringing the reader back to a different
            question. Cancelling also puts "Dalej" (next) on screen for the way back. In
            flashcards and in the preview there's no timer, and the cancel does nothing. */}
        {question.law && (reviewing || (mode === 'flashcards' ? revealed : picked !== null)) ? (
          <View style={styles.law}>
            <LawLink law={question.law} onOpen={cancelPendingAdvance} />
          </View>
        ) : null}
      </ScrollView>

      {mode === 'flashcards' && revealed && !reviewing ? (
        <View style={[styles.selfAssess, { borderTopColor: theme.border }]}>
          <Pressable
            onPress={() => onSelfAssess(false)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.assessButton,
              { backgroundColor: theme.bad },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.assessLabel, { color: theme.onFill }]}>Nie wiedziałem</Text>
          </Pressable>
          <Pressable
            onPress={() => onSelfAssess(true)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.assessButton,
              { backgroundColor: theme.good },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.assessLabel, { color: theme.onFill }]}>Wiedziałem</Text>
          </Pressable>
        </View>
      ) : null}

      {canGoBack || showNext ? (
        <View
          style={[styles.nav, { borderTopColor: theme.border, backgroundColor: theme.surface }]}
        >
          <Pressable
            disabled={!canGoBack}
            onPress={onBack}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Poprzednie pytanie"
            accessibilityState={{ disabled: !canGoBack }}
            style={({ pressed }) => [styles.navSide, pressed && styles.pressed]}
          >
            {/* Disabled uses the dimmed text colour, not the border colour: the latter has a
                contrast of only 1.29:1 against the background, so the label disappeared
                completely and there was no sign that "back" even existed. The dimmed colour
                has 5.4:1 and still reads clearly different from the accent. */}
            <Text style={{ color: canGoBack ? theme.accent : theme.muted, fontSize: 16 }}>
              ‹ Poprzednie
            </Text>
          </Pressable>

          {showNext ? (
            <Pressable
              onPress={onNext}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.nextButton,
                { backgroundColor: theme.accent },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.nextLabel, { color: theme.onFill }]}>{reviewing ? 'Dalej ›' : 'Dalej'}</Text>
            </Pressable>
          ) : (
            <View style={styles.navSide} />
          )}
        </View>
      ) : null}

      {/* The whole footer opens the question list. A separate button in the header would be
          a second path to the exact same place, and a progress bar with numbers is a
          natural spot to want to tap, to see what's behind them. */}
      <Pressable
        // The same cancel as on the legal-basis link: this footer is the other way out of
        // the screen within the 550 ms after a correct answer, and without it the timer
        // moved the quiz on behind the question list.
        onPress={() => {
          cancelPendingAdvance();
          // The narrowing travels with the link. Without it the browser resolved the same
          // route to the whole area — six questions in this footer, 252 on the next screen.
          router.push(
            `/questions/${mode}/${params.sets}${examProfileId ? `?bledy=${examProfileId}` : ''}`,
          );
        }}
        accessibilityRole="button"
        // Without a label, a screen reader would read the three lines of numbers and
        // coloured captions as one long string, ending on "Przejrzyj pytania" (review
        // questions) — the action's name would arrive last, after everything that isn't it.
        accessibilityLabel={
          `Postęp: ${progress.mastered} opanowanych, ${progress.learning} w trakcie, `
          + `${progress.needsWork} do poprawy${isWeak ? '' : `, ${progress.untouched} nietkniętych`}. `
          + 'Przejrzyj pytania'
        }
        style={({ pressed }) => [
          styles.footer,
          {
            borderTopColor: theme.border,
            backgroundColor: theme.surface,
            paddingBottom: footerPadding,
          },
          pressed && styles.pressed,
        ]}
      >
        <SegmentedBar
          segments={[
            { value: progress.needsWork, color: theme.bad },
            { value: progress.learning, color: theme.accent },
            { value: progress.mastered, color: theme.good },
            { value: progress.untouched, color: theme.border },
          ]}
        />
        {/* Two lines: five numbers don't fit in one row at phone width, and there's plenty
            of room below the bar anyway. */}
        <Text style={[styles.stats, { color: theme.muted }]}>
          {isWeak
            ? `${progress.total} ${plural(progress.total, 'pytanie', 'pytania', 'pytań')} z pomyłkami · nadrobione ${progress.total - progress.needsWork}`
            : `${progress.total} ${plural(progress.total, 'pytanie', 'pytania', 'pytań')} · ${Math.round(progress.ratio * 100)}%`}
        </Text>
        <Text style={[styles.stats, { color: theme.muted }]}>
          <Text style={{ color: theme.bad }}>do poprawy {progress.needsWork}</Text>
          {'  ·  '}
          <Text style={{ color: theme.accent }}>w trakcie {progress.learning}</Text>
          {'  ·  '}
          <Text style={{ color: theme.good }}>opanowane {progress.mastered}</Text>
          {isWeak ? '' : `  ·  nietknięte ${progress.untouched}`}
        </Text>
        <Text style={[styles.stats, { color: theme.accent }]}>Przejrzyj pytania →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  body: { padding: 18, gap: 12, paddingBottom: 28 },
  question: { fontSize: 20, fontWeight: '600', lineHeight: 27, marginBottom: 6 },
  answer: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    alignItems: 'flex-start',
  },
  answerLetter: { fontSize: 16, fontWeight: '700', minWidth: 18 },
  answerText: { fontSize: 16, lineHeight: 22, flex: 1 },
  reveal: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 16,
    alignItems: 'center',
  },
  flashcardAnswer: { borderRadius: 12, padding: 18 },
  flashcardAnswerText: { color: '#ffffff', fontSize: 18, lineHeight: 26, fontWeight: '500' },
  law: { marginTop: 8 },
  selfAssess: { flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
  assessButton: { flex: 1, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  // The text colour is overridden at the point of use instead of `theme.onFill`: in dark
  // mode, white on a light fill has too little contrast.
  assessLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navSide: { minWidth: 108, paddingVertical: 6 },
  nextButton: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  nextLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  done: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 14 },
  doneMark: { fontSize: 52 },
  doneTitle: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  doneText: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 10 },
  doneButton: { alignSelf: 'stretch', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  doneButtonLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  footer: { padding: 14, gap: 6, borderTopWidth: StyleSheet.hairlineWidth },
  stats: { fontSize: 12, textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
