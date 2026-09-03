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

/**
 * The smallest document the walk needs: two articles, each with its own `pass_5`, and a
 * point inside the second one. Both `pass_5`s are what the collision is about — a search
 * across the whole document finds the one in art. 1.
 *
 * `onReach` fires when the script measures a unit, which is how the walk reports where it
 * landed without the test reaching into the script's internals.
 */
function fakeDocument(onReach: (where: string) => void) {
  type Node = { id: string; where: string; children: Node[] };
  // `where` is the full position in the tree, and it is what the test asserts on: two
  // articles hold a `pass_5` **and** a `pint_6`, so an id alone could not say which copy
  // the walk reached — and a walk that stopped narrowing would still look correct.
  const unit = (id: string, ...children: Node[]): Node => ({ id, where: id, children });
  const nest = (node: Node, prefix = ''): Node => {
    const where = prefix ? `${prefix}>${node.id}` : node.id;
    return { ...node, where, children: node.children.map((child) => nest(child, where)) };
  };
  const tree = [
    unit('arti_1', unit('pass_5', unit('pint_6'))),
    unit('arti_18', unit('pass_5', unit('pint_6')), unit('pass_9')),
  ].map((node) => nest(node));

  const descendants = (nodes: Node[]): Node[] =>
    nodes.flatMap((node) => [node, ...descendants(node.children)]);

  const wrap = (node: Node) => ({
    getAttribute: (name: string) => (name === 'data-id' ? node.id : null),
    querySelectorAll: () => descendants(node.children).map(wrap),
    getBoundingClientRect: () => {
      onReach(node.where);
      return { top: 0 };
    },
    scrollIntoView: () => {},
  });

  return {
    querySelectorAll: () => descendants(tree).map(wrap),
    body: { scrollHeight: 1000 },
  };
}

/** Runs the generated script against the fake document and reports where it landed. */
function landsOn(ref: string): string | null {
  let hit: string | null = null;
  const document = fakeDocument((id) => {
    hit = id;
  });
  const window = {
    scrollY: 0,
    addEventListener: () => {},
    __psJump: 0,
    __psJumpTouch: false,
  };
  new Function('document', 'window', 'setTimeout', jumpScript(ref))(document, window, () => 0);
  return hit;
}

describe('jumpScript: walking the path', () => {
  it('resolves a repeated identifier inside the article that owns it', () => {
    // `pass_5` exists in both articles; the path is what tells them apart.
    assert.equal(landsOn('arti_18/pass_5/pint_6'), 'arti_18>pass_5>pint_6');
    assert.equal(landsOn('arti_1/pass_5'), 'arti_1>pass_5');
  });

  it('stops at the deepest step the document has', () => {
    // A renumbered point in a newer bundle still lands the reader on the right paragraph.
    assert.equal(landsOn('arti_18/pass_9/pint_3'), 'arti_18>pass_9');
    assert.equal(landsOn('arti_18'), 'arti_18');
  });

  it('lands nowhere when the leading step is missing', () => {
    assert.equal(landsOn('arti_99/pass_5'), null);
  });
});
