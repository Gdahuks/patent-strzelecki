/**
 * The rules that decide whether a built AAB is the package we meant to build.
 *
 * Pure functions, no I/O: `verify.ts` gathers the facts with bundletool, unzip, jarsigner and
 * keytool, and this module judges them. Keeping the judgement here — with tests — is how the
 * rule "a check that can only pass is a design error" gets enforced: every expected value is
 * asserted non-empty before a comparison uses it.
 *
 * Check names and details are in Polish: they end up verbatim in checks.md, the document the
 * repository owner pastes into the store release notes.
 */

export interface ManifestFacts {
  package: string;
  versionCode: number;
  versionName: string;
  minSdk: number;
  targetSdk: number;
  usesPermissions: string[];
  debuggable: boolean;
}

export interface PreviousRelease {
  tag: string;
  versionCode: number;
  sizeBytes: number;
  bundleSha256: string;
}

export interface Facts {
  manifest: ManifestFacts;
  /** Every entry name in the archive (`unzip -Z1`). */
  entries: string[];
  sizeBytes: number;
  /** First four bytes of base/assets/index.android.bundle, lowercase hex. */
  bundleHeadHex: string;
  bundleHasVersion: boolean;
  bundleHasScrapedAt: boolean;
  bundleSha256: string;
  /** `jarsigner -verify` printed "jar verified." */
  jarVerified: boolean;
  /** SHA-256 of the signing certificate as printed by `keytool -printcert -jarfile`. */
  signerFingerprint: string | null;
  unzipTestOk: boolean;
  previous: PreviousRelease | null;
  /**
   * The inputs of the JS bundle changed since the previous release: `git diff --quiet
   * <prev>..<tag> -- src app assets …` OR a different content bundle version (the content ships
   * inside the bundle but lives outside git). null = could not tell.
   */
  sourceChangedSincePrevious: boolean | null;
}

export interface Expected {
  package: string;
  versionName: string;
  versionCode: number;
  minSdk: number;
  targetSdk: number;
  contentVersion: string;
  contentScrapedAt: string;
  uploadKeyFingerprint: string;
}

export type Level = 'pass' | 'fail' | 'ask' | 'skip';

export interface Check {
  name: string;
  level: Level;
  detail: string;
}

export const HERMES_MAGIC_HEX = 'c61fbc03';
export const REQUIRED_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'];
export const R8_MAP = 'BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map';
export const DEBUG_SYMBOLS_DIR = 'BUNDLE-METADATA/com.android.tools.build.debugsymbols/';
export const AD_ID = 'com.google.android.gms.permission.AD_ID';
/** Above this relative change in package size the pipeline asks instead of assuming. */
export const SIZE_DEVIATION_ASK = 0.2;

function attribute(xml: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
  return match ? match[1] : null;
}

/** Parses the XML `bundletool dump manifest` prints. Throws when the text is not a manifest. */
export function parseManifestDump(xml: string): ManifestFacts {
  const root = /<manifest\b[^>]*>/.exec(xml);
  if (!root) throw new Error('not a manifest: bundletool printed something else');
  const pkg = attribute(root[0], 'package');
  const versionCode = attribute(root[0], 'android:versionCode');
  const versionName = attribute(root[0], 'android:versionName');
  if (!pkg || !versionCode || !versionName) throw new Error('not a manifest: root attributes missing');

  const usesSdk = /<uses-sdk\b[^>]*>/.exec(xml)?.[0] ?? '';
  const application = /<application\b[^>]*>/.exec(xml)?.[0] ?? '';
  const usesPermissions = [...xml.matchAll(/<uses-permission\b[^>]*>/g)]
    .map((m) => attribute(m[0], 'android:name'))
    .filter((name): name is string => name !== null);

  return {
    package: pkg,
    versionCode: Number(versionCode),
    versionName,
    minSdk: Number(attribute(usesSdk, 'android:minSdkVersion')),
    targetSdk: Number(attribute(usesSdk, 'android:targetSdkVersion')),
    usesPermissions,
    debuggable: attribute(application, 'android:debuggable') === 'true',
  };
}

export function architecturesOf(entries: string[]): string[] {
  const abis = new Set<string>();
  for (const entry of entries) {
    const match = /^base\/lib\/([^/]+)\//.exec(entry);
    if (match) abis.add(match[1]);
  }
  return [...abis].sort();
}

function requireExpected(expected: Expected): void {
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'string' && value.trim() === '') throw new Error(`expected ${key} is empty`);
    if (typeof value === 'number' && !(Number.isInteger(value) && value > 0)) {
      throw new Error(`expected ${key} is not a positive integer: ${value}`);
    }
  }
}

const normalizeFingerprint = (value: string) => value.replaceAll(':', '').toLowerCase();

function check(name: string, ok: boolean, detail: string): Check {
  return { name, level: ok ? 'pass' : 'fail', detail };
}

export function evaluate(facts: Facts, expected: Expected): Check[] {
  requireExpected(expected);
  const m = facts.manifest;
  const checks: Check[] = [];

  checks.push(check('pakiet', m.package === expected.package, `${m.package} (oczekiwano ${expected.package})`));
  checks.push(check('versionName', m.versionName === expected.versionName, `${m.versionName} (oczekiwano ${expected.versionName})`));
  checks.push(check('versionCode', m.versionCode === expected.versionCode, `${m.versionCode} (oczekiwano ${expected.versionCode})`));
  checks.push(check('minSdk / targetSdk', m.minSdk === expected.minSdk && m.targetSdk === expected.targetSdk,
    `${m.minSdk} / ${m.targetSdk} (oczekiwano ${expected.minSdk} / ${expected.targetSdk})`));

  const allowed = [`${expected.package}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`];
  const unexpected = m.usesPermissions.filter((p) => !allowed.includes(p));
  const missing = allowed.filter((p) => !m.usesPermissions.includes(p));
  checks.push(check('uprawnienia', unexpected.length === 0 && missing.length === 0,
    unexpected.length === 0 && missing.length === 0
      ? 'tylko wewnętrzne uprawnienie AndroidX, żadnego android.permission.*'
      : `nieoczekiwane: ${unexpected.join(', ') || 'brak'}; brakujące: ${missing.join(', ') || 'brak'}`));
  checks.push(check('AD_ID', !m.usesPermissions.includes(AD_ID), m.usesPermissions.includes(AD_ID) ? 'obecne' : 'brak'));
  checks.push(check('debuggable', !m.debuggable, m.debuggable ? 'android:debuggable="true"' : 'nie'));

  const abis = architecturesOf(facts.entries);
  checks.push(check('architektury', REQUIRED_ABIS.every((abi) => abis.includes(abi)) && abis.length === REQUIRED_ABIS.length,
    abis.join(' ') || 'brak'));

  checks.push(check('bajtkod Hermesa', facts.bundleHeadHex === HERMES_MAGIC_HEX,
    `nagłówek ${facts.bundleHeadHex} (oczekiwano ${HERMES_MAGIC_HEX})`));
  checks.push(check('treść w bundlu', facts.bundleHasVersion && facts.bundleHasScrapedAt,
    `wersja ${expected.contentVersion} ${facts.bundleHasVersion ? 'obecna' : 'NIEOBECNA'}, ` +
      `scrapedAt ${expected.contentScrapedAt} ${facts.bundleHasScrapedAt ? 'obecne' : 'NIEOBECNE'}`));

  const signerMatches = facts.signerFingerprint !== null
    && normalizeFingerprint(facts.signerFingerprint)
      === normalizeFingerprint(expected.uploadKeyFingerprint);
  checks.push(check('podpis', facts.jarVerified && signerMatches,
    `${facts.jarVerified ? 'jar verified' : 'jarsigner: NIE zweryfikowany'}, ` +
      `certyfikat ${signerMatches ? 'zgodny z kluczem przesyłania' : `INNY (${facts.signerFingerprint ?? 'brak'})`}`));
  checks.push(check('integralność', facts.unzipTestOk, facts.unzipTestOk ? 'unzip -t bez błędów' : 'unzip -t zgłasza błędy'));
  checks.push(check('mapa R8', facts.entries.includes(R8_MAP), facts.entries.includes(R8_MAP) ? R8_MAP : 'brak proguard.map'));

  const symbolsMissing = REQUIRED_ABIS.filter((abi) =>
    !facts.entries.some((e) => e.startsWith(`${DEBUG_SYMBOLS_DIR}${abi}/`) && e.endsWith('.so.sym')));
  checks.push(check('symbole natywne', symbolsMissing.length === 0,
    symbolsMissing.length === 0 ? 'dla czterech architektur' : `brak dla: ${symbolsMissing.join(', ')}`));

  if (facts.previous === null) {
    checks.push({
      name: 'porównanie z poprzednim wydaniem',
      level: 'skip',
      detail: 'brak poprzednika w katalogu wydań — monotoniczność, rozmiar i hash bundla niesprawdzone',
    });
    return checks;
  }

  const prev = facts.previous;
  checks.push(check('monotoniczność versionCode', m.versionCode > prev.versionCode,
    `${m.versionCode} > ${prev.versionCode} (${prev.tag})`));

  const deviation = Math.abs(facts.sizeBytes - prev.sizeBytes) / prev.sizeBytes;
  const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
  checks.push({
    name: 'rozmiar',
    level: deviation > SIZE_DEVIATION_ASK ? 'ask' : 'pass',
    detail: `${mb(facts.sizeBytes)} MB wobec ${mb(prev.sizeBytes)} MB w ${prev.tag} (${(deviation * 100).toFixed(0)} %)`,
  });

  if (facts.sourceChangedSincePrevious === null) {
    checks.push({ name: 'nowy kod w bundlu', level: 'skip', detail: 'nie udało się porównać źródeł z poprzednim tagiem' });
  } else {
    const bundleChanged = facts.bundleSha256 !== prev.bundleSha256;
    if (bundleChanged === facts.sourceChangedSincePrevious) {
      checks.push(check('nowy kod w bundlu', true, bundleChanged
        ? `bundel JS inny niż w ${prev.tag}, jak źródła`
        : `bundel JS identyczny z ${prev.tag}, jak źródła`));
    } else if (facts.sourceChangedSincePrevious) {
      // Sources changed, bytecode did not: a commit touching only comments, types or tests does
      // exactly this. Plausible, so it is a question — not a failure.
      checks.push({ name: 'nowy kod w bundlu', level: 'ask',
        detail: `źródła zmienione od ${prev.tag}, a bundel JS identyczny — zmiana tylko w komentarzach/typach/testach?` });
    } else {
      // Nothing changed in the inputs, yet the bytecode differs: something got in that git does
      // not know about. That is the 0.2.0 class of problem, and a failure.
      checks.push(check('nowy kod w bundlu', false, `źródła i treść bez zmian od ${prev.tag}, a bundel JS INNY`));
    }
  }

  return checks;
}

const MARK: Record<Level, (c: Check) => string> = {
  pass: (c) => `✓ ${c.name}: ${c.detail}`,
  fail: (c) => `✗ ${c.name}: ${c.detail}`,
  ask: (c) => `? ${c.name}: ${c.detail}`,
  skip: (c) => `**– ${c.name}: ${c.detail} (pominięte)**`,
};

export function render(checks: Check[]): string {
  return checks.map((c) => MARK[c.level](c)).join('\n') + '\n';
}
