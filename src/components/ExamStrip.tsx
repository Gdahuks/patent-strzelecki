import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

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

  return (
    <View style={[styles.strip, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
      {Array.from({ length: count }, (_, index) => {
        const done = answered(index);
        const here = index === current;

        return (
          <Pressable
            key={index}
            onPress={() => onJump(index)}
            // Widened only vertically, and that's deliberate. Ten numbers across a phone's
            // width leave about 9 px of gap between them, so a zone wider than half that gap
            // starts stealing taps from the neighbour — and being off by one question number
            // in the exam is worse than a small target. Vertically the strip stands alone, so
            // 10 px gives 48 dp of height at no cost. Don't "fix" this into an equal hitSlop
            // on all sides.
            hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
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
              // 28 px, because ten numbers have to fit in a single row (on an iPhone SE that's
              // 280 px out of 351 available — there's no room for a bigger chip). At 1.3 a
              // two-digit number is ~19 px wide and still fits inside the circle; any higher
              // and it spills out.
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
            >
              {index + 1}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
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
