import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

/**
 * How many numbers go into one row.
 *
 * Not a matter of taste: the chip is 28 px wide and an iPhone SE leaves 351 px between the
 * screen edges, so ten of them take 280 px and an eleventh doesn't fit. The WPA paper has
 * twenty questions, hence more than one row — and the split is done by hand rather than with
 * `flexWrap`, which would fit as many as the width allows (eleven, then nine) and leave the
 * short row spread out by `justifyContent: 'space-between'`. Fixed rows of ten stay
 * symmetric on every screen.
 */
const PER_ROW = 10;

/** Gap between rows. Half of it is the vertical `hitSlop` a multi-row strip can afford. */
const ROW_GAP = 16;

/**
 * The exam's question-number strip.
 *
 * The exam lets you move on without picking an answer — an accidental tap on „Dalej" left a
 * gap you'd only find out about when submitting the paper, with no way to tell which question
 * it was. The strip shows the whole paper's state right away and lets you jump to any question
 * with one tap.
 *
 * A filled-in number is a question that already has an answer; the outline marks the current
 * one.
 */
export function ExamStrip({
  count,
  answered,
  current,
  onJump,
}: {
  count: number;
  /** Whether the question at this index — zero-based — already has an answer. */
  answered: (index: number) => boolean;
  current: number;
  onJump: (index: number) => void;
}) {
  const theme = useTheme();

  const rows: number[][] = [];
  for (let start = 0; start < count; start += PER_ROW) {
    rows.push(Array.from({ length: Math.min(PER_ROW, count - start) }, (_, i) => start + i));
  }

  // A single row stands alone above the question, so it can spend 10 px downwards and reach
  // 48 dp. With a second row underneath, that same 10 px would reach into the neighbour's
  // circle, so it drops to half the gap between rows.
  const vertical = rows.length > 1 ? ROW_GAP / 2 : 10;

  return (
    <View
      style={[styles.strip, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}
    >
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((index) => {
            const done = answered(index);
            const here = index === current;

            return (
              <Pressable
                key={index}
                onPress={() => onJump(index)}
                // Widened more vertically than horizontally, and that's deliberate. Ten
                // numbers across a phone's width leave about 9 px of gap between them, so a
                // zone wider than half that gap starts stealing taps from the neighbour — and
                // being off by one question number in the exam is worse than a small target.
                // Don't "fix" this into an equal hitSlop on all sides.
                hitSlop={{ top: vertical, bottom: vertical, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityLabel={`Pytanie ${index + 1}${done ? ', odpowiedziane' : ', bez odpowiedzi'}`}
                accessibilityState={{ selected: here }}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: done ? theme.accent : theme.bg,
                    borderColor: here ? theme.text : done ? theme.accent : theme.border,
                    borderWidth: here ? 2 : StyleSheet.hairlineWidth,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.number,
                    { color: done ? theme.onFill : theme.muted, fontWeight: here ? '700' : '600' },
                  ]}
                  // The numbers grow with the system setting like the rest of the app —
                  // `allowFontScaling={false}` used to sit here, which was the one place where
                  // text stayed small for someone who enlarged the system font.
                  //
                  // The 1.3 cap comes from arithmetic, not caution: the circle has to stay at
                  // 28 px (see PER_ROW). At 1.3 a two-digit number is ~19 px wide and still
                  // fits inside the circle; any higher and it spills out.
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                >
                  {index + 1}
                </Text>
              </Pressable>
            );
          })}
          {/* A short last row keeps its numbers under the ones above instead of spreading
              across the width — the strip reads as a grid of the paper, not as a ribbon. */}
          {Array.from({ length: PER_ROW - row.length }, (_, i) => (
            <View key={`filler${i}`} style={styles.chip} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: ROW_GAP,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  chip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: { fontSize: 13 },
  pressed: { opacity: 0.6 },
});
