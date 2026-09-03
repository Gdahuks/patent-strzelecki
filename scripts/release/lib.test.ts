import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

const LIB = join(import.meta.dirname, 'lib.sh');

/** Runs a bash snippet with lib.sh sourced, stdin closed (so there is never a TTY). */
function bash(snippet: string, releaseDir: string) {
  const result = spawnSync('bash', ['-c', `source "${LIB}"; ${snippet}`], {
    encoding: 'utf8',
    input: '',
    env: {
      ...process.env,
      REPO: process.cwd(),
      TAG: 'v9.9.9',
      RELEASE_DIR: releaseDir,
      STAGE: 'probe',
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function freshDir() {
  return mkdtempSync(join(tmpdir(), 'lib-test-'));
}

describe('lib.sh', () => {
  it('calls a tag published when the ref on origin points at the same commit', () => {
    const r = bash('begin; tag_publication_state abc123 abc123', freshDir());

    assert.equal(r.status, 0);
    assert.match(r.stdout, /^published$/m);
  });

  it('calls a missing tag withheld only when the flag says it is deliberate', () => {
    // The release is built before it is uploaded and the tag is published after, so „not on
    // origin" is a normal state — but only when someone said so.
    const dir = freshDir();

    assert.match(bash('begin; TAG_LOCAL=1 tag_publication_state abc123 ""', dir).stdout, /^withheld$/m);
    assert.match(bash('begin; tag_publication_state abc123 ""', dir).stdout, /^missing$/m);
  });

  it('calls a tag missing when origin has it at another commit, flag or no flag', () => {
    // A ref that disagrees with the local one is not a withheld tag, it is a tag someone else
    // moved — the flag must not wave that through.
    const dir = freshDir();

    assert.match(bash('begin; tag_publication_state abc123 def456', dir).stdout, /^missing$/m);
    assert.match(
      bash('begin; TAG_LOCAL=1 tag_publication_state abc123 def456', dir).stdout,
      /^missing$/m,
    );
  });

  it('log writes to the terminal and to release.log with a timestamp and the stage', () => {
    const dir = freshDir();
    const r = bash('begin; log hello', dir);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /hello/);
    const log = readFileSync(join(dir, 'release.log'), 'utf8');
    assert.match(log, /^\[\d\d:\d\d:\d\d\] \[probe\] hello$/m);
  });

  it('run appends the command output to the log and dies with the tail when it fails', () => {
    const dir = freshDir();
    const r = bash('begin; run sh -c "echo from-the-command; exit 7"', dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /command failed: sh -c/);
    assert.match(r.stderr, /from-the-command/);
    const log = readFileSync(join(dir, 'release.log'), 'utf8');
    // Arguments are logged shell-quoted (printf %q), so the exact spacing is not asserted.
    assert.match(log, /\$ sh -c .*from-the-command/);
    assert.match(log, /^from-the-command$/m);
  });

  it('run_in executes in the given directory', () => {
    const dir = freshDir();
    const r = bash(`begin; run_in "${dir}" pwd; grep -c "${dir}" "${dir}/release.log"`, dir);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^[1-9]/m);
  });

  it('ask refuses to ask without a terminal', () => {
    const dir = freshDir();
    const r = bash('begin; ask "Continue?"; echo reached', dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no terminal/);
    assert.doesNotMatch(r.stdout, /reached/);
  });

  it('die exits with the given code and points at the log', () => {
    const dir = freshDir();
    const r = bash('begin; die 2 "environment is wrong"', dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /✗ \[probe\] environment is wrong/);
    assert.match(r.stderr, /release\.log/);
  });

  it('stage markers: stage_done creates one, require_stage dies without one', () => {
    const dir = freshDir();
    const missing = bash('begin; require_stage build', dir);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /make release-build TAG=v9\.9\.9/);
    const done = bash('begin; stage_done', dir);
    assert.equal(done.status, 0);
    assert.ok(existsSync(join(dir, '.stage', 'probe')));
    // A marker left by *another* stage — the only kind require_stage is ever asked about, since
    // begin clears the running stage's own.
    const present = bash('begin; mkdir -p "$STAGE_DIR"; : > "$STAGE_DIR/build"; require_stage build; echo fine', dir);
    assert.equal(present.status, 0);
    assert.match(present.stdout, /fine/);
  });

  it('begin clears its own stage marker, so an unfinished rerun does not vouch for itself', () => {
    const dir = freshDir();
    const done = bash('begin; stage_done', dir);
    assert.equal(done.status, 0);
    assert.ok(existsSync(join(dir, '.stage', 'probe')));
    // A stage that starts again but does not finish must leave nothing behind for require_stage.
    const restarted = bash('begin', dir);
    assert.equal(restarted.status, 0);
    assert.ok(!existsSync(join(dir, '.stage', 'probe')));
    const after = bash('begin; require_stage probe', dir);
    assert.equal(after.status, 2);
    assert.match(after.stderr, /make release-probe TAG=v9\.9\.9/);
  });

  it('begin invalidates the markers of every later stage, and never the uploaded one', () => {
    const dir = freshDir();
    // A rerun of build means a new AAB: the verify and summary that judged the old one must go,
    // while preflight and content still hold — and "uploaded" is a fact about Play, not a result.
    const r = bash(
      'STAGE=build; mkdir -p "$STAGE_DIR";'
        + ' for s in preflight content build verify summary uploaded; do : > "$STAGE_DIR/$s"; done;'
        + ' begin',
      dir,
    );
    assert.equal(r.status, 0);
    const marker = (name: string) => existsSync(join(dir, '.stage', name));
    assert.ok(!marker('build'), 'build (its own) should be gone');
    assert.ok(!marker('verify'), 'verify (later) should be gone');
    assert.ok(!marker('summary'), 'summary (later) should be gone');
    assert.ok(marker('preflight'), 'preflight (earlier) should stay');
    assert.ok(marker('content'), 'content (earlier) should stay');
    assert.ok(marker('uploaded'), 'uploaded is a human fact and must survive any rerun');
  });

  it('ok and fail write ✓/✗ lines to checks.md; fail also dies', () => {
    const dir = freshDir();
    const r = bash('begin; ok "package matches"; fail "version differs"', dir);
    assert.equal(r.status, 1);
    const checks = readFileSync(join(dir, 'checks.md'), 'utf8');
    assert.match(checks, /^✓ package matches$/m);
    assert.match(checks, /^✗ version differs$/m);
  });

  it('meta_set / meta_get round-trip through release.json; a missing key is an error', () => {
    const dir = freshDir();
    const r = bash('begin; meta_set tag v1.2.3; meta_set n 5; meta_get tag; echo; meta_get n', dir);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /v1\.2\.3\n5/);
    const missing = bash('begin; meta_get nothing', dir);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /no "nothing"/);
  });
});
