/**
 * Unpacking the content bundle onto the device's disk.
 *
 * A WebView can show HTML handed to it directly as a string, but then relative image paths
 * ("assets/schemat.jpg") have nothing to resolve against. That's why, on first launch, we
 * write each lesson out as a file next to a directory of images and load it through
 * `file://`. The same mechanism will also handle later bundle updates pulled from the
 * network.
 */

import { Directory, File, Paths } from 'expo-file-system';

import { previewSource } from '../engine/assetPreview';
import { isNoop, planMaterialize, stampFor } from '../engine/materializePlan';
import { withDefinitions } from './glossaryScript';
import { content } from './store';

/**
 * Images as base64, loaded **lazily**.
 *
 * It's 2.3 MB of strings, and it's only needed on first launch and after a bundle update —
 * requiring it at module scope would load it on every single start.
 */
function assetPayloads(): Record<string, string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../assets/content/assets-base64.js') as Record<string, string>;
}

const ROOT = 'tresc';
const VERSION_FILE = 'wersja.txt';

function root(): Directory {
  return new Directory(Paths.document, ROOT);
}

export function lessonFileUri(slug: string): string {
  return new File(root(), `${slug}.html`).uri;
}

/** The directory holding materialized content — the reference point for links in the WebView. */
export function contentDirUri(): string {
  return root().uri;
}

function page(title: string, css: string, body: string): string {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<style>${css}</style>
</head>
<body>${body}</body>
</html>`;
}

/**
 * Writes the images to the content directory.
 *
 * The previous version pulled them through `expo-asset` via `require`. That worked on iOS,
 * not on Android: the bundler compiles images into app resources, and `localUri` then hands
 * back the bare drawable resource name instead of a file path — `File.copy` rejected that as
 * "URI is not absolute". Base64 from the content bundle behaves identically on both systems.
 *
 * Any failure here is an error, not something to skip past: the version marker would still
 * get written, so a skipped image would stay broken permanently, with no retry.
 */
function writeAssets(target: Directory): void {
  // The directory is deleted beforehand whenever the version changes, so everything is
  // written fresh here.
  if (!target.exists) target.create({ intermediates: true });

  const failures: string[] = [];

  for (const [name, payload] of Object.entries(assetPayloads())) {
    const destination = new File(target, name);

    try {
      destination.write(payload, { encoding: 'base64' });

      if (!destination.exists) {
        failures.push(`${name}: write did not create the file`);
      }
    } catch (cause) {
      failures.push(`${name}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Nie udało się przygotować ${failures.length} obrazków:\n${failures.join('\n')}`);
  }
}

/**
 * Writes lessons and images to disk, if the current version isn't already there.
 *
 * What to rewrite and when is decided by `planMaterialize` — the rule lives in the engine so
 * it can be tested without touching disk. What's left here is just carrying out the plan.
 *
 * @param css the stylesheet injected into every lesson — it depends on the theme and font
 *   scale, so lessons get rewritten whenever either of those changes
 * @param themeKey the appearance identifier, the second part of the version marker
 */
export async function materializeContent(css: string, themeKey: string): Promise<void> {
  const directory = root();
  if (!directory.exists) directory.create({ intermediates: true });

  const versionFile = new File(directory, VERSION_FILE);
  const plan = planMaterialize({
    stamp: versionFile.exists ? versionFile.textSync() : null,
    version: content.version,
    themeKey,
    files: directory.list().map((entry) => entry.name),
    slugs: content.lessons.map((lesson) => lesson.slug),
  });

  if (isNoop(plan)) return;

  // The marker disappears for the duration of the write: if an error or the app being
  // killed interrupts it, the next start begins fresh instead of treating incomplete
  // content as ready.
  if (versionFile.exists) versionFile.delete();

  if (plan.writeAssets) {
    // The whole image directory goes: filenames carry no checksum, so without clearing it
    // a corrected diagram with an unchanged name would keep the old version around.
    const assets = new Directory(directory, 'assets');
    if (assets.exists) assets.delete();

    writeAssets(assets);
  }

  if (plan.writeLessons) {
    for (const lesson of content.lessons) {
      const body = withDefinitions(lesson.html, content.glossary);
      new File(directory, `${lesson.slug}.html`).write(page(lesson.title, css, body));
    }
  }

  for (const name of plan.stale) new File(directory, name).delete();

  versionFile.write(stampFor(content.version, themeKey));
}

/**
 * The image ready to be shown by the preview screen, or null when there's nothing to show.
 *
 * The bytes travel inside the address instead of being fetched as a second resource. The
 * preview page is an HTML string with no base address, so for WebKit a `file://` picture in
 * it comes from a foreign origin and the origin policy drops it — on iOS the screen showed
 * the description and an empty page. This way the WebView needs no file access at all, and
 * the screen stopped asking for any.
 *
 * Null covers both "no such file" and "a name that promises no image type"; the screen says
 * the same thing about each, because the bundle cannot hold the second kind — the scraper
 * refuses to build one, and `assets.package.test.ts` guards the built bundle.
 */
export function assetPreview(name: string): string | null {
  if (!assetExists(name)) return null;

  return previewSource(name, new File(new Directory(root(), 'assets'), name).base64Sync());
}

/**
 * Whether an image with this name sits in the content directory.
 *
 * The name comes from a route parameter, and the route is also reachable through a deep
 * link — a slash in the name would lead outside the content directory, so we reject one
 * without even checking the disk.
 */
export function assetExists(name: string): boolean {
  if (!name || name.includes('/') || name.includes('\\')) return false;
  return new File(new Directory(root(), 'assets'), name).exists;
}
