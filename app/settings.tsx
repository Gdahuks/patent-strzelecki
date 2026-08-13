import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useCallback } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useBottomInset } from '../src/components/safeArea';
import { Card, Muted } from '../src/components/ui';
import { openInAppBrowser } from '../src/content/openSource';
import { content } from '../src/content/store';
import { clearAllAttempts, resetAllProgress } from '../src/db/database';
import { resetAllReading } from '../src/db/reading';
import { levelsLabel } from '../src/db/settings';
import { formatDay } from '../src/engine/dates';
import { LEVEL_CHOICES } from '../src/engine/leitner';
import { plural } from '../src/engine/plural';
import { REPORT_ADDRESS, reportMailto, versionLine } from '../src/engine/report';
import { useSettings } from '../src/settings/SettingsContext';
import { useTheme } from '../src/theme';

/**
 * The course authors' fundraiser. A constant, since it's not part of the content — the
 * bundle knows nothing about it.
 */
const DONATION_ADDRESS = 'https://braterstwo.eu/1procent';

/**
 * The course address to display: without the scheme and the trailing slash, since
 * „https://…/" inside a sentence reads like a pasted link rather than a service name. The
 * link itself points at the full address from the bundle, so a change on the scraper's side
 * flows through here on its own.
 */
const COURSE_NAME = content.source.replace(/^https?:\/\//, '').replace(/\/$/, '');

/**
 * The release info assembled from whatever `app.config.js` wrote at build time.
 *
 * Outside a git repository, `commit` is empty and the line shortens itself accordingly —
 * see `versionLine`. The date arrives as ISO, so the screen formats it; a pure function
 * assembling text has nothing to derive it from.
 */
function release() {
  const extra = Constants.expoConfig?.extra ?? {};
  const commit = typeof extra.commit === 'string' ? extra.commit : null;
  const commitDate = typeof extra.commitDate === 'string' ? extra.commitDate : null;

  return {
    version: Constants.expoConfig?.version ?? '—',
    build: String(
      Platform.OS === 'ios'
        ? Constants.expoConfig?.ios?.buildNumber ?? '—'
        : Constants.expoConfig?.android?.versionCode ?? '—',
    ),
    commit,
    day: commitDate ? formatDay(commitDate) : null,
    bundle: content.version,
    system: `${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Platform.Version}`,
  };
}

/**
 * An entry that opens something outside the Settings screen.
 *
 * Accent colour instead of a button, since this is an informational section — and the
 * "coloured text is tappable" pattern is already carried by the screen's progress-reset
 * entries. `hitSlop` only extends vertically and stays within half the gap to its neighbour,
 * following the app-wide rule.
 */
function Link({
  label,
  hint,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Text style={[styles.linkLabel, { color: theme.accent }]}>{label}</Text>
      {hint ? <Text style={[styles.linkHint, { color: theme.muted }]}>{hint}</Text> : null}
    </Pressable>
  );
}

/** Build configuration doesn't change over the app's lifetime — assembled once. */
const RELEASE = release();
const RELEASE_LINE = versionLine(RELEASE);

export default function SettingsScreen() {
  const theme = useTheme();
  const paddingBottom = useBottomInset(32);
  const { levels, setLevels } = useSettings();

  /**
   * Mail goes through `Linking`, because `mailto:` isn't an address the in-app browser knows
   * how to open — the one place where departing from `openInAppBrowser` is justified. A phone
   * with no mail client configured declines the request, so the address lands on the
   * clipboard instead: otherwise the tap would do nothing at all and look broken.
   */
  const report = useCallback(() => {
    Linking.openURL(reportMailto(RELEASE)).catch(() => {
      void Clipboard.setStringAsync(REPORT_ADDRESS).then(() => {
        Alert.alert('Brak aplikacji pocztowej', `Adres skopiowany do schowka:\n${REPORT_ADDRESS}`);
      });
    });
  }, []);

  /**
   * Show a confirmation only where the system doesn't show its own.
   *
   * Android since 13 (API 33) shows its own clipboard preview with the copied content after
   * copying, so our message was a second confirmation of the exact same thing — and a worse
   * one, since it had no content and required tapping "OK". On iOS and older Android nothing
   * appears at all, and a tap with no reaction whatsoever looks broken.
   */
  const copyRelease = useCallback(() => {
    void Clipboard.setStringAsync(`${RELEASE_LINE}\nPaczka treści ${content.version}`).then(() => {
      const systemConfirms = Platform.OS === 'android' && Number(Platform.Version) >= 33;
      if (!systemConfirms) Alert.alert('Skopiowane');
    });
  }, []);

  /**
   * The button label is a parameter, because not every entry resets progress: under the
   * question „Wyczyścić historię egzaminów?" the button read „Wyzeruj" (reset), i.e. the
   * button named a different action than the question above it. For the same reason the
   * confirmation is now just „Gotowe" (done) — one sentence covering all four entries would
   * have to lie about at least one of them.
   */
  const confirm = useCallback(
    (title: string, message: string, label: string, action: () => Promise<void>) => {
      Alert.alert(title, `${message}\n\nTej operacji nie da się cofnąć.`, [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: label,
          style: 'destructive',
          onPress: () => {
            void action().then(() => Alert.alert('Gotowe'));
          },
        },
      ]);
    },
    [],
  );

  return (
    <ScrollView contentContainerStyle={[styles.body, { paddingBottom }]}>
      <Card>
        <Text style={[styles.label, { color: theme.text }]}>
          Ile poprawnych odpowiedzi to „opanowane”
        </Text>
        <Muted>
          Pomyłka zawsze cofa pytanie na sam dół, niezależnie od wybranej wartości.
          Zmiana działa od razu; postęp powyżej nowego szczytu zostaje do niego przycięty.
        </Muted>

        <View style={styles.options}>
          {LEVEL_CHOICES.map((choice) => {
            const active = choice === levels;
            return (
              <Pressable
                key={choice}
                onPress={() => setLevels(choice)}
                accessibilityRole="radio"
                // The caption has a line break in the middle („2 poprawne\npod rząd"), which
                // a screen reader reads as a pause mid-sentence — the label replaces it with
                // a space.
                accessibilityLabel={levelsLabel(choice).replace('\n', ' ')}
                accessibilityState={{ checked: active, selected: active }}
                style={({ pressed }) => [
                  styles.option,
                  styles.levelOption,
                  {
                    backgroundColor: active ? theme.accent : theme.bg,
                    borderColor: active ? theme.accent : theme.border,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={{
                    color: active ? theme.onFill : theme.text,
                    fontSize: 13,
                    fontWeight: active ? '700' : '500',
                    textAlign: 'center',
                    lineHeight: 17,
                  }}
                >
                  {levelsLabel(choice)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card>
        <Text style={[styles.label, { color: theme.text }]}>Motyw</Text>
        <Muted>
          Aplikacja idzie za ustawieniem systemowym — teraz {theme.dark ? 'ciemny' : 'jasny'}.
          Zmienisz go w ustawieniach systemu.
        </Muted>
      </Card>

      <Card>
        <Text style={[styles.label, { color: theme.text }]}>Wyzerowanie postępu</Text>
        <Muted>
          Treść kursu zostaje — kasowany jest tylko Twój postęp. Każda pozycja działa
          osobno, więc możesz zacząć od nowa tylko z tym, co faktycznie chcesz powtórzyć.
        </Muted>

        <Pressable
          onPress={() =>
            confirm(
              'Wyzerować postęp ćwiczeń?',
              `${content.questions.length} ${plural(
                content.questions.length,
                'pytanie',
                'pytania',
                'pytań',
              )} ${plural(content.questions.length, 'wróci', 'wrócą', 'wróci')} do stanu nieprzerobionych.`,
              'Wyzeruj',
              resetAllProgress,
            )
          }
          accessibilityRole="button"
          style={({ pressed }) => [styles.danger, pressed && styles.pressed]}
        >
          <Text style={[styles.dangerLabel, { color: theme.bad }]}>Postęp ćwiczeń</Text>
        </Pressable>

        <Pressable
          onPress={() =>
            confirm(
              'Wyzerować postęp czytania?',
              'Wszystkie lekcje wrócą do stanu nieprzeczytanych, razem z zapamiętanym miejscem czytania.',
              'Wyzeruj',
              resetAllReading,
            )
          }
          accessibilityRole="button"
          style={({ pressed }) => [styles.danger, pressed && styles.pressed]}
        >
          <Text style={[styles.dangerLabel, { color: theme.bad }]}>Postęp czytania lekcji</Text>
        </Pressable>

        <Pressable
          onPress={() =>
            confirm(
              'Wyczyścić historię egzaminów?',
              'Znikną wszystkie zapisane podejścia.',
              'Wyczyść',
              clearAllAttempts,
            )
          }
          accessibilityRole="button"
          style={({ pressed }) => [styles.danger, pressed && styles.pressed]}
        >
          <Text style={[styles.dangerLabel, { color: theme.bad }]}>Historia egzaminów</Text>
        </Pressable>

        <Pressable
          onPress={() =>
            confirm(
              'Zacząć naukę od zera?',
              'Znikną postęp ćwiczeń, postęp czytania lekcji i cała historia egzaminów.',
              'Zacznij od zera',
              async () => {
                await resetAllProgress();
                await resetAllReading();
                await clearAllAttempts();
              },
            )
          }
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.dangerStrong,
            { borderColor: theme.bad },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.dangerLabel, { color: theme.bad }]}>Wszystko naraz</Text>
        </Pressable>
      </Card>

      <Card>
        <Text style={[styles.label, { color: theme.text }]}>Treść</Text>
        <Muted>
          {content.lessons.length} lekcji, {content.questions.length} pytań, {content.sets.length}{' '}
          zestawów ćwiczeń.
        </Muted>
        <Muted>
          Materiały pochodzą z bezpłatnego kursu {COURSE_NAME}, prowadzonego przez Braterstwo
          (Stowarzyszenie KS Amator). Paczka {content.version}, treść pobrana{' '}
          {new Date(content.scrapedAt).toLocaleDateString('pl-PL')}.
        </Muted>

        <Link
          label={`${COURSE_NAME} ↗`}
          accessibilityLabel={`${COURSE_NAME}. Otwiera stronę kursu w przeglądarce`}
          onPress={() => openInAppBrowser(content.source, theme)}
        />

        {/* The sentence comes before the link, not after: a bare fundraiser button, inside
            an app the course authors don't run, is ambiguous — it's not clear whose account
            it points to. */}
        <Muted>
          Kurs jest bezpłatny — autorom można odwdzięczyć się, przekazując im 1,5% podatku.
        </Muted>
        <Link
          label="Przekaż 1,5% podatku ↗"
          accessibilityLabel="Przekaż 1,5% podatku. Otwiera stronę zbiórki autorów kursu"
          onPress={() => openInAppBrowser(DONATION_ADDRESS, theme)}
        />

        {/* Without this sentence, the attribution read like a caption for the app's entire
            content, but the five legal acts and the ISSF documents aren't course content. */}
        <Muted>
          Teksty ustaw pochodzą z rejestru Kancelarii Sejmu, a przepisy ISSF ze strony PZSS —
          nie są częścią kursu.
        </Muted>
      </Card>

      <Card>
        <Text style={[styles.label, { color: theme.text }]}>Aplikacja</Text>
        <Muted>
          Napisana przez Huberta Książka. Nieoficjalna — Braterstwo jej nie prowadzi i nie
          odpowiada za jej działanie.
        </Muted>

        <Link
          label="✉ Zgłoś błąd lub uwagę"
          hint={REPORT_ADDRESS}
          accessibilityLabel={`Zgłoś błąd lub uwagę. Otwiera pocztę na adres ${REPORT_ADDRESS}`}
          onPress={report}
        />

        {/* Tapping copies, because this line gets pasted into a report sent by some other
            route than the button above — that one writes it into the mail body on its own. */}
        <Pressable
          onPress={copyRelease}
          accessibilityRole="button"
          accessibilityLabel={`${RELEASE_LINE}. Dotknij, żeby skopiować`}
          hitSlop={{ top: 6, bottom: 6 }}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <Text style={[styles.linkHint, { color: theme.muted }]}>{RELEASE_LINE}</Text>
        </Pressable>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  label: { fontSize: 16, fontWeight: '600' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  option: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minWidth: 78,
    alignItems: 'center',
    justifyContent: 'center',
  },
  danger: { paddingVertical: 12, marginTop: 2 },
  dangerStrong: {
    paddingVertical: 13,
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
  },
  dangerLabel: { fontSize: 15, fontWeight: '600' },
  levelOption: { minWidth: 104 },
  pressed: { opacity: 0.7 },
  link: { paddingVertical: 8, gap: 2 },
  linkLabel: { fontSize: 15, fontWeight: '600' },
  linkHint: { fontSize: 13, lineHeight: 18 },
});
