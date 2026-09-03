import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { JUMP_DEADLINE_MS, JUMP_TICK_MS, jumpScript } from './jumpScript';

describe('jumpScript', () => {
  it('embeds the steps as JS string literals, so any ref is safe in the selector', () => {
    // A step starting with a digit or containing a dot broke `querySelector` when it was
    // pasted into a selector; comparing `data-id` values needs no selector syntax at all.
    const script = jumpScript('1.arti-4]');

    assert.match(script, /var path = \["1\.arti-4\]"\];/);
    // Guards against a step being spliced into a selector on the same line; a multi-line
    // splice would slip past `.` — good enough for a shape check, not a full fence.
    assert.doesNotMatch(script, /querySelector\(.*path\[/);
  });

  it('walks a path step by step, each one inside the last', () => {
    // Identifiers below an article repeat across the document — the firearms act has fifty
    // `pass_1` — so „art. 18 ust. 5 pkt 6" can only be found by descending through arti_18.
    const script = jumpScript('arti_18/pass_5/pint_6');

    assert.match(script, /var path = \["arti_18","pass_5","pint_6"\];/);
    // The search narrows to the step found last, instead of restarting from the document.
    assert.match(script, /scope\.querySelectorAll\('\[data-id\]'\)/);
    assert.match(script, /scope = step;/);
    // A step the document doesn't have stops the walk, leaving the deepest one found.
    assert.match(script, /if \(!step\) break;/);
  });

  it('keeps trying until the unit sits at the top and the page has stopped growing', () => {
    // On a cold start the page reports "loaded" before its layout is final, and a single
    // scrollIntoView lands on 0 because the document is still short. The script re-checks
    // the target's position and the document height and scrolls again while either moves.
    const script = jumpScript('arti_263');

    assert.match(script, /scrollIntoView/);
    assert.match(script, /getBoundingClientRect\(\)\.top/);
    assert.match(script, /scrollHeight/);
    assert.match(script, new RegExp(`Date\\.now\\(\\) \\+ ${JUMP_DEADLINE_MS}`));
    assert.match(script, new RegExp(`setTimeout\\(settle, ${JUMP_TICK_MS}\\)`));
    // Two quiet ticks, not one: a layout can pause for a moment and then grow.
    assert.match(script, /quiet < 2/);
  });

  it('lets only the newest jump run, so two taps in the unit list never fight', () => {
    const script = jumpScript('arti_1');

    assert.match(script, /window\.__psJump = \(window\.__psJump \|\| 0\) \+ 1/);
    assert.match(script, /if \(token !== window\.__psJump\) return;/);
  });

  it('stops retrying the moment the reader starts scrolling on their own', () => {
    // Two seconds of "put it back" would fight a reader who opened the act and swiped at
    // once; the first touch ends the loop.
    assert.match(jumpScript('arti_1'), /touchstart/);
  });

  it('gives up quietly when the unit is not in the document', () => {
    const script = jumpScript('nope');

    assert.match(script, /if \(!unit\) return;/);
    assert.doesNotMatch(script, /throw/);
    assert.match(script, /true;\s*\}\)\(\);\s*$/);
  });
});
