import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

/**
 * The image assets of the bundle, checked against the lessons that point at them.
 *
 * The bug this file exists for: `tabela_ograniczen2.jpg` held PNG bytes, because the course
 * serves it under that name and the scraper kept the name as it found it. Nothing anywhere
 * compared the bytes with the extension. Android showed the picture anyway — Chromium sniffs
 * images — while WebKit takes the type from the extension when the page is a `file://` one,
 * so on the iPhone the lesson had a broken-image icon in place of the table.
 *
 * That's the shape of a whole class of failures: a bundle that is perfectly consistent with
 * itself (the checksums matched all along) and still wrong. Hence checking the bytes, not
 * only the manifest.
 *
 * The test **skips itself** when there's no bundle: `assets/content/` sits outside this
 * repository, because it carries the course's content. A fresh clone has nothing to check
 * until it runs `make content`.
 */
const DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '../../assets/content');
const PRESENT = existsSync(join(DIRECTORY, 'content.json')) && existsSync(join(DIRECTORY, 'assets-base64.js'));

type Bundle = {
  lessons: { slug: string; html: string }[];
  assets: { path: string; sha256: string }[];
};

function bundle(): Bundle {
  return JSON.parse(readFileSync(join(DIRECTORY, 'content.json'), 'utf8')) as Bundle;
}

/** The images as the app writes them to disk on first launch — base64, keyed by file name. */
function payloads(): Record<string, string> {
  return createRequire(import.meta.url)(join(DIRECTORY, 'assets-base64.js')) as Record<string, string>;
}

/**
 * Every `assets/…` a lesson points at, as `{ lesson, reference }`.
 *
 * Both attributes count. Most images in this course are not shown inline at all: they hang
 * off a link that opens the picture full-screen, and two of them are wrapped in a link to
 * themselves. A rename that fixed only `src` would leave those links pointing at nothing.
 *
 * The match is anchored at the start of the attribute on purpose — the lessons also link to
 * `https://www.pzss.org.pl/assets/files/…`, which is a different site's directory that
 * happens to share a name.
 */
function references(): { lesson: string; reference: string }[] {
  const found: { lesson: string; reference: string }[] = [];

  for (const lesson of bundle().lessons) {
    for (const [, reference] of lesson.html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)) {
      found.push({ lesson: lesson.slug, reference });
    }
  }

  return found;
}

/** The magic bytes of the formats a browser gets from a file extension. */
const SIGNATURES: { extensions: string[]; matches: (bytes: Buffer) => boolean }[] = [
  { extensions: ['png'], matches: (b) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
  { extensions: ['jpg', 'jpeg'], matches: (b) => b.subarray(0, 3).toString('hex') === 'ffd8ff' },
  { extensions: ['gif'], matches: (b) => b.subarray(0, 6).toString('latin1').startsWith('GIF8') },
  {
    extensions: ['webp'],
    matches: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  { extensions: ['svg'], matches: (b) => /^\s*(<\?xml|<svg)/i.test(b.subarray(0, 200).toString('utf8')) },
];

function extensionOf(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase();
}

describe.skipIf(!PRESENT)('the real image bundle', () => {
  it('every image a lesson points at is on disk and in the base64 module', () => {
    const inModule = payloads();

    for (const { lesson, reference } of references()) {
      const name = reference.slice('assets/'.length);

      assert.ok(existsSync(join(DIRECTORY, reference)), `${lesson}: ${reference} is not in the bundle`);
      assert.ok(name in inModule, `${lesson}: ${reference} has no entry in assets-base64.js`);
    }
  });

  it('the bytes of every image match its extension', () => {
    // The check that was missing. An extension a decoder disagrees with is not a cosmetic
    // detail: on iOS it is the difference between a diagram and a broken-image icon.
    for (const { path } of bundle().assets) {
      const bytes = readFileSync(join(DIRECTORY, path));
      const extension = extensionOf(path);
      const signature = SIGNATURES.find((candidate) => candidate.extensions.includes(extension));

      assert.ok(signature, `${path}: extension no browser recognises as an image`);
      assert.ok(signature.matches(bytes), `${path}: the file is not a ${extension} — the bytes say otherwise`);
    }
  });

  it('the checksums cover both copies of every image', () => {
    // The file on disk and the base64 entry are two copies of the same picture written by
    // the scraper. They are unpacked from the module, so a divergence would only show up on
    // a device, after the first launch.
    const inModule = payloads();

    for (const { path, sha256 } of bundle().assets) {
      const name = path.slice('assets/'.length);
      const onDisk = createHash('sha256').update(readFileSync(join(DIRECTORY, path))).digest('hex');

      assert.equal(onDisk, sha256, `${path}: the file does not match the manifest`);
      assert.ok(name in inModule, `${path}: no entry in assets-base64.js`);
      assert.equal(
        createHash('sha256').update(Buffer.from(inModule[name], 'base64')).digest('hex'),
        sha256,
        `${path}: the base64 entry does not match the manifest`,
      );
    }
  });

  it('the manifest and the module carry the same images, and no others', () => {
    // The check has to be on the module, not on the directory: `writeAssets` unpacks the
    // images from `assets-base64.js`, so that module — not `assets/` on disk — is what ends
    // up inside the APK and on the device. A rename done by halves that corrected the file
    // and the manifest but left the old key in the module would ship the stale picture in
    // every release, which is the very thing this test exists to catch.
    //
    // Both directions matter: a key with no manifest entry is the orphan, an entry with no
    // key is an image the app cannot unpack.
    const inModule = Object.keys(payloads()).sort();
    const inManifest = bundle()
      .assets.map(({ path }) => path.slice('assets/'.length))
      .sort();

    assert.deepEqual(inModule, inManifest);
  });

  it('no image is carried that nothing points at', () => {
    // An orphan is the trace of a rename done by halves: the picture under the new name is
    // shown, the one under the old name travels along in every release forever.
    const pointedAt = new Set(references().map(({ reference }) => reference.slice('assets/'.length)));

    for (const { path } of bundle().assets) {
      const name = path.slice('assets/'.length);
      assert.ok(pointedAt.has(name), `${path}: in the bundle, no lesson points at it`);
    }
  });
});
