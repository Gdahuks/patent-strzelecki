import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  type Act,
  driftCount,
  externalActs,
  isReadable,
  needsSourceList,
  resolveLaw,
  sourceDocuments,
  sourceLabels,
  sourceName,
} from './acts';

function act(partial: Partial<Act> & Pick<Act, 'slug' | 'lawPrefix'>): Act {
  return {
    short: partial.slug,
    eli: 'DU/1999/549',
    title: 'Tytuł',
    status: 'obowiązujący',
    changed: '2026-06-03',
    html: '<p>treść</p>',
    index: [],
    lawNames: [],
    lawDefault: false,
    ...partial,
  } as Act;
}

const ACTS: Act[] = [
  act({
    slug: 'uobia',
    lawPrefix: 'UoBiA',
    lawDefault: true,
    index: [
      { ref: 'arti_15', title: 'Art. 15.', kind: 'arti', hint: 'treść' },
      { ref: 'arti_23', title: 'Art. 23.', kind: 'arti', hint: 'treść' },
      { ref: 'arti_51', title: 'Art. 51.', kind: 'arti', hint: 'treść' },
    ],
  }),
  act({
    slug: 'kodeks-karny',
    lawPrefix: 'KK',
    index: [{ ref: 'arti_263', title: 'Art. 263.', kind: 'arti', hint: 'treść' }],
  }),
  act({
    slug: 'noszenie',
    lawPrefix: 'Rozporządzenie w sprawie noszenia i przechowywania broni',
    lawNames: ['rozporządzeni przechowywan'],
    index: [
      { ref: 'para_5', title: '§ 5.', kind: 'para', hint: 'treść' },
      { ref: 'para_8', title: '§ 8.', kind: 'para', hint: 'treść' },
    ],
  }),
  act({
    slug: 'przewozenie',
    lawPrefix: 'Rozporządzenie ws przewożenia broni i amunicji środkami transportu publicznego',
    lawNames: ['rozporządzeni przewoż'],
    html: '',
  }),
  act({
    slug: 'strzelnice',
    lawPrefix: 'Wzorcowy regulamin strzelnic',
    lawNames: ['regulamin strzelnic'],
    html: '',
  }),
];

describe('resolveLaw', () => {
  it('hits an article of the act', () => {
    assert.deepEqual(resolveLaw('UoBiA - Art. 15 ust. 2', ACTS), {
      slug: 'uobia',
      ref: 'arti_15',
      readable: true,
    });
  });

  it("hits a code's article when a paragraph is also written", () => {
    // "KK - Art. 263, § 2" — the article number takes precedence over the paragraph.
    assert.equal(resolveLaw('KK - Art. 263, § 2', ACTS)?.ref, 'arti_263');
  });

  it('hits a paragraph of a regulation', () => {
    assert.equal(
      resolveLaw('Rozporządzenie w sprawie noszenia i przechowywania broni § 5', ACTS)?.ref,
      'para_5',
    );
  });

  it('picks the act by the longest matching name', () => {
    // A shorter name must not win over a longer one, or it would match the wrong act.
    assert.equal(
      resolveLaw('Rozporządzenie w sprawie noszenia i przechowywania broni -', ACTS)?.slug,
      'noszenie',
    );
  });

  it("finds the document's name in the middle of the basis", () => {
    // The course also writes a basis starting from the unit: „§8 ust. 1 rozporządzenia w
    // sprawie…". The name then comes after the number, not before it.
    assert.deepEqual(
      resolveLaw(
        '§8 ust. 1 rozporządzenia w sprawie przechowywania, noszenia oraz ' +
          'ewidencjonowania broni i amunicji',
        ACTS,
      ),
      { slug: 'noszenie', ref: 'para_8', readable: true },
    );
  });

  it('tolerates grammatical case and words inserted into the middle of a name', () => {
    assert.equal(
      resolveLaw(
        'Rozdział 1 ust. 2 wzorcowego regulaminu bezpiecznego funkcjonowania strzelnic',
        ACTS,
      )?.slug,
      'strzelnice',
    );
  });

  it('tolerates „ws" instead of „w sprawie"', () => {
    assert.equal(
      resolveLaw(
        '§2 ust. 1 rozporządzenia w sprawie przewożenia broni i amunicji środkami ' +
          'transportu publicznego',
        ACTS,
      )?.slug,
      'przewozenie',
    );
  });

  it('does not confuse storage with transportation', () => {
    // Matching in the middle of the string is looser, so this is the pair sharing the most
    // words: both are regulations „w sprawie … broni i amunicji".
    assert.equal(resolveLaw('Rozporządzenie w sprawie przechowywania - § 6', ACTS)?.slug,
      'noszenie');
    assert.equal(
      resolveLaw('Rozporządzenie w sprawie przewożenia broni i amunicji - § 2', ACTS)?.slug,
      'przewozenie',
    );
  });

  it("a basis naming only the article belongs to the course's act", () => {
    // „art. 23 ust. 1" with no document name — the bundle has one such question, about
    // deposit costs, and art. 23 ust. 1 of UoBiA says exactly that.
    assert.deepEqual(resolveLaw('art. 23 ust. 1', ACTS), {
      slug: 'uobia',
      ref: 'arti_23',
      readable: true,
    });
  });

  it('a bare paragraph with no document name is left without a target', () => {
    // A paragraph would belong to a regulation, and the course cites several of those —
    // there's nothing to decide which one with.
    assert.equal(resolveLaw('§ 8 ust. 1', ACTS), null);
  });

  it('does not mistake part of a name for a unit', () => {
    // „Rozdział 1 ust. 2" without the rest of the name would belong to the firing-range
    // regulations, but it doesn't say so itself — guessing from the bare „rozdział" alone
    // would be wrong.
    assert.equal(resolveLaw('Rozdział 1 ust. 2', ACTS), null);
  });

  it('opens the act itself when no unit is given', () => {
    assert.equal(resolveLaw('UoBiA', ACTS)?.ref, null);
  });

  it('skips a unit that is not in the index', () => {
    // A link leading nowhere would be worse than no link at all.
    assert.equal(resolveLaw('UoBiA - Art. 999', ACTS)?.ref, null);
  });

  it('flags an act available only in the Sejm registry', () => {
    assert.equal(resolveLaw('Wzorcowy regulamin strzelnic - rozdz. 3', ACTS)?.readable, false);
  });

  it('does not guess at an unknown basis', () => {
    assert.equal(resolveLaw('Ogólne przepisy techniczne ISSF 6.7.4.2', ACTS), null);
    assert.equal(resolveLaw('', ACTS), null);
    assert.equal(resolveLaw('   ', ACTS), null);
  });

  it('tolerates missing punctuation and mixed case', () => {
    assert.equal(resolveLaw('uobia art 51 ust. 3', ACTS)?.ref, 'arti_51');
  });
});

describe('absorbed entries and drift', () => {
  it('a list of entries instead of a warning when there is no drift', () => {
    const akt = act({
      slug: 'kodeks-karny',
      lawPrefix: 'KK',
      sources: ['DU/2025/383', 'DU/2026/988'],
      amendments: [],
    });

    assert.equal(driftCount(akt), 0);
    assert.deepEqual(sourceLabels(akt), ['Dz.U. 2025 poz. 383', 'Dz.U. 2026 poz. 988']);
  });

  it('drift is the amendments the shown text has not absorbed', () => {
    // For an act with text, `amendments` means „what this wording doesn't have", not
    // „the full set of amendments" — that's what the red line in the act list rests on.
    const akt = act({
      slug: 'uobia',
      lawPrefix: 'UoBiA',
      sources: ['DU/2024/485'],
      amendments: [{ eli: 'DU/2026/187', url: '', date: '2028-05-19' }],
    });

    assert.equal(driftCount(akt), 1);
  });

  it("a bundle with no entry list doesn't crash the screen", () => {
    // Items available only as scans have no absorbed entries, and an older bundle on the
    // phone doesn't have this field at all.
    const skan = act({ slug: 'przewozenie', lawPrefix: 'Przewożenie', html: '' });

    assert.deepEqual(sourceLabels(skan), []);
    assert.equal(driftCount(skan), 0);
  });

  it('does not invent entries in an unknown notation', () => {
    const dziwny = act({ slug: 'x', lawPrefix: 'X', sources: ['ISAP/WDU20240000485'] });

    assert.deepEqual(sourceLabels(dziwny), ['ISAP/WDU20240000485']);
  });
});

describe('isReadable', () => {
  it('recognises an act with no text', () => {
    assert.equal(isReadable(ACTS[0]), true);
    assert.equal(isReadable(ACTS[4]), false);
  });
});

describe('externalActs', () => {
  const issf = 'https://www.pzss.org.pl/sedziowie/przepisy-issf-i-interpretacje';
  const LISTA: Act[] = [
    ...ACTS,
    act({ slug: 'przepisy-issf', lawPrefix: 'Skrócone dane', html: '', url: issf }),
    act({ slug: 'przepisy-issf-techniczne', lawPrefix: 'Ogólne przepisy', html: '', url: issf }),
  ];

  it('skips acts whose text is in the app', () => {
    assert.deepEqual(
      externalActs(LISTA).map((a) => a.slug),
      ['przewozenie', 'strzelnice', 'przepisy-issf'],
    );
  });

  it('shows one entry per document, not per legal basis', () => {
    // Two entries under one address are one document that the course cites under two
    // names. The second card would open exactly the same page.
    const pod_adresem = externalActs(LISTA).filter((a) => a.url === issf);

    assert.equal(pod_adresem.length, 1);
  });

  it('does not merge entries with no address', () => {
    // Emptiness isn't a shared document — merging on it would swallow unrelated entries.
    // `strzelnice` in `ACTS` has no address and must stay next to the other one like it.
    const bez_adresu: Act[] = [
      act({ slug: 'a', lawPrefix: 'A', html: '', url: '' }),
      act({ slug: 'b', lawPrefix: 'B', html: '', url: '' }),
    ];

    assert.equal(externalActs(bez_adresu).length, 2);
  });
});

describe('sourceDocuments', () => {
  const skan = act({
    slug: 'strzelnice',
    lawPrefix: 'Wzorcowy regulamin strzelnic',
    html: '',
    url: 'https://api.sejm.gov.pl/eli/acts/DU/2000/234/text.pdf',
    amendments: [
      { eli: 'DU/2000/618', url: 'https://…/618.pdf', date: '2000-07-20' },
      { eli: 'DU/2004/1609', url: 'https://…/1609.pdf', date: '2004-07-15' },
    ],
  });

  const issf = act({
    slug: 'przepisy-issf',
    lawPrefix: 'Skrócone dane regulaminowych ograniczeń broni',
    html: '',
    url: 'https://www.pzss.org.pl/sedziowie/przepisy-issf-i-interpretacje',
    documents: [
      { label: 'Rule Book 2026', url: 'https://…/rule-book.pdf' },
      { label: 'Pistolet (8)', url: 'https://…/8_issf_pistol.pdf' },
    ],
  });

  it("builds the scan's list from the base act and its amendments", () => {
    // A single link would show the original wording and stay silent about the changes.
    assert.deepEqual(
      sourceDocuments(skan).map((document) => document.label),
      ['Akt bazowy', '1. nowelizacja · od 2000-07-20', '2. nowelizacja · od 2004-07-15'],
    );
  });

  it('takes the list from the bundle when the entry carries one', () => {
    // ISSF rules are separate chapters with no "base and amending" relationship between
    // them, so we don't tack the list's address on as the first entry.
    assert.deepEqual(
      sourceDocuments(issf).map((document) => document.label),
      ['Rule Book 2026', 'Pistolet (8)'],
    );
  });

  it('keeps the order and names from the source', () => {
    // „Pobierz" or „1. dokument" would mean opening every file in turn just to find the
    // chapter about the pistol.
    assert.deepEqual(sourceDocuments(issf)[1], {
      label: 'Pistolet (8)',
      url: 'https://…/8_issf_pistol.pdf',
    });
  });
});

describe('needsSourceList', () => {
  it('a document list from the bundle requires a chooser screen', () => {
    const issf = act({
      slug: 'przepisy-issf',
      lawPrefix: 'Skrócone dane',
      html: '',
      url: 'https://www.pzss.org.pl/sedziowie/przepisy-issf-i-interpretacje',
      documents: [
        { label: 'Rule Book 2026', url: 'https://…/rule-book.pdf' },
        { label: 'Pistolet (8)', url: 'https://…/8_issf_pistol.pdf' },
      ],
    });

    assert.equal(needsSourceList(issf), true);
  });

  it('an empty document list opens the link itself', () => {
    // This is what a bundle looks like after a failed read of the PZSS page: the list's
    // address remains, and a screen with one entry would just be a page on the way to the
    // same place.
    const zejscie = act({
      slug: 'przepisy-issf',
      lawPrefix: 'Skrócone dane',
      html: '',
      url: 'https://www.pzss.org.pl/sedziowie/przepisy-issf-i-interpretacje',
      documents: [],
    });

    assert.equal(needsSourceList(zejscie), false);
  });

  it("a scan with no amendments doesn't need the screen, one with changes does", () => {
    const url = 'https://api.sejm.gov.pl/eli/acts/DU/2004/1609/text.pdf';
    const bez = act({ slug: 'deponowanie', lawPrefix: 'D', html: '', url, amendments: [] });
    const ze = act({
      slug: 'deponowanie',
      lawPrefix: 'D',
      html: '',
      url,
      amendments: [{ eli: 'DU/2010/1', url: 'https://…/1.pdf', date: '2010-01-01' }],
    });

    assert.equal(needsSourceList(bez), false);
    assert.equal(needsSourceList(ze), true);
  });

  it('an act with text never goes to the document list', () => {
    assert.equal(needsSourceList(ACTS[0]), false);
  });
});

describe('sourceName', () => {
  const issf = act({
    slug: 'przepisy-issf',
    short: 'Przepisy ISSF',
    lawPrefix: 'Skrócone dane regulaminowych ograniczeń broni',
    lawNames: ['ogólne przepisy techniczne issf'],
    html: '',
  });

  it('names the target when the basis names it in its own words', () => {
    // The reported case: the label promises a document that isn't visible after tapping.
    // „Skrócone dane…" is a name the course made up for its own summary, and what opens is
    // the „Przepisy ISSF" card.
    assert.equal(sourceName('Skrócone dane regulaminowych ograniczeń broni', issf), 'Przepisy ISSF');
  });

  it("stays silent when the basis already carries the target's name", () => {
    // It would read „Ogólne przepisy techniczne ISSF 6.7.4.2 · Przepisy ISSF ↗" — pure noise.
    assert.equal(sourceName('Ogólne przepisy techniczne ISSF 6.7.4.2', issf), null);
  });

  it('stays silent when even a single word is shared', () => {
    // The course says „Ogólne zasady bezpieczeństwa w strzelectwie", the card is named
    // „Zasady bezpieczeństwa PZSS" — the shared „zasady" is enough for the target to be
    // recognisable.
    const zasady = act({
      slug: 'zasady-bezpieczenstwa',
      short: 'Zasady bezpieczeństwa PZSS',
      lawPrefix: 'Ogólne zasady bezpieczeństwa w strzelectwie',
      html: '',
    });

    assert.equal(sourceName('Ogólne zasady bezpieczeństwa w strzelectwie §3 pkt 7', zasady), null);
  });

  it("tolerates the name's grammatical case", () => {
    // „wzorcowego regulaminu … strzelnic" versus „Wzorcowy regulamin strzelnic" — the same
    // stems as in act matching, so the target's name would just be a repeat.
    const strzelnice = act({
      slug: 'strzelnice',
      short: 'Wzorcowy regulamin strzelnic',
      lawPrefix: 'Wzorcowy regulamin strzelnic',
      html: '',
    });

    assert.equal(
      sourceName('Rozdział 1 ust. 2 wzorcowego regulaminu bezpiecznego funkcjonowania strzelnic', strzelnice),
      null,
    );
  });

  it('does not count a conjunction or a unit marker as a shared word', () => {
    // „w" and „ust." would match the start of almost anything, since matching goes by
    // stem — „ust." sits at the start of the word „ustawa".
    const ustawa = act({ slug: 'inna', short: 'Ustawa w sprawie czegoś', lawPrefix: 'X', html: '' });

    assert.equal(sourceName('X - § 2 ust. 1', ustawa), 'Ustawa w sprawie czegoś');
  });
});
