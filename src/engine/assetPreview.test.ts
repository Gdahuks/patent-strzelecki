import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { previewSource } from './assetPreview';

describe('previewSource', () => {
  it('carries the bytes in the address, so nothing is left to fetch', () => {
    assert.equal(previewSource('tabela.png', 'AAAA'), 'data:image/png;base64,AAAA');
  });

  it('knows both spellings of a JPEG', () => {
    assert.equal(previewSource('tarcza.jpg', 'AA'), 'data:image/jpeg;base64,AA');
    assert.equal(previewSource('tarcza.jpeg', 'AA'), 'data:image/jpeg;base64,AA');
  });

  it('is not thrown off by an upper-case extension', () => {
    assert.equal(previewSource('TARCZA.JPG', 'AA'), 'data:image/jpeg;base64,AA');
  });

  it('refuses a name that promises no image type', () => {
    // Better an honest nothing than an address the browser silently drops: the caller can
    // say the picture is missing, and the bundle cannot hold such a file anyway.
    assert.equal(previewSource('regulamin.pdf', 'AA'), null);
    assert.equal(previewSource('schemat', 'AA'), null);
  });
});
