import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { storeListingUrls } from './storeListing';

describe('storeListingUrls', () => {
  it('points both the Play Store app and the web listing at the package', () => {
    assert.deepEqual(storeListingUrls('io.github.gdahuks.patentstrzelecki'), {
      market: 'market://details?id=io.github.gdahuks.patentstrzelecki',
      web: 'https://play.google.com/store/apps/details?id=io.github.gdahuks.patentstrzelecki',
    });
  });
});
