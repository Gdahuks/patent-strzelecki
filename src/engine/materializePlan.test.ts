import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { isNoop, planMaterialize, stampFor, versionOf } from './materializePlan';

const SLUGS = ['uobia', 'pzss'];
const FILES = ['uobia.html', 'pzss.html', 'wersja.txt', 'assets'];

function plan(stamp: string | null, version = 'v1', themeKey = 'dark:1', files = FILES) {
  return planMaterialize({ stamp, version, themeKey, files, slugs: SLUGS });
}

describe('stampFor and versionOf', () => {
  it('extracts the bundle version from a full stamp', () => {
    assert.equal(versionOf(stampFor('ded5467c7db1', 'dark:1.2')), 'ded5467c7db1');
  });

  it('handles a stamp with no appearance key', () => {
    assert.equal(versionOf('ded5467c7db1'), 'ded5467c7db1');
  });
});

describe('planMaterialize', () => {
  it('writes everything on an empty disk', () => {
    const result = plan(null, 'v1', 'dark:1', ['wersja.txt']);

    assert.equal(result.writeAssets, true);
    assert.equal(result.writeLessons, true);
  });

  it('does nothing on a matching stamp', () => {
    assert.equal(isNoop(plan(stampFor('v1', 'dark:1'))), true);
  });

  it('a theme change rewrites lessons, but NOT images', () => {
    // Images depend neither on the theme nor on the font scale. A shared stamp used to
    // force deleting and rewriting 1.7 MB of base64 on every tweak of font size.
    const result = plan(stampFor('v1', 'light:1'));

    assert.equal(result.writeLessons, true);
    assert.equal(result.writeAssets, false);
  });

  it("a font-scale change doesn't touch images either", () => {
    const result = plan(stampFor('v1', 'dark:1.2'));

    assert.equal(result.writeLessons, true);
    assert.equal(result.writeAssets, false);
  });

  it('a new bundle rewrites both', () => {
    const result = plan(stampFor('v0', 'dark:1'));

    assert.equal(result.writeLessons, true);
    assert.equal(result.writeAssets, true);
  });

  it('flags lessons no longer in the bundle', () => {
    // The write pass only iterates the bundle's own lessons, so a file left behind by a
    // lesson removed from the course never had anything touch it and stayed on disk
    // forever.
    const result = plan(stampFor('v0', 'dark:1'), 'v1', 'dark:1', [
      ...FILES,
      'lekcja-usunieta.html',
    ]);

    assert.deepEqual(result.stale, ['lekcja-usunieta.html']);
  });

  it("cleans up leftovers even when there's nothing else to do", () => {
    const result = plan(stampFor('v1', 'dark:1'), 'v1', 'dark:1', [...FILES, 'stara.html']);

    assert.equal(result.writeAssets, false);
    assert.equal(result.writeLessons, false);
    assert.deepEqual(result.stale, ['stara.html']);
    assert.equal(isNoop(result), false);
  });

  it('does not touch files outside the lessons', () => {
    const result = plan(null, 'v1', 'dark:1', [...FILES, 'assets', 'wersja.txt', 'cokolwiek.txt']);

    assert.deepEqual(result.stale, []);
  });
});
