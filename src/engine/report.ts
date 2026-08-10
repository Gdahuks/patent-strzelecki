/**
 * Bug report: the address, the version line, and a ready-made `mailto:` link.
 *
 * Split out of the settings screen, because assembling the text is pure — it's tested with
 * plain vitest, no React Native. The screen only adds what the pure function doesn't have:
 * a formatted date and the platform name.
 */

/**
 * An Apple alias, not the main address. It can be switched off with one tap once it starts
 * collecting spam — something the main address can't do. When the alias is replaced it has
 * to change **together** with the store listing, so the contact address in both places
 * points at the same mailbox.
 *
 * Assembled from parts rather than written out, because the repository is public and
 * address-harvesting bots crawl code for a `something@something.something` pattern. This
 * isn't protection against a human — the address is spelled out plainly on the store
 * listing and in the settings screen, and `docs/polityka-prywatnosci.md` states it in the
 * open too, because a privacy policy only does its job if it's readable there — just a bar
 * that a naive regex doesn't clear. That's also why there's no literal address in the tests.
 */
const MAILBOX = ['cordon42', 'wheaten'].join('_');
const DOMAIN = ['icloud', 'com'].join('.');

export const REPORT_ADDRESS = `${MAILBOX}@${DOMAIN}`;

/**
 * A fixed subject line, so it can be filtered on a rule at the recipient's end. That's real
 * spam protection — hiding the address isn't, since the store listing shows the contact
 * plainly anyway.
 */
export const REPORT_SUBJECT = 'Patent Strzelecki — zgłoszenie';

export interface Release {
  /** The version number from the store, e.g. `1.0.0`. */
  version: string;
  /** The build number, i.e. the commit count. */
  build: string;
  /** The commit hash; a trailing `+` means a build with uncommitted changes. */
  commit: string | null;
  /** The commit date, already formatted by the screen — nothing left here to inflect. */
  day: string | null;
  /** The content bundle version. */
  bundle: string;
  /** The phone's platform, e.g. `Android 36`. Only goes into the email. */
  system?: string;
}

/**
 * The version line shown in Settings and copied on tap.
 *
 * The commit and date are appended only when present: a build made outside the repository
 * (unpacked source) has nothing to report there, and "built from null" would read like an
 * app bug.
 */
export function versionLine(release: Release): string {
  const { version, build, commit, day } = release;
  const head = `Wersja ${version} (${build})`;
  if (!commit) return head;
  return day ? `${head}, zbudowana ${day} z ${commit}` : `${head}, zbudowana z ${commit}`;
}

/**
 * A `mailto:` address carrying the subject and a technical footer.
 *
 * The footer sits in the body, not the subject, because it's data meant to be read after
 * opening the message, not scanned on a list. The blank lines at the start place the cursor
 * above the footer — otherwise the person writing would have to scroll past the pre-filled
 * text first.
 *
 * Encoding goes through `encodeURIComponent`, including for the subject: an em dash and
 * Polish diacritics in an unencoded parameter can cut the subject off partway through.
 */
export function reportMailto(release: Release): string {
  const footer = [
    versionLine(release),
    `Paczka treści ${release.bundle}`,
    release.system ? `System ${release.system}` : null,
  ].filter(Boolean);

  const body = `\n\n---\n${footer.join('\n')}`;

  return (
    `mailto:${REPORT_ADDRESS}`
    + `?subject=${encodeURIComponent(REPORT_SUBJECT)}`
    + `&body=${encodeURIComponent(body)}`
  );
}
