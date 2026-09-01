// Release stage 4: what is actually inside the file that will go to the store.
//
// Everything is read from app-release.aab in the release directory — never from the working
// tree, which is a different question (and the 0.2.0 lesson: the two can disagree while every
// log says success). Facts are gathered here with bundletool, unzip, jarsigner and keytool;
// the judgement is in checks.ts, where it has tests.
//
// Usage (from make): REPO=… TAG=… RELEASES_DIR=… RELEASE_DIR=… node scripts/release/verify.ts

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { evaluate, jarsignerVerified, parseManifestDump, render, type Check, type Expected, type Facts, type PreviousRelease } from './checks.ts';

const STAGE = 'verify';

// Static property access on purpose — eslint-config-expo forbids `process.env[name]`.
function required(name: string, value: string | undefined): string {
  if (!value) {
    process.stderr.write(`${name} must be set\n`);
    process.exit(2);
  }
  return value;
}

const REPO = required('REPO', process.env.REPO);
const TAG = required('TAG', process.env.TAG);
const RELEASES_DIR = required('RELEASES_DIR', process.env.RELEASES_DIR);
const RELEASE_DIR = required('RELEASE_DIR', process.env.RELEASE_DIR);
const LOG = join(RELEASE_DIR, 'release.log');
const CHECKS = join(RELEASE_DIR, 'checks.md');
const META = join(RELEASE_DIR, 'release.json');
const AAB = join(RELEASE_DIR, 'app-release.aab');

const stamp = () => new Date().toTimeString().slice(0, 8);
/** `YYYY-MM-DD HH:MM` in local time — this heading sits among the bash stages, which log local
 *  time; a UTC one made verify look as if it had run two hours before the build. */
function localStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
function note(line: string): void {
  appendFileSync(LOG, `[${stamp()}] [${STAGE}] ${line}\n`);
}
function log(line: string): void {
  process.stdout.write(`${line}\n`);
  note(line);
}
function die(message: string, code = 1): never {
  note(`FAILED: ${message}`);
  process.stderr.write(`\n✗ [${STAGE}] ${message}\n  log: ${LOG}\n`);
  process.exit(code);
}

type Meta = Record<string, string>;
function readMeta(): Meta {
  return JSON.parse(readFileSync(META, 'utf8')) as Meta;
}
function metaGet(meta: Meta, key: string): string {
  const value = meta[key];
  if (value === undefined || value === '') die(`release.json has no "${key}" — rerun the earlier stages`);
  return value;
}
function metaSet(key: string, value: string): void {
  const meta = readMeta();
  meta[key] = value;
  writeFileSync(META, `${JSON.stringify(meta, null, 2)}\n`);
}

/** Runs a tool, logs the invocation, returns stdout; dies with stderr when it fails. */
function tool(command: string, args: string[]): string {
  note(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  // `error` is set when the command could not be started at all (ENOENT); stdout/stderr are
  // null then, so it has to be handled before anything reads them.
  if (result.error) die(`cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    appendFileSync(LOG, `${result.stdout}${result.stderr}`);
    die(`command failed: ${command} ${args.join(' ')}\n${result.stderr.trim().split('\n').slice(-10).join('\n')}`);
  }
  return result.stdout;
}

/** The highest vX.Y.Z below `tag` in the releases directory carrying the given stage marker. */
function previousRelease(tag: string, stage: 'uploaded' | 'verify'): string | null {
  const parse = (name: string) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(name)?.slice(1).map(Number) ?? null;
  const current = parse(tag);
  if (!current) return null;
  const lower = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const candidates = readdirSync(RELEASES_DIR)
    .filter((name) => parse(name) !== null && lower(parse(name)!, current) < 0)
    .filter((name) => existsSync(join(RELEASES_DIR, name, '.stage', stage)))
    .sort((a, b) => lower(parse(a)!, parse(b)!));
  return candidates.at(-1) ?? null;
}

async function askYes(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) die(`cannot ask "${question}" — no terminal, and this pipeline never assumes consent`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim();
  rl.close();
  note(`asked: ${question} → ${answer || '<enter>'}`);
  // The questions are English, so `y` has to work; `t` stays because that is what the prompt
  // used to accept and it is still the reflex of whoever runs this.
  return ['y', 'yes', 't', 'tak'].includes(answer.toLowerCase());
}

async function main(): Promise<void> {
  if (!existsSync(join(RELEASE_DIR, '.stage', 'build'))) {
    die(`stage "build" has not run for ${TAG} — run: make release-build TAG=${TAG}`, 2);
  }
  // A stage that starts again invalidates everything built on its previous result (lib.sh's
  // `begin` does the same for the bash stages): a summary must never vouch for a verify that has
  // not finished, and the old verify marker must not survive a failed rerun.
  rmSync(join(RELEASE_DIR, '.stage', 'verify'), { force: true });
  rmSync(join(RELEASE_DIR, '.stage', 'summary'), { force: true });
  if (!existsSync(AAB)) die(`no package at ${AAB}`);
  log(`── ${STAGE} ── ${localStamp()}`);

  const meta = readMeta();
  const bundletool = join(RELEASES_DIR, 'tools', `bundletool-all-${metaGet(meta, 'bundletoolVersion')}.jar`);
  if (!existsSync(bundletool)) die(`no bundletool at ${bundletool} — rerun: make release-preflight TAG=${TAG}`);

  // From the tag, not from the working tree — this file's own premise is that the two can
  // disagree while every log says success. `git show` reads the tagged blob directly, which
  // also survives the build worktree being removed on success.
  const appJson = JSON.parse(tool('git', ['-C', REPO, 'show', `${TAG}:app.json`])) as { expo: { android: { package: string } } };

  const expected: Expected = {
    package: appJson.expo.android.package,
    versionName: metaGet(meta, 'version'),
    versionCode: Number(metaGet(meta, 'expectedVersionCode')),
    minSdk: 24,
    targetSdk: 36,
    contentVersion: metaGet(meta, 'contentVersion'),
    contentScrapedAt: metaGet(meta, 'contentScrapedAt'),
    uploadKeyFingerprint: metaGet(meta, 'uploadKeyFingerprint'),
  };

  // ── Facts ──────────────────────────────────────────────────────────────────
  const manifestXml = tool('java', ['-jar', bundletool, 'dump', 'manifest', `--bundle=${AAB}`]);
  const manifest = parseManifestDump(manifestXml);

  const entries = tool('unzip', ['-Z1', AAB]).split('\n').filter(Boolean);

  const unzipTest = spawnSync('unzip', ['-tq', AAB], { encoding: 'utf8' });
  if (unzipTest.error) die(`cannot run unzip: ${unzipTest.error.message}`);
  note(`$ unzip -tq → exit ${unzipTest.status ?? 'none'}: ${unzipTest.stdout.trim()}`);

  // The Hermes bytecode is binary; Buffer.includes finds the ASCII version hash and timestamp
  // regardless (Polish strings sit there as UTF-16 and would not be found this way — these two
  // are plain ASCII, which is the whole reason they are the markers).
  note('$ unzip -p base/assets/index.android.bundle');
  let bundle: Buffer;
  try {
    bundle = execFileSync('unzip', ['-p', AAB, 'base/assets/index.android.bundle'], { maxBuffer: 256 * 1024 * 1024 });
  } catch (error) {
    die(`no base/assets/index.android.bundle in the package: ${(error as Error).message}`);
  }
  if (bundle.length === 0) die('base/assets/index.android.bundle is empty');
  // SHA-256 of the JS bundle, not of the AAB — that one is in SHA256SUMS.
  const bundleSha256 = createHash('sha256').update(bundle).digest('hex');

  const jarsigner = tool('jarsigner', ['-verify', '-verbose', '-certs', AAB]);
  const printcert = tool('keytool', ['-printcert', '-jarfile', AAB]);
  const signerFingerprint = /SHA256:\s*([0-9A-Fa-f:]+)/.exec(printcert)?.[1] ?? null;

  const sizeBytes = statSync(AAB).size;

  // ── Previous release ───────────────────────────────────────────────────────
  let previous: PreviousRelease | null = null;
  let sourceChanged: boolean | null = null;
  let previousNote = '';
  const previousTag = previousRelease(TAG, 'uploaded') ?? previousRelease(TAG, 'verify');
  if (previousTag) {
    const basis = existsSync(join(RELEASES_DIR, previousTag, '.stage', 'uploaded')) ? 'wgrane do Play' : 'tylko zbudowane';
    const prevMeta = JSON.parse(readFileSync(join(RELEASES_DIR, previousTag, 'release.json'), 'utf8')) as Meta;
    if (prevMeta.manifestVersionCode && prevMeta.sizeBytes && prevMeta.bundleSha256) {
      previous = {
        tag: previousTag,
        versionCode: Number(prevMeta.manifestVersionCode),
        sizeBytes: Number(prevMeta.sizeBytes),
        bundleSha256: prevMeta.bundleSha256,
      };
      const diff = spawnSync('git', ['-C', REPO, 'diff', '--quiet', `${previousTag}..${TAG}`, '--',
        'src', 'app', 'assets', 'app.json', 'app.config.js', 'package-lock.json']);
      const sourceDiffers = diff.status === 0 ? false : diff.status === 1 ? true : null;
      // The content bundle ships inside the JS bundle but lives outside git, so "did the input
      // to the bundle change" has to include the content version as well.
      const contentDiffers = prevMeta.contentVersion
        ? prevMeta.contentVersion !== expected.contentVersion
        : null;
      sourceChanged = sourceDiffers === null || contentDiffers === null
        ? null
        : sourceDiffers || contentDiffers;
      previousNote = `Porównanie z ${previousTag} (${basis}).`;
      if (basis !== 'wgrane do Play') previousNote = `**${previousNote} Nie ma wydania oznaczonego make release-uploaded.**`;
    } else {
      previousNote = `**Poprzednik ${previousTag} nie ma danych z verify — porównania pominięte.**`;
    }
  }

  const facts: Facts = {
    manifest,
    entries,
    sizeBytes,
    bundleHeadHex: bundle.subarray(0, 4).toString('hex'),
    bundleHasVersion: bundle.includes(expected.contentVersion, 0, 'latin1'),
    bundleHasScrapedAt: bundle.includes(expected.contentScrapedAt, 0, 'latin1'),
    bundleSha256,
    jarVerified: jarsignerVerified(jarsigner),
    signerFingerprint,
    unzipTestOk: unzipTest.status === 0,
    previous,
    sourceChangedSincePrevious: sourceChanged,
  };

  // ── Judgement ──────────────────────────────────────────────────────────────
  const checks: Check[] = evaluate(facts, expected);
  const rendered = render(checks);
  appendFileSync(CHECKS, `## Artefakt\n${previousNote ? `${previousNote}\n` : ''}${rendered}`);
  process.stdout.write(rendered);
  note(rendered.trimEnd());

  metaSet('sizeBytes', String(sizeBytes));
  metaSet('bundleSha256', bundleSha256);
  metaSet('manifestVersionCode', String(manifest.versionCode));
  // Only when there is one — release.json never holds an empty value (meta_get treats it as
  // missing).
  if (previousTag) metaSet('previousTag', previousTag);

  const failed = checks.filter((c) => c.level === 'fail');
  if (failed.length > 0) die(`${failed.length} check(s) failed — see ${CHECKS}`);

  for (const question of checks.filter((c) => c.level === 'ask')) {
    if (await askYes(`${question.name}: ${question.detail}. Continue?`)) {
      appendFileSync(CHECKS, `**Zaakceptowano: ${question.name} — ${question.detail}.**\n`);
    } else {
      die(`stopped at "${question.name}" — ${question.detail}`);
    }
  }
  appendFileSync(CHECKS, '\n');

  writeFileSync(join(RELEASE_DIR, '.stage', 'verify'), `${new Date().toISOString()}\n`);
  log(`verify complete: ${checks.length} checks, ${failed.length} failed`);
}

// Anything thrown on the way — a malformed release.json, a manifest dump that does not parse —
// has to leave the same trace as a checked failure: FAILED in the log and the pointer to it on
// stderr. Without this the stage ends in a bare stack trace and the log just stops.
await main().catch((error: unknown) => {
  die(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
