import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { findHelpersScript } from './findInPage';
import {
  MIN_QUERY_LENGTH,
  countHighlights,
  excerptAround,
  findAtWordStart,
  fold,
  markedExcerptAt,
  normalize,
  search,
  searchLessons,
  searchQuestions,
  stripHtml,
  textNodes,
} from './search';
import type { Lesson, Question } from './types';

function question(id: string, text: string, answers: string[], law = ''): Question {
  return {
    id,
    question: text,
    answers: { A: answers[0], B: answers[1], C: answers[2] },
    correct: 'A',
    law,
    lesson: 'uobia',
  };
}

function lesson(slug: string, title: string, html: string): Lesson {
  return { slug, title, order: 1, html, sets: [] };
}

const QUESTIONS = [
  question('q1', 'Kto wydaje pozwolenie na broń?', ['Komendant Wojewódzki Policji', 'PZSS', 'Sąd']),
  question('q2', 'Ile lat musi mieć osoba ubiegająca się o patent?', ['18', '17', '16'], 'UoBiA art. 15'),
  question('q3', 'Co to obrona konieczna?', ['Odparcie zamachu', 'Atak', 'Ucieczka'], 'KK art. 25'),
];

const LESSONS = [
  lesson('uobia', 'Ustawa o Broni i Amunicji', '<p>Pozwolenie na broń wydaje Policja. Broń palna.</p>'),
  lesson('przepisy-karne', 'Przepisy karne', '<p>Przepisy karne dotyczą <strong>broni</strong>.</p>'),
];

describe('normalize', () => {
  it('is case-insensitive', () => {
    assert.equal(normalize('BROŃ'), normalize('broń'));
  });

  it('strips Polish diacritics', () => {
    assert.equal(normalize('broń'), 'bron');
    assert.equal(normalize('bezpieczeństwo'), 'bezpieczenstwo');
    assert.equal(normalize('łódź'), 'lodz');
    assert.equal(normalize('ĄĆĘŃÓŚŹŻ'), 'acenoszz');
  });

  it('collapses whitespace', () => {
    assert.equal(normalize('  broń   palna \n'), 'bron palna');
  });
});

describe('stripHtml', () => {
  it('removes markup, leaving the text', () => {
    assert.equal(stripHtml('<p>Broń <strong>palna</strong></p>'), 'Broń palna');
  });

  it('removes scripts along with their content', () => {
    assert.equal(stripHtml('<p>tekst</p><script>var x = 1;</script>'), 'tekst');
  });

  it('decodes entities', () => {
    assert.equal(stripHtml('<p>a &amp; b &quot;c&quot;</p>'), 'a & b "c"');
  });
});

describe('textNodes', () => {
  it('splits content at markup, like a browser into text nodes', () => {
    assert.deepEqual(textNodes('<p>patentowy <abbr>PZSS</abbr></p>'), ['patentowy ', 'PZSS']);
  });

  it('skips nodes made of nothing but whitespace', () => {
    assert.deepEqual(textNodes('<ul>\n  <li>tekst</li>\n</ul>'), ['tekst']);
  });

  it('leaves whitespace inside a node untouched', () => {
    // The highlighting script sees the raw content of the node, so a phrase split by
    // a line break is not a match for it — the counter can't pretend otherwise.
    assert.deepEqual(textNodes('<p>prawa jazdy.\n  Caly proces</p>'), [
      'prawa jazdy.\n  Caly proces',
    ]);
  });

  it('removes scripts, but keeps the nodes they split apart separate', () => {
    assert.deepEqual(textNodes('a<script>var x = 1;</script>b'), ['a', 'b']);
  });
});

describe('findAtWordStart', () => {
  it('matches at the start of the text', () => {
    assert.equal(findAtWordStart('bron palna', 'bron'), 0);
  });

  it('matches after a space', () => {
    assert.equal(findAtWordStart('posiadanie broni', 'bron'), 11);
  });

  it('skips an occurrence inside a word', () => {
    assert.equal(findAtWordStart('obrona konieczna', 'bron'), -1);
  });

  it('skips the middle of a word, but finds a later valid match', () => {
    assert.equal(findAtWordStart('obrona i bron', 'bron'), 9);
  });

  it('matches after a punctuation mark', () => {
    assert.equal(findAtWordStart('(bron)', 'bron'), 1);
  });

  it('returns -1 for an empty phrase', () => {
    assert.equal(findAtWordStart('cokolwiek', ''), -1);
  });

  it('returns -1 when there’s no match', () => {
    assert.equal(findAtWordStart('cokolwiek', 'czolg'), -1);
  });
});

describe('excerptAround', () => {
  const text = 'Pierwsze zdanie o niczym. Pozwolenie na broń wydaje Komendant. Trzecie zdanie.';

  it('cuts an excerpt around the match', () => {
    const excerpt = excerptAround(text, 'Komendant', 20);

    assert.ok(excerpt.includes('Komendant'));
    assert.ok(excerpt.length < text.length);
  });

  it('marks a cut with an ellipsis', () => {
    assert.ok(excerptAround(text, 'Komendant', 15).startsWith('…'));
  });

  it('doesn’t add a leading ellipsis when the match is at the start', () => {
    assert.ok(!excerptAround(text, 'Pierwsze', 20).startsWith('…'));
  });

  it('handles no match at all', () => {
    assert.ok(excerptAround(text, 'czegotutajniema', 20).length > 0);
  });

  it('finds a match despite a difference in diacritics', () => {
    assert.ok(excerptAround(text, 'bron', 20).includes('broń'));
  });

  it('tolerates a trailing space in the phrase', () => {
    // The normal state while typing a multi-word phrase. The excerpt used to come from the
    // start of the text and not contain the match at all.
    assert.ok(excerptAround(text, 'Komendant ', 20).includes('Komendant'));
  });

  it('tolerates a leading space and a double space in the middle', () => {
    assert.ok(excerptAround(text, '  Komendant', 20).includes('Komendant'));
    assert.ok(excerptAround(text, 'na  broń', 30).includes('broń'));
  });

  it('the excerpt contains the whole phrase, even when there’s no space after it', () => {
    // The end of the excerpt used to fall back to the last space after the match, and for
    // a long word with no space, that space was one INSIDE the phrase — „broni palnej" was
    // left as just „broni".
    const long =
      'W sprawie broni palnej-krotkiej-bocznego-zaplonu-o-lufie-gwintowanej-dlugosci-do-30-cm';
    const excerpt = excerptAround(long, 'broni palnej');

    assert.ok(excerpt.includes('broni palnej'), excerpt);
  });

  it('marks an excerpt with no match with an ellipsis', () => {
    // This is what a lesson found only by its title looks like. Without the ellipsis, the
    // excerpt read like a paragraph cut off mid-sentence.
    assert.ok(excerptAround(text, 'czegotutajniema', 20).endsWith('…'));
  });

  it('doesn’t append an ellipsis when it shows the whole text', () => {
    assert.ok(!excerptAround('Krótkie zdanie.', 'czegotutajniema', 60).endsWith('…'));
  });
});

describe('searchQuestions', () => {
  it('finds by the question’s text', () => {
    const hits = searchQuestions(QUESTIONS, 'pozwolenie');

    assert.equal(hits.length, 1);
    assert.equal(hits[0].question.id, 'q1');
  });

  it('finds by an answer’s text', () => {
    const hits = searchQuestions(QUESTIONS, 'Komendant');

    assert.equal(hits[0].question.id, 'q1');
  });

  it('finds by the legal basis', () => {
    const hits = searchQuestions(QUESTIONS, 'art. 25');

    assert.equal(hits.length, 1);
    assert.equal(hits[0].question.id, 'q3');
  });

  it('ignores diacritics', () => {
    const hits = searchQuestions(QUESTIONS, 'bron');

    assert.equal(hits.length, 1);
    assert.equal(hits[0].question.id, 'q1');
  });

  it('doesn’t match inside a word', () => {
    // "bron" (gun) must not pull in a question about "obronę koniecznej" (necessary
    // self-defence) — with 656 questions, matches like that buried the real results.
    const hits = searchQuestions(QUESTIONS, 'bron');

    assert.ok(!hits.some((hit) => hit.question.id === 'q3'));
  });

  it('catches an inflected form, since the phrase is a word’s prefix', () => {
    assert.equal(searchQuestions(QUESTIONS, 'pozwol').length, 1);
  });

  it('rejects a query that’s too short', () => {
    assert.deepEqual(searchQuestions(QUESTIONS, 'br'), []);
  });

  it('takes the excerpt from the question when the phrase occurs there', () => {
    const hits = searchQuestions(QUESTIONS, 'pozwolenie');

    assert.ok(hits[0].excerpt.includes('pozwolenie'));
  });

  it('returns nothing for a phrase that doesn’t occur', () => {
    assert.deepEqual(searchQuestions(QUESTIONS, 'czolg'), []);
  });
});

describe('searchLessons', () => {
  it('finds by the lesson’s content', () => {
    const hits = searchLessons(LESSONS, 'Policja');

    assert.equal(hits.length, 1);
    assert.equal(hits[0].lesson.slug, 'uobia');
  });

  it('finds by the lesson’s title', () => {
    const hits = searchLessons(LESSONS, 'Amunicji');

    assert.equal(hits[0].lesson.slug, 'uobia');
  });

  it('counts occurrences and sorts by them', () => {
    const many = lesson('x', 'X', '<p>broń broń broń</p>');
    const hits = searchLessons([...LESSONS, many], 'bron');

    assert.equal(hits[0].lesson.slug, 'x');
    assert.equal(hits[0].count, 3);
  });

  it('doesn’t return markup inside the excerpt', () => {
    const hits = searchLessons(LESSONS, 'broni');

    assert.ok(!hits[0].excerpt.includes('<'));
  });

  it('returns a lesson matched only by its title with a zero count', () => {
    // The card used to say „0 trafień · Otwórz i przejdź po trafieniach →", while the lesson
    // showed „brak trafień". Zero is the right answer here — it's the screen that decides
    // what to do with it.
    const hits = searchLessons([lesson('x', 'Przepisy sportowe', '<p>Nic o tym.</p>')], 'przepisy');

    assert.equal(hits.length, 1);
    assert.equal(hits[0].count, 0);
  });
});

/**
 * The hit counter on the results card and the highlighting inside the lesson are two paths
 * over the same content. They used to be tested separately, both passed, and **they drifted
 * apart in actual use**: the card promised a match, the lesson said „brak trafień". These
 * tests tie them together.
 */
describe('hit counter versus highlighting', () => {
  /**
   * An independent recomputation of what the script can actually highlight: content split
   * by markup, matches counted separately in each chunk — that's how the TreeWalker in
   * `findHelpersScript` works, with the same skip over the insides of `<script>` and
   * `<style>` as its `acceptNode`.
   */
  function highlightableByHand(html: string, query: string): number {
    const needle = normalize(query);
    return html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .split(/<[^>]+>/g)
      .reduce((sum, node) => sum + countHighlights([fold(node)], needle), 0);
  }

  it('the script searches inside a single node — that’s where the counter’s limit comes from', () => {
    assert.match(findHelpersScript(), /positions\(fold\(node\.data\), needle\)/);
  });

  it('doesn’t count a phrase that crosses a markup boundary', () => {
    // An example from the bundle: „patentowy PZSS" sits in the content as
    // „patentowy <abbr>PZSS</abbr>". The flattened text produced 1 match, but the lesson
    // couldn't highlight any of it.
    const hits = searchLessons(
      [lesson('x', 'X', '<p>Egzamin patentowy <abbr>PZSS</abbr> zdaje się raz.</p>')],
      'patentowy PZSS',
    );

    assert.equal(hits.length, 1, 'the lesson stays on the list — the phrase is in it');
    assert.equal(hits[0].count, 0, 'but there is nothing to highlight');
  });

  it('doesn’t count a phrase split by a line break', () => {
    const hits = searchLessons([lesson('x', 'X', '<p>prawa jazdy.\n  Caly proces</p>')], 'jazdy caly');

    assert.equal(hits[0]?.count ?? 0, 0);
  });

  it('agrees with an independent recount for every markup layout', () => {
    const cases: [string, string][] = [
      ['<p>broń broń broń</p>', 'bron'],
      ['<p>patentowy <abbr>PZSS</abbr></p>', 'patentowy pzss'],
      ['<p>patentowy <abbr>PZSS</abbr></p>', 'pzss'],
      ['<p>Broń palna</p><p>broń palna</p>', 'bron palna'],
      ['<p>obrona konieczna</p>', 'bron'],
      ['<p>tekst</p><script>var bron = 1;</script>', 'bron'],
      ['<li>- broń</li><li>- broń krótka</li>', 'bron'],
      ['<p>bron\n  palna</p>', 'bron palna'],
    ];

    for (const [html, query] of cases) {
      const hits = searchLessons([lesson('x', 'Bez tytułu', html)], query);
      const count = hits.length > 0 ? hits[0].count : 0;

      assert.equal(count, highlightableByHand(html, query), `${html} :: ${query}`);
    }
  });

  it('the counter never promises more than is in the flattened text', () => {
    for (const html of ['<p>broń <b>palna</b> i broń palna</p>', '<p>a<i>b</i>c</p>']) {
      const hits = searchLessons([lesson('x', 'X', html)], 'bron palna');
      const flat = countHighlights([fold(stripHtml(html))], 'bron palna');

      assert.ok((hits[0]?.count ?? 0) <= flat);
    }
  });
});

describe('search', () => {
  it('merges results from both sources', () => {
    const results = search(LESSONS, QUESTIONS, 'bron');

    assert.ok(results.lessons.length > 0);
    assert.ok(results.questions.length > 0);
    assert.equal(results.tooShort, false);
  });

  it('flags a query that’s too short', () => {
    const results = search(LESSONS, QUESTIONS, 'br');

    assert.equal(results.tooShort, true);
    assert.deepEqual(results.questions, []);
  });

  it('doesn’t flag an empty query as too short', () => {
    assert.equal(search(LESSONS, QUESTIONS, '   ').tooShort, false);
  });

  it('caps the number of questions at the limit', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      question(`m${i}`, 'pytanie o broń palną', ['a', 'b', 'c']),
    );

    assert.equal(search(LESSONS, many, 'bron', 25).questions.length, 25);
  });

  it('reports the full count of matching questions, not the truncated list’s length', () => {
    // Without this, the screen said „60 w pytaniach" (60 among questions) even with 458
    // matches, with no sign that anything had been truncated.
    const many = Array.from({ length: 200 }, (_, i) =>
      question(`m${i}`, 'pytanie o broń palną', ['a', 'b', 'c']),
    );

    assert.equal(search(LESSONS, many, 'bron', 25).questionTotal, 200);
  });

  it('reports no questions for a too-short query', () => {
    assert.equal(search(LESSONS, QUESTIONS, 'br').questionTotal, 0);
  });

  it('the minimum query length is sensible', () => {
    assert.ok(MIN_QUERY_LENGTH >= 2);
  });
});

describe('markedExcerptAt', () => {
  const text = 'Pierwsze zdanie o niczym. Pozwolenie na broń wydaje Komendant. Trzecie zdanie.';

  it('the mark points at the phrase inside the excerpt, past the leading ellipsis', () => {
    const at = text.indexOf('Komendant');
    const { text: excerpt, mark } = markedExcerptAt(text, at, 'Komendant'.length, 15);

    assert.ok(excerpt.startsWith('…'), excerpt);
    assert.ok(mark, 'no mark');
    assert.equal(excerpt.slice(mark[0], mark[1]), 'Komendant');
  });

  it('a match at the very start is marked from zero', () => {
    const { text: excerpt, mark } = markedExcerptAt(text, 0, 'Pierwsze'.length, 20);

    assert.deepEqual(mark, [0, 'Pierwsze'.length]);
    assert.equal(excerpt.slice(0, 'Pierwsze'.length), 'Pierwsze');
  });

  it('no match means no mark', () => {
    assert.equal(markedExcerptAt(text, -1, 5, 20).mark, null);
  });
});

describe('the mark on a hit', () => {
  it('a question hit marks the phrase as it stands in the question, not as typed', () => {
    const [hit] = searchQuestions(QUESTIONS, 'komendant');

    assert.ok(hit.mark, 'no mark');
    assert.equal(hit.excerpt.slice(hit.mark[0], hit.mark[1]), 'Komendant');
  });

  it('a question hit also marks the phrase inside the question text itself', () => {
    const [hit] = searchQuestions(QUESTIONS, 'pozwolenie');

    assert.ok(hit.questionMark, 'no mark in the question');
    assert.equal(
      hit.question.question.slice(hit.questionMark[0], hit.questionMark[1]),
      'pozwolenie',
    );
  });

  it('a phrase found in the correct answer is marked there, not in the question', () => {
    const [hit] = searchQuestions(QUESTIONS, 'komendant');

    assert.equal(hit.questionMark, null);
    assert.ok(hit.answerMark, 'no mark in the answer');
    const answer = hit.question.answers[hit.question.correct] ?? '';
    assert.equal(answer.slice(hit.answerMark[0], hit.answerMark[1]), 'Komendant');
  });

  it('a lesson hit marks the phrase with its diacritics', () => {
    const hit = searchLessons(LESSONS, 'bron').find((h) => h.lesson.slug === 'uobia');

    assert.ok(hit?.mark, 'no mark');
    assert.equal(hit.excerpt.slice(hit.mark[0], hit.mark[1]), 'broń');
  });

  it('a lesson found only by its title has no mark', () => {
    const hit = searchLessons(LESSONS, 'amunicji').find((h) => h.lesson.slug === 'uobia');

    assert.ok(hit, 'no hit');
    assert.equal(hit.mark, null);
  });
});

