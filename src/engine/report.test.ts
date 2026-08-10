import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { REPORT_ADDRESS, REPORT_SUBJECT, reportMailto, versionLine } from './report';

const RELEASE = {
  version: '1.0.0',
  build: '104',
  commit: 'de5b7ee',
  day: '9.08.2026',
  bundle: '5300c5a2c15c',
  system: 'Android 36',
};

describe('versionLine', () => {
  it('assembles version, build, date and commit', () => {
    assert.equal(versionLine(RELEASE), 'Wersja 1.0.0 (104), zbudowana 9.08.2026 z de5b7ee');
  });

  it('carries the mark of uncommitted changes', () => {
    // The „+" suffix is the only thing distinguishing a workshop build from one that can be
    // diffed against the public repository — it must not get lost along the way.
    assert.match(versionLine({ ...RELEASE, commit: 'de5b7ee+' }), /z de5b7ee\+$/);
  });

  it('gives just the version without a commit', () => {
    // A build made outside the repository: "built from null" would read like an app bug.
    const linia = versionLine({ ...RELEASE, commit: null, day: null });
    assert.equal(linia, 'Wersja 1.0.0 (104)');
  });

  it('leaves just the commit when there is no commit date', () => {
    assert.equal(versionLine({ ...RELEASE, day: null }), 'Wersja 1.0.0 (104), zbudowana z de5b7ee');
  });
});

describe('reportMailto', () => {
  it('points to the reports alias', () => {
    assert.ok(reportMailto(RELEASE).startsWith(`mailto:${REPORT_ADDRESS}?`));
  });

  it('writes a fixed subject so it can be filtered', () => {
    const url = new URL(reportMailto(RELEASE));
    assert.equal(url.searchParams.get('subject'), REPORT_SUBJECT);
  });

  it('appends a footer with the version, bundle and system', () => {
    const body = new URL(reportMailto(RELEASE)).searchParams.get('body') ?? '';
    assert.ok(body.includes('Wersja 1.0.0 (104), zbudowana 9.08.2026 z de5b7ee'));
    assert.ok(body.includes('Paczka treści 5300c5a2c15c'));
    assert.ok(body.includes('System Android 36'));
  });

  it('leaves room for text above the footer', () => {
    // Without this the cursor sits below the technical data, and the writer has to scroll
    // past it.
    const body = new URL(reportMailto(RELEASE)).searchParams.get('body') ?? '';
    assert.ok(body.startsWith('\n\n---\n'));
  });

  it("omits the system when it isn't given", () => {
    const body = new URL(reportMailto({ ...RELEASE, system: undefined })).searchParams.get('body');
    assert.ok(!(body ?? '').includes('System'));
  });

  it('encodes Polish characters and the dash in the subject', () => {
    // An unencoded subject with „—" and „ł" can get cut off partway on its way to the mail
    // client.
    const url = reportMailto(RELEASE);
    assert.ok(!url.includes('—'));
    assert.ok(url.includes(encodeURIComponent(REPORT_SUBJECT)));
  });
});
