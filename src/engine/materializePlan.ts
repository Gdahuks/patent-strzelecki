/**
 * The "what to rewrite to disk" rule for content materialization.
 *
 * Lives apart from `content/materialize.ts`, because that module imports
 * `expo-file-system` at the module level, which pulls in React Native's Flow syntax —
 * vitest can't parse that. This file is just arithmetic over names and stamps, with no
 * disk access, so it's testable. The dependency direction is the same as with
 * `readingProgress`: the disk-facing layer calls into the engine, never the other way
 * around.
 */

/**
 * The stamp saved next to the content: bundle version and appearance key, joined by a
 * colon.
 *
 * The appearance key can itself be composite ("dark:1.2"), so we always split on the
 * **first** colon — the bundle version is a hex hash and never contains one.
 */
export function stampFor(version: string, themeKey: string): string {
  return `${version}:${themeKey}`;
}

export function versionOf(stamp: string): string {
  const at = stamp.indexOf(':');
  return at < 0 ? stamp : stamp.slice(0, at);
}

export interface MaterializePlan {
  /** Images: delete the directory and write it fresh. */
  writeAssets: boolean;
  /** Lessons: rewrite all of them from scratch. */
  writeLessons: boolean;
  /** Lesson files to delete — left over from a bundle that still had them. */
  stale: string[];
}

export interface MaterializeInput {
  /** The stamp read from disk, or null when materialization hasn't happened yet. */
  stamp: string | null;
  version: string;
  themeKey: string;
  /** Names of the files sitting in the content directory. */
  files: readonly string[];
  /** Lesson slugs in the current bundle. */
  slugs: readonly string[];
}

export function planMaterialize(input: MaterializeInput): MaterializePlan {
  const wanted = stampFor(input.version, input.themeKey);
  const current = input.stamp;

  // Images depend neither on the theme nor on the font scale — only on the bundle. A
  // shared stamp used to force deleting and rewriting 1.7 MB of base64 on every tweak of
  // font size in settings, freezing the JS thread for the duration of the write.
  const writeAssets = current === null || versionOf(current) !== input.version;
  const writeLessons = current !== wanted;

  // A lesson removed from the course used to stay on disk forever: the write pass only
  // iterates the bundle's own lessons, so nothing ever looked at files no longer in the
  // bundle. We clean up every time, even when the stamp matches — otherwise a leftover
  // from an older bundle would never get a chance to disappear.
  const keep = new Set(input.slugs.map((slug) => `${slug}.html`));
  const stale = input.files.filter((name) => name.endsWith('.html') && !keep.has(name));

  return { writeAssets, writeLessons, stale };
}

/** Whether the plan has nothing to do — in that case, we leave the stamp alone. */
export function isNoop(plan: MaterializePlan): boolean {
  return !plan.writeAssets && !plan.writeLessons && plan.stale.length === 0;
}
