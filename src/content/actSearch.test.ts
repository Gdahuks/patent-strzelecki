import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, vi } from 'vitest';

import { actText, searchActs } from './actSearch';
import type { Act } from './acts';
import { findHelpersScript } from './findInPage';
import { countHighlights, fold, normalize, stripHtml } from './search';

const STATUTE: Act = {
  slug: 'uobia',
  short: 'UoBiA',
  lawPrefix: 'UoBiA',
  lawNames: [],
  lawDefault: true,
  eli: 'DU/1999/549',
  title: 'Ustawa o broni i amunicji',
  status: 'obowiązujący',
  changed: '2024-01-01',
  url: '',
  sources: ['DU/2024/485'],
  amendments: [],
  documents: [],
  html: [
    '<h2>Ustawa o broni i amunicji</h2>',
    '<div class="unit unit_arti" data-id="arti_10"><h3>Art. 10.</h3>',
    '<p>Pozwolenie na broń wydaje komendant wojewódzki Policji.</p></div>',
    '<div class="unit unit_arti" data-id="arti_11"><h3>Art. 11.</h3>',
    '<p>Magazynek nabojowy do broni palnej.</p></div>',
  ].join(''),
  index: [
    { ref: 'arti_10', title: 'Art. 10.', kind: 'arti', hint: 'Pozwolenie na broń' },
    { ref: 'arti_11', title: 'Art. 11.', kind: 'arti', hint: 'Magazynek nabojowy' },
  ],
};

const CODE: Act = {
  ...STATUTE,
  slug: 'kk',
  short: 'KK',
  title: 'Kodeks karny',
  html: '<h2>Kodeks karny</h2><p>Kto bez wymaganego pozwolenia posiada broń palną.</p>',
  index: [],
};

const NO_TEXT: Act = { ...STATUTE, slug: 'przewozenie', html: '', index: [] };

describe('searchActs', () => {
  it('gives one entry per act, not per article', () => {
    const hits = searchActs([STATUTE], 'broni');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].act.slug, 'uobia');
  });

  it('counts every hit within the act', () => {
    // The title and art. 11. Art. 10 has „broń" — a different form — so it doesn't count.
    assert.equal(searchActs([STATUTE], 'broni')[0].count, 2);
  });

  it('skips acts with no hits and acts with no text', () => {
    const hits = searchActs([STATUTE, CODE, NO_TEXT], 'magazynek');
    assert.deepEqual(
      hits.map((hit) => hit.act.slug),
      ['uobia'],
    );
  });

  it("returns nothing for an act we don't have in text form", () => {
    assert.deepEqual(searchActs([NO_TEXT], 'broni'), []);
  });

  it('keeps the bundle order, does not sort by hit count', () => {
    const hits = searchActs([STATUTE, CODE], 'pozwolenia');
    assert.deepEqual(
      hits.map((hit) => hit.act.slug),
      ['kk'],
    );
    const both = searchActs([STATUTE, CODE], 'pozwolen');
    assert.deepEqual(
      both.map((hit) => hit.act.slug),
      ['uobia', 'kk'],
    );
  });

  it('matches from the start of a word, same as the rest of search', () => {
    // „bron" catches „broni" and „bronią", but not „obrona" in the middle of a word.
    const defence: Act = { ...STATUTE, html: '<p>Konieczna obrona.</p>', index: [] };
    assert.deepEqual(searchActs([defence], 'bron'), []);
  });

  it('does not search for a short phrase', () => {
    assert.deepEqual(searchActs([STATUTE], 'br'), []);
  });

  it('gives an excerpt around the first hit, with no markup', () => {
    const [hit] = searchActs([STATUTE], 'komendant');
    assert.match(hit.excerpt, /Pozwolenie na broń wydaje komendant/);
    assert.doesNotMatch(hit.excerpt, /unit_|class=|data-id|</);
  });
});

describe("provisions' wordings", () => {
  /**
   * Dates deliberately far off in both directions: `actText` asks about today's date, so a
   * near date would give a test that silently changes meaning as the calendar moves on.
   */
  function withChange(od: string): Act {
    return {
      ...STATUTE,
      slug: `wersje-${od}`,
      html:
        '<div class="pro-text">' +
        `<span class="wersja wersja-do" data-od="${od}" data-poz="0">konewka ogrodowa</span>` +
        `<span class="wersja wersja-od" data-od="${od}" data-poz="0">parasol plażowy</span>` +
        '</div>',
      index: [],
    };
  }

  it('does not count hits in a wording not yet in force', () => {
    // If only the act screen did this transformation, the results card would promise a
    // hit in text the user won't actually see after opening it.
    const act = withChange('2099-01-01');

    assert.equal(searchActs([act], 'konewka')[0].count, 1);
    assert.deepEqual(searchActs([act], 'parasol'), []);
  });

  it('counts hits in a wording that has already come into force', () => {
    const act = withChange('2020-01-01');

    assert.equal(searchActs([act], 'parasol')[0].count, 1);
    assert.deepEqual(searchActs([act], 'konewka'), []);
  });

  it('the excerpt on the card shows the wording that stands in the act', () => {
    const [hit] = searchActs([withChange('2099-01-01')], 'konewka');

    assert.match(hit.excerpt, /konewka ogrodowa/);
    assert.doesNotMatch(hit.excerpt, /parasol/);
  });

  it('after the midnight a provision comes into force, counts the new wording already', () => {
    // The act's text is memoized for the app's whole run, so without a day key, a phone
    // left open across that one day boundary would report a hit count on the results card
    // for a rendering the open act no longer shows — the screen recomputes the rendering
    // on every entry.
    const act = withChange('2026-08-23');
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 22, 23, 59));
      assert.equal(searchActs([act], 'konewka')[0].count, 1);
      assert.deepEqual(searchActs([act], 'parasol'), []);

      vi.setSystemTime(new Date(2026, 7, 23, 0, 1));
      assert.equal(searchActs([act], 'parasol')[0].count, 1);
      assert.deepEqual(searchActs([act], 'konewka'), []);
    } finally {
      vi.useRealTimers();
    }
  });

  it('assembles the text once within a calendar day', () => {
    // The other side of the same change: the key has to be a day, not a moment. Warming up
    // 700 KB on every keystroke was the reason this cache exists at all.
    const act = withChange('2099-01-01');
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 22, 8, 0));
      const first = actText(act);

      vi.setSystemTime(new Date(2026, 7, 22, 23, 30));
      assert.equal(actText(act), first, 'same day, same assembled text');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('date on a hit in a provision not yet in force', () => {
  /**
   * An ordinary, currently-effective article — the filler before the new provision is made
   * of these.
   */
  function article(num: number, content: string): string {
    return (
      `<div class="unit unit_arti" data-id="arti_${num}"><h3>Art. ${num}.</h3>` +
      `<div class="unit-inner"><div class="pro-text">${content}</div></div></div>`
    );
  }

  /**
   * A unit that's **added** and not yet in force, in the same layout as art. 255b of the
   * Kodeks karny: a lone `wersja-od` with no matching pair, so the text stays in the
   * document with a date marker instead of dropping into a tooltip. Currently-effective
   * provisions stand on both sides of it — one on each end, because the guard has to watch
   * **both** boundaries of the range.
   *
   * The filler in front of it isn't decoration. Ranges are offsets into the concatenated
   * text, and a space joins the nodes — an off-by-one mistake per node grows with the
   * distance from the start of the act. In the Kodeks karny, art. 255b is preceded by
   * 370 thousand characters, so without the filler, the test would pass on arithmetic that
   * points at a completely different fragment in the real bundle.
   */
  function withNewProvision(od: string): Act {
    const filler = Array.from({ length: 40 }, (_, i) =>
      article(i + 1, `Przepis porządkowy o kolejnym numerze ${i + 1}.`),
    ).join('');

    return {
      ...STATUTE,
      slug: `nowy-${od}`,
      html: [
        filler,
        '<div class="unit unit_arti" data-id="arti_41">',
        `<h3><span class="wersja wersja-od" data-od="${od}" data-poz="0">Art. 41.</span></h3>`,
        '<div class="unit-inner"><div class="pro-text">',
        `<span class="wersja wersja-od" data-od="${od}" data-poz="0">Kusza wymaga zezwolenia, a proca myśliwska nie.</span>`,
        '</div></div></div>',
        article(42, 'Latarka nie jest bronią.'),
      ].join(''),
      index: [],
    };
  }

  const ACT_WITH_NEW_PROVISION = withNewProvision('2099-01-01');

  it('carries the effective date', () => {
    // Without this, the results card reported a not-yet-binding provision exactly like a
    // binding one.
    assert.equal(searchActs([ACT_WITH_NEW_PROVISION], 'kusza')[0].future, '2099-01-01');
  });

  it('carries it also on a hit at the end of the provision', () => {
    // Both ends of the range, since they break independently: "kusza" is the first word,
    // "myśliwska" the second-to-last.
    assert.equal(searchActs([ACT_WITH_NEW_PROVISION], 'myśliwska')[0].future, '2099-01-01');
  });

  it('a provision in force carries no date — neither before the new one nor after it', () => {
    assert.equal(searchActs([ACT_WITH_NEW_PROVISION], 'porządkowy')[0].future, null);
    assert.equal(searchActs([ACT_WITH_NEW_PROVISION], 'latarka')[0].future, null);
  });

  it('once the change comes into force, the date disappears, since the provision is now binding', () => {
    assert.equal(searchActs([withNewProvision('2020-01-01')], 'kusza')[0].future, null);
  });
});

/**
 * The same thing against the real bundle — the only place in this file that looks at it.
 *
 * The fixture builds the markup layout from memory, while this test takes it from a file
 * that actually ships in the app: art. 255b of the Kodeks karny is a provision added by an
 * amendment and coming into force separately, with the neighbouring art. 255a already in
 * force. The test **skips itself** without the bundle — the whole `assets/content/`
 * directory is outside this repository, because it also carries the course's lesson and
 * question content, not because this particular act (public law text from the Sejm API,
 * not subject to copyright) is anyone's property, same as in `versions.package.test.ts`.
 */
const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), '../../assets/content/acts.json');
const PRESENT = existsSync(BUNDLE);

describe.skipIf(!PRESENT)('a provision in reserve, in the real bundle', () => {
  const PENAL_CODE = PRESENT
    ? (JSON.parse(readFileSync(BUNDLE, 'utf8')) as Act[]).filter(
        (act) => act.slug === 'kodeks-karny',
      )
    : [];

  /** Today's date in the bundle's notation, computed locally — the same way `versions` does. */
  function today(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  /** The effective date recorded next to the unit — read from the bundle, not from memory. */
  function unitDate(act: Act, ref: string): string | null {
    const start = act.html.indexOf(`data-id="${ref}"`);
    if (start < 0) return null;
    const end = act.html.indexOf('<div class="unit unit_arti"', start + 1);
    const fragment = act.html.slice(start, end < 0 ? undefined : end);
    return /class="wersja wersja-od" data-od="(\d{4}-\d{2}-\d{2})"/.exec(fragment)?.[1] ?? null;
  }

  it('a hit in art. 255b of the Kodeks karny carries the effective date', () => {
    const [kk] = PENAL_CODE;
    assert.ok(kk, 'the bundle has no Kodeks karny');

    // We take the date from the bundle instead of hardcoding it in the test: 23 August
    // 2026 will pass eventually, and then this same provision becomes law in force and the
    // card should stay silent about the date. The test should then still be checking the
    // same thing, not failing because of the calendar.
    const od = unitDate(kk, 'arti_255b');
    assert.ok(od, 'art. 255b is no longer a provision in the bundle with its own effective date');

    // "zwierzęcia" appears exactly once in the whole code, in point 2 of this article.
    const [hit] = searchActs([kk], 'zwierzęcia');
    assert.ok(hit, 'no hit in art. 255b');
    assert.match(hit.excerpt, /przemoc wobec zwierzęcia/);
    assert.equal(hit.future, od > today() ? od : null);
  });

  it('a hit in art. 255a — a provision in force — carries no date', () => {
    const [kk] = PENAL_CODE;
    assert.ok(kk, 'the bundle has no Kodeks karny');

    // "szkoleniu mogącym" first appears in § 2 of this article, i.e. right before 255b: if
    // the not-yet-in-force provision's range started even a sentence too early, a date
    // would show up here. The article itself carries no rendering marker at all.
    assert.equal(unitDate(kk, 'arti_255a'), null);

    const [hit] = searchActs([kk], 'szkoleniu mogącym');
    assert.ok(hit, 'no hit in art. 255a');
    assert.match(hit.excerpt, /uczestniczy w szkoleniu mogącym/);
    assert.equal(hit.future, null);
  });
});

describe('hit counter versus highlighting', () => {
  function act(html: string): Act {
    return { ...STATUTE, html, index: [] };
  }

  /**
   * An independent recount of what the script can highlight — the same measure used for
   * lessons: content split on markup, hits counted separately in each piece.
   */
  function highlightableByHand(html: string, query: string): number {
    const needle = normalize(query);
    return html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .split(/<[^>]+>/g)
      .reduce((sum, node) => sum + countHighlights([fold(node)], needle), 0);
  }

  it("the script searches inside a single node — hence the counter's limit", () => {
    assert.match(findHelpersScript(), /positions\(fold\(node\.data\), needle\)/);
  });

  it('does not count a phrase that crosses a markup tag', () => {
    // An example from the bundle: "tekst ustawy" appears in the act, but the registry
    // splits it with a markup tag. The concatenated text gave 1 hit, the open act said
    // "no hits".
    const hits = searchActs(
      [act('<p>Obwieszczenie w sprawie ogłoszenia jednolitego <b>tekstu</b> ustawy.</p>')],
      'tekstu ustawy',
    );

    assert.equal(hits.length, 1, 'the act stays on the list — the phrase is in it');
    assert.equal(hits[0].count, 0, 'but there is nothing to highlight');
    assert.match(hits[0].excerpt, /jednolitego tekstu ustawy/);
  });

  it('does not count a phrase split by a line break', () => {
    // The script sees the node's raw content, and the registry breaks lines mid-sentence.
    const hits = searchActs([act('<p>Pozwolenie na\n  broń palną.</p>')], 'na bron');

    assert.equal(hits[0]?.count ?? 0, 0);
  });

  it('agrees with an independent recount for every markup layout', () => {
    const cases: [string, string][] = [
      ['<p>broń broń broń</p>', 'bron'],
      ['<div class="unit unit_arti"><h3>Art. 10.</h3><p>Pozwolenie na broń.</p></div>', 'art 10'],
      ['<p>jednolitego <b>tekstu</b> ustawy</p>', 'tekstu ustawy'],
      ['<li>- broń palna</li><li>- broń krótka</li>', 'bron'],
      ['<p>konieczna obrona</p>', 'bron'],
      ['<p>tekst</p><script>var bron = 1;</script>', 'bron'],
      ['<p>pozwolenie na\n  broń</p>', 'na bron'],
      ['<span class="qmark-opn">„</span><span>broń palna</span>', 'bron palna'],
    ];

    for (const [html, query] of cases) {
      const hits = searchActs([act(html)], query);
      const count = hits.length > 0 ? hits[0].count : 0;

      assert.equal(count, highlightableByHand(html, query), `${html} :: ${query}`);
    }
  });

  it('the counter never promises more than is in the concatenated text', () => {
    for (const html of ['<p>broń <b>palna</b> i broń palna</p>', '<p>a<i>b</i>c</p>']) {
      const hits = searchActs([act(html)], 'bron palna');
      const flat = countHighlights([fold(stripHtml(html))], 'bron palna');

      assert.ok((hits[0]?.count ?? 0) <= flat);
    }
  });
});
