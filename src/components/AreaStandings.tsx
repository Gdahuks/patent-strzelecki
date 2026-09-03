import { Pressable, StyleSheet, Text, View } from 'react-native';

import { content } from '../content/store';
import type { AreaTally, ExamProfile } from '../engine/exam';
import { useTheme } from '../theme';
import { Card, Muted } from './ui';

/**
 * How well each subject area is going — the answer to "what am I worst at".
 *
 * Deliberately **not sorted by result**. The areas keep the order they have on the paper, so
 * the table reads as the exam's own shape, and a row is recognised by where it sits rather
 * than by a rank that reshuffles after every attempt.
 *
 * A weak area is therefore marked, not ranked. Marking beats ranking on three counts: the
 * areas are not equal (a mistake in the opening four fails the paper on its own, a mistake
 * later costs one of the single point the pass mark allows), two results twenty answers apart
 * differ by three questions and picking a "worst" between them is a coin toss, and with
 * everything above its threshold nothing needs pointing at.
 */

/** Below this share of correct answers an area is flagged. */
const THRESHOLDS = {
  /**
   * The zero-tolerance opening. One mistake there fails the paper regardless of the score,
   * so four questions at 90% each still leave a one-in-three chance of failing on them —
   * which is why the bar for these areas sits far higher than for the rest.
   */
  critical: 0.9,
  /** The remaining six questions share one permitted mistake. */
  rest: 0.75,
};

/**
 * Answers in one area before its percentage means anything.
 *
 * Three, not five, and the reason is the weighted opening: the safety rules come up about once
 * a paper while every other area gets two, so a bar of five would leave the one area whose
 * questions fail the paper on their own mute for another two attempts after the table appears.
 * At three the table speaks about all five rows the moment it shows up.
 *
 * Nothing is hidden by going this low, either — the counter sits right next to the percentage,
 * so "0/3" discloses its own sample. A thin sample matters when the result is near the
 * threshold, not when it is 0 out of 3.
 */
const MIN_ANSWERS = 3;

/** Attempts before the table is worth showing at all. */
const MIN_ATTEMPTS = 3;

export function AreaStandings({
  profile,
  attempts,
  areas,
  onOpen,
}: {
  profile: ExamProfile;
  /** Attempts the tally rests on — only those that recorded their areas. */
  attempts: number;
  areas: Map<string, AreaTally>;
  onOpen: (slug: string) => void;
}) {
  const theme = useTheme();

  // The areas in paper order: bands as the profile lists them, sources within a band in the
  // order they are drawn. One area means nothing to compare, which is the police exam.
  const slugs = profile.layers.flatMap((layer) => layer.sources.map((source) => source.category));
  const criticals = profile.layers
    .filter((layer) => layer.critical)
    .flatMap((layer) => layer.sources.map((source) => source.category));

  if (slugs.length < 2 || attempts < MIN_ATTEMPTS) return null;

  return (
    <Card>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Twoje wyniki po zagadnieniach</Text>
        <Muted>z {attempts} podejść</Muted>
      </View>

      {slugs.map((slug, index) => {
        const tally = areas.get(slug) ?? { seen: 0, correct: 0 };
        const share = tally.seen > 0 ? tally.correct / tally.seen : 0;
        const enough = tally.seen >= MIN_ANSWERS;
        const critical = criticals.includes(slug);
        const weak = enough && share < (critical ? THRESHOLDS.critical : THRESHOLDS.rest);

        return (
          <Pressable
            key={slug}
            onPress={() => onOpen(slug)}
            accessibilityRole="button"
            accessibilityLabel={
              `${content.titleForSets([slug])}. `
              + (enough
                ? `${Math.round(share * 100)} procent, ${tally.correct} z ${tally.seen}${weak ? ', do poprawy' : ''}`
                : `${tally.correct} z ${tally.seen} pytań`)
            }
            style={({ pressed }) => [
              styles.row,
              // The paper's opening four end here. A line rather than a sentence: the card
              // above already says what that group is.
              index === criticals.length && { borderTopColor: theme.border, borderTopWidth: 1 },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
              {content.titleForSets([slug])}
            </Text>
            {enough ? (
              <Text style={[styles.share, { color: weak ? theme.bad : theme.muted }]}>
                {/* The mark carries a shape as well as a colour — the same rule the quiz's
                    verdicts follow, because a red and a grey number are one number under
                    deuteranopia. */}
                {weak ? '⚠ ' : ''}
                {Math.round(share * 100)}%
              </Text>
            ) : null}
            <Text style={[styles.count, { color: theme.muted }]}>
              {tally.correct}/{tally.seen}
            </Text>
          </Pressable>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  pressed: { opacity: 0.65 },
  name: { flex: 1, fontSize: 14 },
  share: { fontSize: 14, fontWeight: '600', minWidth: 62, textAlign: 'right' },
  count: { fontSize: 13, minWidth: 52, textAlign: 'right' },
});
