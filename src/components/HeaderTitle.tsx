import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '../theme';

/**
 * A header title that decides its own alignment.
 *
 * The problem: Android left-aligns the title, iOS centres it, and forcing centring on both
 * ate up space. Under centring, the title's width is `screen − 2 × the wider side`, so a
 * narrow back arrow gains nothing — the wide right-hand group („Spis" plus the magnifier)
 * decides it. An act's title kept getting cut off despite empty space on the left.
 *
 * The fix doesn't need any measuring: give the title the **entire** available width and
 * centre its own text. A short one („Nauka") lands in the middle, since it has room on both
 * sides. A long one fills the width completely and gets cut off at the end — at which point
 * alignment has nothing left to shift anyway. The result is the one we wanted: centred when
 * it fits, left-aligned when it doesn't.
 *
 * Tapping shows the full name. A cut-off title is the one place where the user loses
 * information, and the list they came from is a screen back already. When nothing was cut off
 * and there's nothing extra to say, tapping does nothing — no greying-out and no extra text
 * that would just clutter the header.
 */
export function HeaderTitle({ title, full }: { title: string; full?: string }) {
  const theme = useTheme();
  const [clipped, setClipped] = useState(false);

  // `onTextLayout` returns the lines after wrapping and truncation, so comparing them against
  // the original says directly whether anything disappeared — no width measurement, no
  // guessing.
  const onTextLayout = useCallback(
    (event: { nativeEvent: { lines: { text: string }[] } }) => {
      const shown = event.nativeEvent.lines.map((line) => line.text).join('').trim();
      setClipped(shown !== title.trim());
    },
    [title],
  );

  const hasMore = full !== undefined && full !== title;
  const onPress = useCallback(() => {
    if (!clipped && !hasMore) return;
    Alert.alert(title, hasMore ? full : undefined);
  }, [clipped, hasMore, title, full]);

  return (
    <Pressable
      onPress={onPress}
      style={styles.press}
      // Without this the screen reader would announce the title as a button even when
      // tapping does nothing.
      accessibilityRole={clipped || hasMore ? 'button' : 'header'}
    >
      <Text
        numberOfLines={1}
        onTextLayout={onTextLayout}
        style={[styles.title, { color: theme.text }]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // `justifyContent` matters here, it isn't cosmetic: without it the container stretched to
  // the header's full height and the text sat against the top edge, visibly higher than the
  // back arrow and the right-hand actions. We don't force a width — the native header already
  // positions the title per platform convention (centred on iOS, left-aligned on Android).
  press: { justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '600' },
});
