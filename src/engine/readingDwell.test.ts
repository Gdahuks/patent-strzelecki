import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  CONFIRM_MS,
  SEGMENTS,
  type Dwell,
  newDwell,
  pause,
  sample,
  visibleSegments,
} from './readingDwell';

/** A viewport one tenth of the document high, scrolled to `position`. */
function view(position: number, height = 0.1) {
  return { position, view: height };
}

/** The screen ticks every half second while a lesson is open. */
const TICK_MS = 500;

/** Stays put for `ms`, sampled at the screen's own tick rate. */
function stay(dwell: Dwell, viewport: { position: number; view: number }, ms: number, from = 0) {
  let current = dwell;
  for (let elapsed = 0; elapsed <= ms; elapsed += TICK_MS) {
    current = sample(current, viewport, from + elapsed);
  }
  return current;
}

/** Moves from `from` to `to` in `steps` moves, `stepMs` apart. */
function scroll(
  dwell: Dwell,
  from: number,
  to: number,
  steps: number,
  stepMs: number,
  startAt = 0,
  height = 0.1,
) {
  let current = dwell;
  for (let index = 0; index <= steps; index += 1) {
    const position = from + ((to - from) * index) / steps;
    current = sample(current, view(position, height), startAt + index * stepMs);
  }
  return current;
}

describe('visibleSegments', () => {
  it('covers the whole document when the page is shorter than the screen', () => {
    assert.deepEqual(visibleSegments({ position: 0, view: 1 }), [0, SEGMENTS - 1]);
  });

  it('at the top it starts at the first segment', () => {
    const [first] = visibleSegments(view(0));
    assert.equal(first, 0);
  });

  it('at the bottom it reaches the last segment', () => {
    const [, last] = visibleSegments(view(1));
    assert.equal(last, SEGMENTS - 1);
  });
});

describe('sample', () => {
  it('confirms nothing without a second sample to measure time against', () => {
    const dwell = sample(newDwell(), view(1), 1000);

    assert.equal(dwell.confirmed, 0);
  });

  it('confirms the end after resting there long enough', () => {
    // Enters, scrolls to the bottom, stays: the accepted case.
    const dwell = stay(newDwell(), view(1), CONFIRM_MS);

    assert.equal(dwell.confirmed, 1);
  });

  it('confirms nothing on a fast sweep down and back up, however long it takes', () => {
    // Five seconds of movement, no place on screen for two: checking how much text there is.
    let dwell = scroll(newDwell(), 0, 1, 10, 250);
    dwell = scroll(dwell, 1, 0, 10, 250, 2500);

    assert.equal(dwell.confirmed, 0);
  });

  it('confirms progress during a slow continuous drag', () => {
    // Reading while dragging: every place crosses the screen for well over two seconds.
    const dwell = scroll(newDwell(), 0, 0.5, 20, 1000);

    assert.ok(dwell.confirmed >= 0.4, `expected progress, got ${dwell.confirmed}`);
  });

  it('never lowers a peak already reached', () => {
    const dwell = stay(newDwell(0.8), view(0.2), 4 * CONFIRM_MS);

    assert.equal(dwell.confirmed, 0.8);
  });

  it('credits a short lesson only after it has been on screen long enough', () => {
    const opened = sample(newDwell(), { position: 0, view: 1 }, 0);
    assert.equal(opened.confirmed, 0);

    const stayed = stay(opened, { position: 0, view: 1 }, CONFIRM_MS, 0);
    assert.equal(stayed.confirmed, 1);
  });

  it('no single gap can confirm a place on its own', () => {
    // The app spent an hour in the background with the lesson open and the pause was missed.
    let dwell = sample(newDwell(), view(0.5), 0);
    dwell = sample(dwell, view(0.5), 3_600_000);

    assert.equal(dwell.confirmed, 0);
  });
});

describe('pause', () => {
  it('drops the time reference, so a pause credits nothing on return', () => {
    let dwell = sample(newDwell(), view(0.5), 0);
    dwell = pause(dwell);
    dwell = sample(dwell, view(0.5), 60_000);

    assert.equal(dwell.confirmed, 0);
  });

  it('keeps the counters gathered before the pause', () => {
    let dwell = stay(newDwell(), view(1), CONFIRM_MS - TICK_MS);
    assert.equal(dwell.confirmed, 0, 'not confirmed yet');

    dwell = pause(dwell);
    dwell = stay(dwell, view(1), TICK_MS, 60_000);

    assert.equal(dwell.confirmed, 1);
  });
});
