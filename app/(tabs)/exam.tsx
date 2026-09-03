import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AreaStandings } from '../../src/components/AreaStandings';
import { Button, Card, ModeSwitch, Muted } from '../../src/components/ui';
import { profileAvailable, profileMisses, profileQuestions } from '../../src/content/examPool';
import {
  type StoredAttempt,
  areaStandings,
  clearAttempts,
  deleteAttempt,
  missedQuestionIds,
  recentAttempts,
} from '../../src/db/database';
import {
  EXAM_PROFILES,
  type AreaTally,
  type ExamProfileId,
  PATENT_PROFILE,
  examProfile,
  criticalCount,
} from '../../src/engine/exam';
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

/**
 * Profiles this build can actually run.
 *
 * The WPA paper draws from a set that ships in the content bundle, so a bundle without it
 * would leave a button that throws the moment it's tapped. One option fewer is the better
 * failure — and on today's bundle both are here.
 */
const AVAILABLE = EXAM_PROFILES.filter(profileAvailable);

export default function EgzaminScreen() {
  const theme = useTheme();
  const router = useRouter();

  /**
   * Which exam is on screen. Everything below the switch belongs to it: the rules, both
   * buttons and the history — „9/10" and „18/20" are different scales and must never end up
   * in one list.
   */
  // The first profile the bundle can actually serve, not the licence one by name: with the
  // paper composed from subject areas, a bundle missing one set makes that exam undrawable,
  // and the switch then hides it while the screen would still offer its button.
  const [profileId, setProfileId] = useState<ExamProfileId>(AVAILABLE[0]?.id ?? PATENT_PROFILE.id);
  const profile = examProfile(profileId);

  /** `null` until the profile's history has been read — never an empty list standing in for it. */
  const [attempts, setAttempts] = useState<StoredAttempt[] | null>(null);

  /**
   * How many questions go into "egzamin z moich błędów" (exam from my mistakes).
   *
   * Exam mistakes only — the same source an attempt draws its pool from. This used to be
   * quiz-mode practice progress, so someone who took exams but never practised with the ABC
   * quiz never saw the button, despite having actual mistakes of their own. The exam is a
   * separate progress track and doesn't connect to practice mode in either direction.
   *
   * Counted from this profile's own attempts, through the same two calls the attempt makes,
   * so the number can't promise questions the draw would then refuse to use — and can't
   * count mistakes made in the other exam, which is what it did when the two shared a pool.
   */
  const [missedCount, setMissedCount] = useState(0);

  /** Per-area standing, and how many attempts it rests on. */
  const [standings, setStandings] = useState<{ attempts: number; areas: Map<string, AreaTally> }>({
    attempts: 0,
    areas: new Map(),
  });

  const pool = useMemo(() => profileQuestions(profile), [profile]);

  const refresh = useCallback(() => {
    void recentAttempts(profile.id).then(setAttempts);
    void missedQuestionIds(profile.id).then((ids) =>
      setMissedCount(profileMisses(ids, pool).length),
    );
    void areaStandings(profile.id).then(setStandings);
  }, [profile, pool]);

  useFocusEffect(refresh);

  /**
   * Switching profiles drops what's on screen before the new read comes back.
   *
   * The database read is asynchronous, so the render between the tap and its result still
   * holds the previous profile's attempts — under the new profile's heading. Left alone,
   * the screen briefly lists a licence-exam paper as a WPA one. Clearing here means the
   * gap shows nothing rather than something false.
   */
  const onSelectProfile = useCallback((id: ExamProfileId) => {
    setProfileId(id);
    setAttempts(null);
    setMissedCount(0);
    setStandings({ attempts: 0, areas: new Map() });
  }, []);

  const onDelete = useCallback(
    // The denominator comes from the attempt's own profile, never from the switch. The two
    // agree once the read has landed, but not during it — and „18/10" in a confirmation
    // dialog is exactly the kind of number nobody can un-see.
    (attempt: StoredAttempt) => {
      Alert.alert(
        'Usunąć to podejście?',
        `${attempt.score}/${examProfile(attempt.profile).questionCount} z ${formatDate(attempt.finishedAt)}. Tej operacji nie da się cofnąć.`,
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
      // Only what's on screen: the other profile's attempts aren't visible here, and wiping
      // them from a screen that doesn't show them would destroy them unseen. Settings still
      // has the button that clears everything.
      `Wyczyścić historię — ${profile.title}?`,
      'Znikną wszystkie zapisane podejścia do tego egzaminu. Drugi egzamin i postęp w ćwiczeniach zostają nietknięte.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Wyczyść',
          style: 'destructive',
          onPress: () => {
            void clearAttempts(profile.id).then(refresh);
          },
        },
      ],
    );
  }, [profile, refresh]);

  const passed = (attempts ?? []).filter((attempt) => attempt.passed).length;
  const minutes = profile.timeLimitSeconds / 60;
  const criticals = criticalCount(profile);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={[styles.heading, { color: theme.text }]}>Egzamin próbny</Text>

      {AVAILABLE.length > 1 ? (
        <ModeSwitch
          options={AVAILABLE.map((entry) => ({ key: entry.id, label: entry.title }))}
          value={profile.id}
          onChange={onSelectProfile}
        />
      ) : null}

      <Card>
        <Text style={[styles.rules, { color: theme.text }]}>
          {profile.questionCount} pytań · {minutes} minut · próg {profile.passThreshold}/
          {profile.questionCount}
        </Text>
        {criticals > 0 ? (
          <Muted>
            Pierwsze {criticals} pytania — z UoBiA i zasad bezpieczeństwa — muszą być bezbłędne;
            ile z nich jest o bezpieczeństwie, jest losowe (0–2). Dalej po dwa pytania
            z pozostałych trzech zagadnień.
          </Muted>
        ) : (
          <Muted>
            Egzamin przed komisją w wydziale postępowań administracyjnych, na zasadach z § 4
            rozporządzenia o egzaminie. Pytań krytycznych nie ma — liczy się sam wynik.
          </Muted>
        )}
        <Muted>
          Kolejność pytań i odpowiedzi jest losowana, żeby nie dało się wkuwać pozycji.
        </Muted>
      </Card>

      <AreaStandings
        profile={profile}
        attempts={standings.attempts}
        areas={standings.areas}
        onOpen={(slug) => router.push(`/practice/test/${slug}`)}
      />

      <Button
        label="Rozpocznij egzamin"
        onPress={() => router.push(`/exam/attempt?profile=${profile.id}`)}
      />

      {missedCount > 0 ? (
        <>
          <Button
            label="Egzamin z moich błędów"
            tone="neutral"
            onPress={() => router.push(`/exam/attempt?profile=${profile.id}&pool=weak`)}
          />
          <Muted>
            {/* „w egzaminach" (in exams) was true when the pool spanned both profiles, and
                stayed on screen as a promise the draw no longer keeps. */}
            Losowany z {missedCount} {plural(missedCount, 'pytania', 'pytań', 'pytań')},{' '}
            {/* The noun was inflected but the pronoun wasn't, so exactly one mistake read
                „z 1 pytania, na których". One mistake is the common case on a fresh
                profile, since each exam keeps its own pool. */}
            {plural(missedCount, 'na którym', 'na których', 'na których')} pomyliłeś się
            w tym egzaminie. Zasady te same; gdy błędów nie starcza w jakimś zagadnieniu, brakujące
            pytania dobierane są z całej puli tego zagadnienia.
          </Muted>
        </>
      ) : null}

      <View style={styles.historyHeader}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Historia</Text>
        {attempts && attempts.length > 0 ? (
          <Muted>
            {passed} {plural(passed, 'zdane', 'zdane', 'zdanych')} z {attempts.length}
          </Muted>
        ) : null}
      </View>

      {/* Nothing at all until the read lands — an empty list would otherwise claim, for a
          frame, that this exam has never been taken. */}
      {attempts === null ? null : attempts.length === 0 ? (
        <Muted>Jeszcze nie podchodziłeś do tego egzaminu.</Muted>
      ) : (
        attempts.map((attempt) => {
          // Each row states its own scale, so a row can never be shown under a scale that
          // isn't its own — not even in the render between switching profiles and the new
          // history arriving.
          const attemptProfile = examProfile(attempt.profile);

          return (
            <Card
              key={attempt.id}
              onPress={() => router.push(`/exam/result/${attempt.id}`)}
              onLongPress={() => onDelete(attempt)}
              longPressLabel="Usuń to podejście"
              accessibilityLabel={
                `${attempt.passed ? 'Zdane' : 'Niezdane'}, ${attempt.score} na ${attemptProfile.questionCount}`
                + `${attempt.criticalFailed ? ', błąd w pytaniach krytycznych' : ''}`
                + `, ${formatDate(attempt.finishedAt)}`
              }
            >
              <View style={styles.attemptRow}>
                <Text
                  style={[styles.attemptScore, { color: attempt.passed ? theme.good : theme.bad }]}
                >
                  {attempt.score}/{attemptProfile.questionCount}
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
          );
        })
      )}

      {attempts && attempts.length > 0 ? (
        <>
          <Muted>Przytrzymaj podejście, żeby je usunąć.</Muted>
          <Pressable
            onPress={onClearAll}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => [styles.clearAll, pressed && { opacity: 0.6 }]}
          >
            {/* The profile is named rather than pointed at. „Historia tego egzaminu" reads
                ambiguously above a list of attempts, where „egzamin" means one attempt as
                readily as it means the exam being simulated. */}
            <Text style={{ color: theme.bad, fontSize: 15, fontWeight: '600' }}>
              Wyczyść historię — {profile.title}
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
