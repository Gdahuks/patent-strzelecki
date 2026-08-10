import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '../theme';

/**
 * A header action, drawn as an icon instead of a word.
 *
 * Vector icons, not emoji or Unicode glyphs. Emoji render in their own fixed colours, so they
 * ignore the accent colour and look the same in both themes — a `🔍` next to a monochrome `☰`
 * produced a header made of two different visual worlds. Unicode glyphs have a different
 * problem: the closest one to a magnifying glass (`⌕`) is actually "TELEPHONE RECORDER", and
 * its look depends on the system font, so it would render as a box on some devices.
 * `@expo/vector-icons` ships with Expo already, so it isn't a new dependency.
 *
 * Text colour, not accent colour. Blue is iOS's convention for **text** buttons in a bar; on
 * icons it looked garish, and it also clashed with the back arrow, which the native header
 * draws in `headerTintColor` (i.e. the text colour). Toolbar icons on Android are in the
 * content colour, and the fact that they're tappable comes from their position, not their
 * colour. The one exception is `danger`, where the colour itself carries the warning.
 *
 * The label is required, because the icon alone says nothing to a screen reader — this is the
 * one place where the action's name still exists, ever since it disappeared from the screen.
 */
export function HeaderIcon({
  name,
  label,
  onPress,
  tone = 'default',
  expanded,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** `danger` for destructive actions — the colour is the only warning left. */
  tone?: 'default' | 'danger';
  /** For icons that toggle a panel: the screen reader then says "expanded/collapsed". */
  expanded?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name={name} size={22} color={tone === 'danger' ? theme.bad : theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 12, paddingVertical: 4 },
  pressed: { opacity: 0.6 },
});
