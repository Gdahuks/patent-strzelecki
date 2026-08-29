import { type StyleProp, Text, type TextStyle } from 'react-native';

import type { Mark } from '../content/search';
import { useTheme } from '../theme';

/**
 * A line of text with one range set like a highlighter stroke — the search phrase inside a
 * result card.
 *
 * The excerpt on a card used to set the matched word exactly like the words around it, so
 * the reader had to find it by eye. The range comes from the search itself (`Mark`), which
 * knows where the phrase landed; this component only draws it. A ground colour rather than
 * bold, because a question's text is already bold and a bold match inside it showed nothing.
 * With no mark, the text is rendered as is.
 */
export function Marked({
  text,
  mark,
  style,
}: {
  text: string;
  mark: Mark;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  if (!mark) return <Text style={style}>{text}</Text>;

  const [from, to] = mark;
  return (
    <Text style={style}>
      {text.slice(0, from)}
      <Text style={{ backgroundColor: theme.mark, color: theme.text }}>{text.slice(from, to)}</Text>
      {text.slice(to)}
    </Text>
  );
}
