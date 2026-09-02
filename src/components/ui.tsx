import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

/**
 * Card — a content container, tappable once it's given an action.
 *
 * `longPressLabel` is required together with `onLongPress`, and it isn't decorative:
 * long-press is sometimes the **only** way to reach a function (resetting a set, clearing a
 * lesson's reading state, deleting an attempt), and long-press is practically invisible to a
 * screen reader — VoiceOver and TalkBack claim the gesture for their own purposes.
 * `accessibilityActions` exposes the same action in VoiceOver's rotor and in TalkBack's menu,
 * i.e. exactly where a screen reader user looks for it. Nothing changes on screen: sighted
 * users still get only the long-press.
 */
export function Card({
  children,
  onPress,
  onLongPress,
  longPressLabel,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** The long-press action's name, shown in the screen reader's rotor. */
  longPressLabel?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const style = [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }];

  if (!onPress && !onLongPress) return <View style={style}>{children}</View>;

  return (
    <Pressable
      style={({ pressed }) => [...style, pressed && styles.pressed]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityActions={
        onLongPress ? [{ name: 'longpress', label: longPressLabel ?? 'Więcej' }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'longpress') onLongPress?.();
      }}
    >
      {children}
    </Pressable>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.title, { color: theme.text }]}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.muted, { color: theme.muted }]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  tone = 'accent',
}: {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'neutral';
}) {
  const theme = useTheme();
  const background = tone === 'accent' ? theme.accent : theme.surface;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, borderColor: theme.border },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonLabel, { color: tone === 'accent' ? theme.onFill : theme.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Deck progress bar — the share of mastered material. */
export function ProgressBar({ ratio }: { ratio: number }) {
  const theme = useTheme();
  const width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%` as const;

  return (
    <View style={[styles.track, { backgroundColor: theme.border }]}>
      <View style={[styles.fill, { width, backgroundColor: theme.accent }]} />
    </View>
  );
}

export interface BarSegment {
  value: number;
  color: string;
}

/**
 * A bar made of segments — shows the whole deck's distribution, not a single number.
 *
 * A single bar only told you the average mastery level and lost how many questions are
 * untouched versus how many are waiting to be corrected.
 */
export function SegmentedBar({ segments }: { segments: BarSegment[] }) {
  const theme = useTheme();
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);

  if (total <= 0) {
    return <View style={[styles.track, { backgroundColor: theme.border }]} />;
  }

  return (
    <View style={[styles.track, { backgroundColor: theme.border }]}>
      {segments
        .filter((segment) => segment.value > 0)
        .map((segment, index) => (
          <View
            key={index}
            style={{
              width: `${(segment.value / total) * 100}%`,
              backgroundColor: segment.color,
              height: '100%',
            }}
          />
        ))}
    </View>
  );
}

/**
 * A switch between two or three views of the same screen — practice modes, exam profiles.
 *
 * The selection shows purely as a filled background, so `accessibilityState` isn't optional
 * here: without it a screen reader announces identical options and there's no way to tell
 * which list is on screen.
 */
export function ModeSwitch<Key extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { key: Key; label: string }[];
  value: Key;
  onChange: (key: Key) => void;
  /**
   * What the switch as a whole chooses.
   *
   * Needed once a screen carries two of these: the options announce themselves as tabs, so a
   * screen reader otherwise reads four tabs in a row with nothing saying they are two
   * separate choices.
   */
  label?: string;
}) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={[styles.switch, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.switchOption,
              active && { backgroundColor: theme.accent },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.switchLabel, { color: active ? theme.onFill : theme.text }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 6,
  },
  pressed: { opacity: 0.65 },
  title: { fontSize: 16, fontWeight: '600' },
  muted: { fontSize: 13, lineHeight: 18 },
  button: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  track: { height: 7, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
  fill: { height: '100%', borderRadius: 3 },
  switch: {
    flexDirection: 'row',
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  switchOption: { flex: 1, borderRadius: 9, paddingVertical: 9, alignItems: 'center' },
  switchLabel: { fontSize: 15, fontWeight: '600' },
});
