import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { WebView } from 'react-native-webview';

import {
  type FindState,
  MIN_FIND_LENGTH,
  findCommands,
  findLabel,
  findNeedle,
  parseFindMessage,
} from '../content/findInPage';
import { announce } from '../a11y/announce';
import { useTheme } from '../theme';

/**
 * The in-page search bar — one for both a lesson and an act.
 *
 * Previously each of these screens had its own copy: the same field, the same counter, the
 * same arrows, the same styles under different names. They'd already drifted apart (the
 * lesson had a „Szukaj" key on the keyboard, the act didn't) — exactly the same bug that
 * `AttemptAnswerCard` fixed earlier.
 *
 * Driving the page lives next to it, in `useFindInPage` — the bar itself doesn't inject
 * anything.
 */

/**
 * Delay between the last keystroke and recalculating the hit count.
 *
 * The script walks the whole document, and the Kodeks karny (Penal Code) is 540 KB of text.
 * Without a delay, typing the word „przechowywanie" (storage) triggered fourteen full passes,
 * of which only the last one mattered. 160 ms is shorter than the pause between keystrokes in
 * ordinary typing, so the counter still appears just as "instantly".
 */
const FIND_DELAY = 160;

export interface FindInPage {
  open: boolean;
  query: string;
  state: FindState | null;
  /** New field contents — recalculation reaches the page after `FIND_DELAY`. */
  change: (query: string) => void;
  step: (delta: number) => void;
  close: () => void;
  /** The magnifier icon in the header: opens the bar, or closes it along with the highlights. */
  toggle: () => void;
  /** A message from the page — true when it concerned search and was consumed. */
  accept: (raw: string) => boolean;
  /** Reruns the current phrase once more, after the page loads (the script only exists then). */
  rerun: () => void;
}

export function useFindInPage(
  webview: RefObject<WebView | null>,
  initialQuery = '',
): FindInPage {
  // A phrase passed in from search results opens the bar right away — otherwise the
  // highlight would appear for no visible reason, with no way to jump between hits.
  const [open, setOpen] = useState(initialQuery.length > 0);
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<FindState | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last phrase actually sent to the page, already normalized: „broń" and „broń " are
  // the same to us, so the second form doesn't trigger another pass over the document.
  const running = useRef('');

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const run = useCallback(
    (next: string) => {
      const needle = findNeedle(next);
      if (needle === running.current) return;
      running.current = needle;
      webview.current?.injectJavaScript(findCommands.run(needle));
    },
    [webview],
  );

  const change = useCallback(
    (next: string) => {
      setQuery(next);
      stop();
      timer.current = setTimeout(() => {
        timer.current = null;
        run(next);
      }, FIND_DELAY);
    },
    [run, stop],
  );

  const step = useCallback(
    (delta: number) => {
      webview.current?.injectJavaScript(findCommands.step(delta));
    },
    [webview],
  );

  const close = useCallback(() => {
    stop();
    running.current = '';
    setOpen(false);
    setQuery('');
    setState(null);
    webview.current?.injectJavaScript(findCommands.clear());
  }, [stop, webview]);

  // Closing via the magnifier icon **must** clear the highlights. Previously only the
  // „Zamknij" button did that, so after finding a phrase and tapping the magnifier, the bar
  // disappeared, the yellow highlighting stayed, and there was nothing left to remove it.
  const toggle = useCallback(() => {
    if (open) close();
    else setOpen(true);
  }, [open, close]);

  const accept = useCallback((raw: string) => {
    const found = parseFindMessage(raw);
    if (!found) return false;
    setState(found);

    // Announced to the screen reader when **the result arrives**, not when the label text
    // changes: two different phrases can produce the same message („Brak trafień"), and an
    // effect that diffs strings stayed silent on the second one. The guard on `running` skips
    // passes for a too-short phrase — `findNeedle` returns an empty string for those, and the
    // page answers with zero hits, which isn't worth announcing since the label already says
    // „min. 3 znaki".
    if (running.current.length >= MIN_FIND_LENGTH) {
      announce(found.total === 0 ? 'Brak trafień' : `Trafienie ${found.index} z ${found.total}`);
    }
    return true;
  }, []);

  const rerun = useCallback(() => {
    running.current = '';
    run(query);
  }, [run, query]);

  return { open, query, state, change, step, close, toggle, accept, rerun };
}

export function FindBar({
  placeholder,
  query,
  state,
  onChange,
  onStep,
  onClose,
}: {
  placeholder: string;
  query: string;
  state: FindState | null;
  onChange: (query: string) => void;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const canStep = Boolean(state?.total);

  return (
    <View style={[styles.bar, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
      <TextInput
        value={query}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.bg, borderColor: theme.border },
        ]}
      />
      <Text style={[styles.count, { color: theme.muted }]}>{findLabel(query, state)}</Text>

      <Pressable
        disabled={!canStep}
        onPress={() => onStep(-1)}
        accessibilityRole="button"
        accessibilityLabel="Poprzednie trafienie"
        accessibilityState={{ disabled: !canStep }}
        style={({ pressed }) => [styles.step, pressed && styles.pressed]}
      >
        <Text style={{ color: canStep ? theme.accent : theme.muted, fontSize: 20 }}>‹</Text>
      </Pressable>
      <Pressable
        disabled={!canStep}
        onPress={() => onStep(1)}
        accessibilityRole="button"
        accessibilityLabel="Następne trafienie"
        accessibilityState={{ disabled: !canStep }}
        style={({ pressed }) => [styles.step, pressed && styles.pressed]}
      >
        <Text style={{ color: canStep ? theme.accent : theme.muted, fontSize: 20 }}>›</Text>
      </Pressable>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Zamknij szukanie"
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <Text style={{ color: theme.muted, fontSize: 15 }}>Zamknij</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  count: { fontSize: 12, minWidth: 58, textAlign: 'right' },
  // The arrows contain only a glyph about 8 px wide, so the touch target here is made of
  // padding, not content. Padding instead of `hitSlop`, because the buttons sit 8 px apart:
  // an enlarged zone would overlap the neighbour, and „następne" would catch taps meant for
  // „poprzedniego". Nothing changes visually — they have neither a background nor a border —
  // and the text field is `flex: 1`, so it gives up those extra pixels on its own.
  step: { paddingHorizontal: 10, paddingVertical: 10 },
  // „Zamknij" is a word, so horizontally it already has its own space; it's only missing
  // height.
  close: { paddingHorizontal: 4, paddingVertical: 12 },
  pressed: { opacity: 0.65 },
});
