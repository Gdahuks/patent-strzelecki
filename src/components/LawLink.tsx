import { type Router, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { findAct, needsSourceList, resolveLaw, sourceName, sourceUrl } from '../content/acts';
import { openInAppBrowser } from '../content/openSource';
import { type Theme, useTheme } from '../theme';

/**
 * A question's legal basis, tappable when we have the matching act.
 *
 * Tapping opens the act right at the cited article or paragraph — after a mistake you can
 * read the source provision immediately, instead of hunting for it yourself.
 *
 * Items we don't have in text form open in the in-app browser, with no intermediate screen.
 * They're **clearly marked**, with an arrow and a different colour — not to warn about
 * leaving the app, since you don't leave it, but to make it visible that this content isn't
 * offline and needs an internet connection.
 */
/**
 * Opens a legal basis's target: an offline act, a sources screen, or a scan in the browser.
 *
 * Pulled out of the component because accessibility-merging cards (a search result, a
 * question-review row) have to expose this same action as a rotor action — a nested
 * `Pressable` inside them is unreachable to a screen reader. A basis with no resolved act
 * does nothing, the same way `LawLink` renders it as plain text in that case.
 */
export function openLaw(law: string, router: Router, theme: Theme): void {
  const target = resolveLaw(law);
  if (!target) return;

  if (target.readable) {
    router.push(target.ref ? `/act/${target.slug}?ref=${target.ref}` : `/act/${target.slug}`);
    return;
  }

  const act = findAct(target.slug);
  if (act && needsSourceList(act)) {
    router.push(`/act/${target.slug}`);
    return;
  }
  openInAppBrowser(act ? sourceUrl(act) : '', theme);
}

/**
 * The rotor action that opens a legal basis — for cards that merge accessibility.
 *
 * The guard and the label's wording live in one place, because the same action lives in two
 * screens (a search result, question review) and separate copies would drift apart on the
 * first change — exactly like the two copies of the attempt-question card once did.
 * Returns null when there's no basis, or it doesn't point to a known act — in that case
 * `LawLink` renders it as plain text and there's nothing to expose as an action.
 */
export function lawAccessibilityAction(
  law: string | undefined,
): { name: string; label: string } | null {
  if (!law || !resolveLaw(law)) return null;
  return { name: 'law', label: `Otwórz podstawę prawną: ${law}` };
}

export function LawLink({ law }: { law: string }) {
  const theme = useTheme();
  const router = useRouter();

  if (!law.trim()) return null;

  const target = resolveLaw(law);

  if (!target) {
    return <Text style={[styles.plain, { color: theme.muted }]}>{law}</Text>;
  }

  const open = () => openLaw(law, router, theme);

  // The target's name instead of the word „źródło" — but only when the basis text doesn't
  // already carry it. `sourceName` decides that; what's left here is just assembling the
  // string.
  const act = target.readable ? undefined : findAct(target.slug);
  const name = act ? sourceName(law, act) : null;

  return (
    <Pressable
      onPress={open}
      // Deliberately small, even though a 13-pixel label gives a target below the guideline.
      // The legal basis sits **inside** tappable cards (a search result, a row in question
      // review), and a nested `Pressable` wins over its parent — every extra pixel added here
      // is a tap stolen from the card, i.e. going to the act instead of to the lesson. The
      // guideline loses to correctness here, and that's a deliberate choice.
      hitSlop={6}
      accessibilityRole="link"
      // „w przeglądarce" got dropped from here: an item with several documents opens
      // **inside the app**, a card with their list (`needsSourceList`), so the announcement
      // was sometimes false. The label now carries the same thing that's visible — the word
      // „źródło" or the target's name.
      accessibilityLabel={
        target.readable
          ? `Podstawa prawna: ${law}. Otwiera akt.`
          : `Podstawa prawna: ${law}. Otwiera źródło${name ? `: ${name}` : ''}.`
      }
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Text style={[styles.link, { color: target.readable ? theme.accent : theme.muted }]}>
        {law}
        {/* We don't repeat the unit number here: the course's own basis text almost always
            already carries it, so it used to read „KK - Art. 263, § 1 · Art. 263". The arrow
            is enough to show that this is tappable. */}
        {target.readable ? '  →' : `  ·  ${name ?? 'źródło'} ↗`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  plain: { fontSize: 13, fontStyle: 'italic' },
  link: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
