import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

import { type Card, createDeck } from './leitner';
import {
  type PracticeSnapshot,
  clearSessions,
  restoreSession,
  saveSession,
  sessionKey,
} from './practiceSession';

function card(questionId: string, bucket: number, seen: number): Card {
  return { questionId, bucket, seen, correct: Math.max(0, seen - 1) };
}

function snapshot(cards: Card[], levels = 3): PracticeSnapshot {
  const ids = cards.map((entry) => entry.questionId);
  return {
    deck: createDeck(ids, new Map(cards.map((entry) => [entry.questionId, entry])), levels),
    currentId: ids[0] ?? null,
    orders: new Map([[ids[0], ['B', 'A', 'C']]]),
    picks: new Map([[ids[0], 'B']]),
    views: new Map(),
    history: [ids[0]],
    picked: 'B',
    revealed: false,
  };
}

const KEY = sessionKey('test', 'prawo-karne');

describe('practice sessions', () => {
  beforeEach(() => clearSessions());

  it('gives each mode of a set its own key', () => {
    assert.notEqual(sessionKey('test', 'uobia'), sessionKey('flashcards', 'uobia'));
    assert.notEqual(sessionKey('test', 'uobia'), sessionKey('test', 'uobia,bron'));
  });

  it('restores a saved session for the same questions and level count', () => {
    const saved = snapshot([card('a', 0, 1), card('b', 2, 2)]);
    saveSession(KEY, saved);

    assert.equal(restoreSession(KEY, { levels: 3, weak: false, poolIds: ['b', 'a'] }), saved);
  });

  it('starts afresh with nothing saved, another level count or another set of questions', () => {
    saveSession(KEY, snapshot([card('a', 0, 1), card('b', 2, 2)]));

    assert.equal(restoreSession(sessionKey('flashcards', 'prawo-karne'),
      { levels: 3, weak: false, poolIds: ['a', 'b'] }), null);
    assert.equal(restoreSession(KEY, { levels: 4, weak: false, poolIds: ['a', 'b'] }), null);
    assert.equal(restoreSession(KEY, { levels: 3, weak: false, poolIds: ['a', 'b', 'c'] }), null);
  });

  it('restores the mistakes set although the questions fixed in it have left the pool', () => {
    // 'b' was fixed in this session, so the database no longer lists it as a mistake.
    const saved = snapshot([card('a', 0, 2), card('b', 1, 2), card('c', 0, 1)]);
    const key = sessionKey('test', 'moje-bledy');
    saveSession(key, saved);

    assert.equal(restoreSession(key, { levels: 3, weak: true, poolIds: ['c', 'a'] }), saved);
  });

  it('starts the mistakes set afresh when mistakes came or went elsewhere, or none are left', () => {
    const key = sessionKey('test', 'moje-bledy');
    saveSession(key, snapshot([card('a', 0, 2), card('b', 1, 2)]));

    assert.equal(restoreSession(key, { levels: 3, weak: true, poolIds: ['a', 'x'] }), null);
    assert.equal(restoreSession(key, { levels: 3, weak: true, poolIds: [] }), null);
  });

  it('forgets every session at once', () => {
    saveSession(KEY, snapshot([card('a', 0, 1)]));

    clearSessions();

    assert.equal(restoreSession(KEY, { levels: 3, weak: false, poolIds: ['a'] }), null);
  });
});
