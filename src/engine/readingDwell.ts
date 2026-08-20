/**
 * Confirmed reading progress — the rules, with no database or React Native access.
 *
 * A place in a lesson counts as read once it has been **on screen** for `CONFIRM_MS` in
 * total, and progress is the furthest confirmed place. Two simpler rules were tried and
 * dropped, and both failure modes are worth knowing before anyone simplifies this:
 *
 * - "the furthest position reached" credits a fling nobody read, which is the bug this
 *   replaces;
 * - "the position held still for two seconds" has a speed limit, so a reader dragging the
 *   text at their own pace silently earns nothing — and has no way to find out why.
 *
 * Time on screen has neither problem: reading at any pace keeps a place visible for
 * seconds, while a sweep shows it for a fraction of one.
 *
 * The counters live only for the length of one visit and only ever push a single number
 * upwards, so nothing here is persisted apart from that number.
 */

/** How long a place has to be on screen before it counts as read. */
export const CONFIRM_MS = 2000;

/** How many pieces the document is cut into. Fifty gives progress in steps of two percent. */
export const SEGMENTS = 50;

/**
 * The most one sample can credit.
 *
 * Deliberately below `CONFIRM_MS`: no single gap between samples may confirm a place on its
 * own. Backgrounding pauses the tracker (see `pause`), but a pause that never arrives — the
 * system suspending the screen, a missed lifecycle event — must not turn an hour in a pocket
 * into a read lesson. Ordinary samples arrive every 400–500 ms, so this clips nothing real.
 */
const MAX_CREDIT_MS = 1000;

/** Where the reader is: scroll fraction, plus the screen's height as a fraction of the page. */
export interface Viewport {
  position: number;
  view: number;
}

export interface Dwell {
  /** Milliseconds each segment has spent on screen during this visit. */
  ms: number[];
  /** The furthest confirmed place, as a fraction of the document. Never decreases. */
  confirmed: number;
  /** The window the samples have been showing since `at`. */
  shown: Viewport | null;
  /** When the last sample arrived, or null when the tracker is paused. */
  at: number | null;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function newDwell(confirmed = 0): Dwell {
  return {
    ms: new Array<number>(SEGMENTS).fill(0),
    confirmed: clamp(confirmed),
    shown: null,
    at: null,
  };
}

/**
 * Which segments the screen covers.
 *
 * `position` is `scrollY / (scrollHeight - innerHeight)`, so the visible band starts at
 * `position * (1 - view)` — that conversion is the whole reason the page reports `view`
 * alongside the position.
 */
export function visibleSegments(viewport: Viewport): [number, number] {
  const height = clamp(viewport.view);
  const top = clamp(viewport.position) * (1 - height);
  const bottom = Math.min(1, top + height);

  const first = Math.min(SEGMENTS - 1, Math.floor(top * SEGMENTS));
  const last = Math.min(SEGMENTS - 1, Math.max(first, Math.ceil(bottom * SEGMENTS) - 1));

  return [first, last];
}

function confirmedFrom(ms: number[]): number {
  for (let index = SEGMENTS - 1; index >= 0; index -= 1) {
    if (ms[index] >= CONFIRM_MS) return (index + 1) / SEGMENTS;
  }
  return 0;
}

/**
 * Takes in a sample.
 *
 * The elapsed time is credited to the window shown by the **previous** sample, since that
 * is the window that was on screen while the time passed.
 */
export function sample(dwell: Dwell, viewport: Viewport, at: number): Dwell {
  let ms = dwell.ms;

  if (dwell.shown !== null && dwell.at !== null && at > dwell.at) {
    const elapsed = Math.min(at - dwell.at, MAX_CREDIT_MS);
    const [first, last] = visibleSegments(dwell.shown);

    ms = ms.slice();
    for (let index = first; index <= last; index += 1) ms[index] += elapsed;
  }

  return {
    ms,
    confirmed: Math.max(dwell.confirmed, confirmedFrom(ms)),
    shown: viewport,
    at,
  };
}

/**
 * Stops counting: the lesson is no longer in front of the reader.
 *
 * The counters stay — leaving the app mid-lesson and coming back is the same visit — but the
 * time reference goes, so the pause itself is credited to nobody.
 */
export function pause(dwell: Dwell): Dwell {
  return { ...dwell, at: null };
}
