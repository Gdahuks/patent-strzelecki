import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  architecturesOf,
  evaluate,
  parseManifestDump,
  render,
  type Expected,
  type Facts,
} from './checks.ts';

// Trimmed from `bundletool dump manifest` on the 0.4.0 package.
const MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" android:compileSdkVersion="36" android:versionCode="56" android:versionName="0.4.0" package="io.github.gdahuks.patentstrzelecki" platformBuildVersionCode="36">
  <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/>
  <uses-permission android:name="io.github.gdahuks.patentstrzelecki.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"/>
  <application android:allowBackup="true" android:name="io.github.gdahuks.patentstrzelecki.MainApplication">
    <meta-data android:name="expo.modules.updates.ENABLED" android:value="false"/>
  </application>
</manifest>`;

const PKG = 'io.github.gdahuks.patentstrzelecki';
const ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'];

function entries(): string[] {
  return [
    ...ABIS.map((abi) => `base/lib/${abi}/libreactnative.so`),
    ...ABIS.map((abi) => `BUNDLE-METADATA/com.android.tools.build.debugsymbols/${abi}/libreactnative.so.sym`),
    'BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map',
    'base/assets/index.android.bundle',
  ];
}

function facts(overrides: Partial<Facts> = {}): Facts {
  return {
    manifest: parseManifestDump(MANIFEST),
    entries: entries(),
    sizeBytes: 50_000_000,
    bundleHeadHex: 'c61fbc03',
    bundleHasVersion: true,
    bundleHasScrapedAt: true,
    bundleSha256: 'abc',
    jarVerified: true,
    signerFingerprint: 'AA:BB',
    unzipTestOk: true,
    previous: null,
    sourceChangedSincePrevious: null,
    ...overrides,
  };
}

function expected(overrides: Partial<Expected> = {}): Expected {
  return {
    package: PKG,
    versionName: '0.4.0',
    versionCode: 56,
    minSdk: 24,
    targetSdk: 36,
    contentVersion: '25af2dc2987e',
    contentScrapedAt: '2026-08-13T12:44:04+00:00',
    uploadKeyFingerprint: 'aa:bb',
    ...overrides,
  };
}

const failures = (checks: ReturnType<typeof evaluate>) => checks.filter((c) => c.level === 'fail').map((c) => c.name);
const asks = (checks: ReturnType<typeof evaluate>) => checks.filter((c) => c.level === 'ask').map((c) => c.name);

describe('parseManifestDump', () => {
  it('reads the root attributes, the sdk levels and the permissions', () => {
    const m = parseManifestDump(MANIFEST);
    assert.equal(m.package, PKG);
    assert.equal(m.versionCode, 56);
    assert.equal(m.versionName, '0.4.0');
    assert.equal(m.minSdk, 24);
    assert.equal(m.targetSdk, 36);
    assert.deepEqual(m.usesPermissions, [`${PKG}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`]);
    assert.equal(m.debuggable, false);
  });

  it('sees android:debuggable="true"', () => {
    const xml = MANIFEST.replace('<application ', '<application android:debuggable="true" ');
    assert.equal(parseManifestDump(xml).debuggable, true);
  });

  it('throws on output that is not a manifest (e.g. a bundletool error)', () => {
    assert.throws(() => parseManifestDump('Error: File not found'), /not a manifest/);
  });
});

describe('architecturesOf', () => {
  it('lists the ABIs under base/lib, sorted', () => {
    assert.deepEqual(architecturesOf(entries()), ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']);
  });
});

describe('evaluate', () => {
  it('passes a package that matches everything (previous release absent → one skip line)', () => {
    const checks = evaluate(facts(), expected());
    assert.deepEqual(failures(checks), []);
    assert.deepEqual(asks(checks), []);
    const skipped = checks.filter((c) => c.level === 'skip');
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].detail, /brak poprzednika/);
  });

  it('refuses expected values that are empty — a comparison against nothing cannot fail', () => {
    assert.throws(() => evaluate(facts(), expected({ contentVersion: '' })), /expected contentVersion is empty/);
    assert.throws(() => evaluate(facts(), expected({ versionCode: 0 })), /expected versionCode/);
  });

  it('fails on a wrong versionName (a typo in the tag falls back to app.json)', () => {
    assert.deepEqual(failures(evaluate(facts(), expected({ versionName: '0.5.0' }))), ['versionName']);
  });

  it('fails on a wrong versionCode', () => {
    assert.deepEqual(failures(evaluate(facts(), expected({ versionCode: 57 }))), ['versionCode']);
  });

  it('fails on any android.permission.* and on AD_ID', () => {
    const withInternet = parseManifestDump(
      MANIFEST.replace('</manifest>', '<uses-permission android:name="android.permission.INTERNET"/></manifest>'),
    );
    assert.deepEqual(failures(evaluate(facts({ manifest: withInternet }), expected())), ['uprawnienia']);
    const withAdId = parseManifestDump(
      MANIFEST.replace('</manifest>', '<uses-permission android:name="com.google.android.gms.permission.AD_ID"/></manifest>'),
    );
    assert.deepEqual(failures(evaluate(facts({ manifest: withAdId }), expected())), ['uprawnienia', 'AD_ID']);
  });

  it('fails on debuggable', () => {
    const m = parseManifestDump(MANIFEST.replace('<application ', '<application android:debuggable="true" '));
    assert.deepEqual(failures(evaluate(facts({ manifest: m }), expected())), ['debuggable']);
  });

  it('fails when an ABI is missing', () => {
    const e = entries().filter((name) => !name.includes('/x86/'));
    assert.deepEqual(failures(evaluate(facts({ entries: e }), expected())), ['architektury', 'symbole natywne']);
  });

  it('fails when the JS bundle is not Hermes bytecode', () => {
    assert.deepEqual(failures(evaluate(facts({ bundleHeadHex: '5f5f6421' }), expected())), ['bajtkod Hermesa']);
  });

  it('fails when the content version or date is not in the bundle', () => {
    assert.deepEqual(failures(evaluate(facts({ bundleHasScrapedAt: false }), expected())), ['treść w bundlu']);
  });

  it('fails on a bad signature or a different signer (case and colons ignored in fingerprints)', () => {
    assert.deepEqual(failures(evaluate(facts({ jarVerified: false }), expected())), ['podpis']);
    assert.deepEqual(failures(evaluate(facts({ signerFingerprint: 'AA:CC' }), expected())), ['podpis']);
    assert.deepEqual(failures(evaluate(facts({ signerFingerprint: 'aabb' }), expected())), []);
  });

  it('fails on a corrupt archive or a missing R8 map', () => {
    assert.deepEqual(failures(evaluate(facts({ unzipTestOk: false }), expected())), ['integralność']);
    const e = entries().filter((name) => !name.endsWith('proguard.map'));
    assert.deepEqual(failures(evaluate(facts({ entries: e }), expected())), ['mapa R8']);
  });

  describe('against the previous release', () => {
    const previous = { tag: 'v0.3.0', versionCode: 36, sizeBytes: 48_000_000, bundleSha256: 'old' };

    it('passes when versionCode grew, size is close and the bundle changed with the source', () => {
      const checks = evaluate(facts({ previous, sourceChangedSincePrevious: true }), expected());
      assert.deepEqual(failures(checks), []);
      assert.deepEqual(asks(checks), []);
      assert.equal(checks.filter((c) => c.level === 'skip').length, 0);
    });

    it('fails when versionCode did not grow', () => {
      const checks = evaluate(
        facts({ previous: { ...previous, versionCode: 56 }, sourceChangedSincePrevious: true }),
        expected(),
      );
      assert.deepEqual(failures(checks), ['monotoniczność versionCode']);
    });

    it('asks (does not fail) when the size moved by more than 20 %', () => {
      const checks = evaluate(
        facts({
          previous: { ...previous, sizeBytes: 30_000_000 },
          sourceChangedSincePrevious: true,
        }),
        expected(),
      );
      assert.deepEqual(failures(checks), []);
      assert.deepEqual(asks(checks), ['rozmiar']);
    });

    it('asks when the source changed but the JS bundle is byte-identical (comments, types, tests)', () => {
      const checks = evaluate(facts({ previous: { ...previous, bundleSha256: 'abc' }, sourceChangedSincePrevious: true }), expected());
      assert.deepEqual(failures(checks), []);
      assert.deepEqual(asks(checks), ['nowy kod w bundlu']);
    });

    it('fails when the source did not change but the JS bundle differs', () => {
      const checks = evaluate(facts({ previous, sourceChangedSincePrevious: false }), expected());
      assert.deepEqual(failures(checks), ['nowy kod w bundlu']);
    });
  });
});

describe('render', () => {
  it('marks pass, fail, ask and skip distinctly, skip in bold', () => {
    const out = render([
      { name: 'a', level: 'pass', detail: 'x' },
      { name: 'b', level: 'fail', detail: 'y' },
      { name: 'c', level: 'ask', detail: 'z' },
      { name: 'd', level: 'skip', detail: 'w' },
    ]);
    assert.equal(out, '✓ a: x\n✗ b: y\n? c: z\n**– d: w (pominięte)**\n');
  });
});
