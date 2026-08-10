import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { stripHtml } from './search';
import {
  SHEET_THRESHOLD,
  applyVersions,
  changeLabel,
  dateLabel,
  lapseLabel,
  splitFuture,
  startLabel,
  unitLabel,
} from './versions';

/**
 * Dates are built with the local constructor, not from an ISO string: `new Date('2026-08-08')`
 * is midnight UTC, so west of Greenwich it would land on the previous day and the test would
 * say something different depending on the time zone. A provision's entry into force is a
 * calendar date, not an instant.
 */
const BEFORE = new Date(2026, 7, 8);
const AFTER = new Date(2028, 5, 1);

/**
 * The wording marker exactly as the scraper assembles it. `pos` is the Chancellery's
 * position number — pieces of one bracket carry the same one, two separate provisions carry
 * different ones, even if the same amendment changed them and even if they share a date.
 */
function wording(kind: 'do' | 'od', from: string, pos: number, content: string): string {
  return `<span class="wersja wersja-${kind}" data-od="${from}" data-poz="${pos}">${content}</span>`;
}

/** A pair of wordings for one point — the layout from art. 15c of the firearms act. */
const PAIR =
  '<div class="pro-text">' +
  wording('do', '2028-05-19', 0, '1) dyplom magistra psychologii;') +
  wording('od', '2028-05-19', 0, '1) prawo wykonywania zawodu;') +
  '</div>';

/**
 * A point with two wordings inside an article — the same layout from art. 15c of the
 * firearms act where a real user read the label backwards from what it actually says.
 */
const CHANGING_POINT =
  '<div class="unit unit_arti" data-id="arti_15c"><h3>Art. 15c.</h3><div class="unit-inner">' +
  '<div class="unit unit_pint" data-id="pint_1">' +
  `<h3>${wording('do', '2028-05-19', 0, '1)')}</h3><div class="unit-inner">` +
  `<div class="pro-text">${wording('do', '2028-05-19', 0, 'dyplom magistra psychologii,')}</div>` +
  '</div></div>' +
  '<div class="unit unit_pint" data-id="pint_1">' +
  `<h3>${wording('od', '2028-05-19', 0, '1)')}</h3><div class="unit-inner">` +
  `<div class="pro-text">${wording('od', '2028-05-19', 0, 'prawo wykonywania zawodu,')}</div>` +
  '</div></div>' +
  '<div class="unit unit_pint" data-id="pint_2"><h3>2)</h3>' +
  '<div class="unit-inner"><div class="pro-text">pięcioletni staż pracy,</div></div></div>' +
  '</div></div>';

/**
 * A provision repealed with no replacement: an unpaired "current" bracket.
 *
 * A **synthetic** case — today's bundle doesn't contain a single bracket like this. It shows
 * up the first time an amendment strikes something out without putting anything in its
 * place.
 */
const REPEALED =
  '<div class="unit unit_arti" data-id="arti_9"><h3>' +
  wording('do', '2028-05-19', 0, 'Art. 9.') +
  '</h3><div class="unit-inner"><div class="pro-text">' +
  wording('do', '2028-05-19', 0, 'Zezwolenie cofa się w całości.') +
  '</div></div></div>';

/** A unit added: just a future bracket, with no current counterpart. */
const ADDED =
  '<div class="unit unit_arti" data-id="arti_255b">' +
  `<h3>${wording('od', '2026-08-23', 0, 'Art. 255b.')}</h3>` +
  '<div class="unit-inner"><div class="pro-text">' +
  wording('od', '2026-08-23', 0, 'Kto czyni przygotowania.') +
  '</div></div></div>';

describe('applyVersions', () => {
  it('before the date, the text carries the previous wording', () => {
    const text = stripHtml(applyVersions(PAIR, BEFORE).html);

    assert.match(text, /dyplom magistra/);
    // The whole point of this design: the losing wording disappears from the tree, so
    // search won't count it, in-page search won't highlight it, and a jump to the unit
    // won't land on it.
    assert.doesNotMatch(text, /prawo wykonywania/);
  });

  it('after the date, the text carries the new wording, and the previous one is nowhere', () => {
    const result = applyVersions(PAIR, AFTER).html;

    assert.match(stripHtml(result), /prawo wykonywania zawodu/);
    // Not just out of the text — out of the attributes too: once the change takes effect,
    // the old wording isn't anything that's allowed to be linked to any more.
    assert.doesNotMatch(result, /dyplom magistra/);
    assert.doesNotMatch(result, /wersja-do|wersja-od/);
  });

  it('the future wording goes into an attribute, not a hidden element', () => {
    // `textNodes` cuts the string at markup and never sees attributes. A hidden element
    // would still count toward hits on the results card, would get a `mark` from in-page
    // search, and would block the arrow, since `scrollIntoView` does nothing on an element
    // with no layout box.
    const result = applyVersions(PAIR, BEFORE).html;

    assert.match(result, /data-przyszle="1\) prawo wykonywania zawodu;"/);
    assert.doesNotMatch(stripHtml(result), /prawo wykonywania/);
  });

  it('a short wording opens as a tooltip, the same one abbreviations and footnotes use', () => {
    const result = applyVersions(PAIR, BEFORE).html;

    assert.match(result, /class="skrot przyszle"/);
    assert.match(result, /data-def="1\) prawo wykonywania zawodu;"/);
    assert.match(result, /<sup>zmieni się 19 maja 2028<\/sup>/);
  });

  it('a long wording goes to the sheet, since it doesn’t fit in the tooltip', () => {
    // `.skrot-dymek` has neither `max-height` nor scrolling, and the content is inserted as
    // plain `textContent` — a long provision would run off the screen with no way to reach
    // it.
    const long = 'a'.repeat(SHEET_THRESHOLD + 1);
    const result = applyVersions(
      wording('do', '2028-05-19', 0, 'stare') + wording('od', '2028-05-19', 0, long),
      BEFORE,
    ).html;

    assert.match(result, /class="przyszle-arkusz"/);
    // The sheet handle must not match `abbr.skrot`, or `glossaryScript` would open a tooltip
    // over it with the whole provision inside.
    assert.doesNotMatch(result, /class="[^"]*skrot/);
    assert.doesNotMatch(result, /data-def=/);
  });

  it('a wording shorter than the threshold stays a tooltip', () => {
    const equal = 'a'.repeat(SHEET_THRESHOLD);
    const result = applyVersions(
      wording('do', '2028-05-19', 0, 'stare') + wording('od', '2028-05-19', 0, equal),
      BEFORE,
    ).html;

    assert.match(result, /class="skrot przyszle"/);
  });

  it('a wording spread across several units always goes to the sheet', () => {
    // A bracket that crosses a unit boundary comes out of the scraper as several markers —
    // it closes one at the end of a fragment and opens the next one in the following
    // fragment. The shortness of each one on its own means nothing: the tooltip would have
    // to hold the whole provision with its sub-points.
    const result = applyVersions(
      `<div class="pro-text">${wording('do', '2028-05-19', 0, 'stare')}</div>` +
        `<div class="pro-text">${wording('od', '2028-05-19', 0, '§ 1. Nowe.')}</div>` +
        `<div class="pro-text">${wording('od', '2028-05-19', 0, '§ 2. Dalej.')}</div>`,
      BEFORE,
    ).html;

    assert.match(result, /class="przyszle-arkusz"/);
    // One reference per block, not one per paragraph.
    assert.equal(result.match(/<abbr/g)?.length, 1);
    assert.match(result, /data-przyszle="§ 1\. Nowe\.&#10;§ 2\. Dalej\."/);
    assert.doesNotMatch(stripHtml(result), /Nowe|Dalej/);
  });

  it('the unit number sits in the same line as the content, just as in the act', () => {
    // The bracket covers the unit together with its number, and the number sits in the
    // heading — a line break right after „1)" would read in the sheet like a cut-off
    // provision.
    const result = applyVersions(
      `<div class="unit"><h3>${wording('do', '2028-05-19', 0, '1)')}</h3>` +
        `<div class="pro-text">${wording('do', '2028-05-19', 0, 'stare brzmienie')}</div></div>` +
        `<div class="unit"><h3>${wording('od', '2028-05-19', 0, '1)')}</h3>` +
        `<div class="pro-text">${wording('od', '2028-05-19', 0, 'nowe brzmienie')}</div></div>`,
      BEFORE,
    ).html;

    assert.match(result, /data-przyszle="1\) nowe brzmienie"/);
  });

  it('the label stands right after the content of the point it concerns', () => {
    // This is the actual fix. The new wording of point 1 sits in the consolidated text as
    // a separate unit under the same number, so a label placed where it stood used to land
    // on an empty line **between** point 1 and point 2 — reading like an announcement that
    // point 2 (or the whole article) would take effect on the given date.
    const text = stripHtml(applyVersions(CHANGING_POINT, BEFORE).html);

    assert.match(text, /dyplom magistra psychologii, zmieni się 19 maja 2028 2\) pięcioletni/);
  });

  it('the previous wording stays plain text, with no not-yet-binding mark', () => {
    // Dimming and italics are reserved for a provision that doesn't exist yet. Point 1 is
    // in force today, and weakening its appearance would be the other half of the same
    // mistake.
    const result = applyVersions(CHANGING_POINT, BEFORE).html;

    assert.doesNotMatch(result, /przyszle-tresc|przyszle-data/);
  });

  it('moving the label doesn’t leave an empty shell of the new wording', () => {
    // The bracket covers the unit together with its number, so a pair of wordings is two
    // units sharing one `data-id`. Since the whole new wording's content went into the
    // reference, the second one is empty — and `jumpTo` takes the first match, so an empty
    // shell has no business standing in front of the provision that's actually in force.
    const result = applyVersions(CHANGING_POINT, BEFORE).html;

    assert.equal(result.match(/data-id="pint_1"/g)?.length, 1);
  });

  it('a provision about to lapse says so in advance', () => {
    // Without this label, a provision being repealed six months from now looked on screen
    // exactly like any other — the only trace showed up on the day of repeal itself, as
    // „(uchylony)".
    const result = applyVersions(REPEALED, BEFORE).html;

    assert.match(stripHtml(result), /Zezwolenie cofa się w całości\. traci moc 19 maja 2028/);
    // Until that day it's law in force, so the text stays plain — dimming and italics are
    // reserved for a provision that doesn't exist yet.
    assert.doesNotMatch(result, /przyszle-tresc/);
  });

  it('the lapse label doesn’t pretend to be a handle, since there’s nothing to open', () => {
    // `reference` leads to the new wording; on a repeal with no replacement there is no
    // new wording, and a handle that opens onto emptiness when tapped reads like it's
    // broken. Hence a plain `sup` instead of an `abbr` with a button role.
    const result = applyVersions(REPEALED, BEFORE).html;

    assert.doesNotMatch(result, /<abbr|data-przyszle=|role="button"/);
    assert.match(result, /<sup class="przyszle-moc" data-od="2028-05-19">/);
  });

  it('after the lapse date, only „(uchylony)" remains, with no announcement', () => {
    // The other half of the same sentence: the announcement lives until its day, and then
    // its place is taken by the state it was announcing.
    const result = applyVersions(REPEALED, AFTER).html;

    assert.match(stripHtml(result), /Art\. 9\. \(uchylony\)/);
    assert.doesNotMatch(result, /traci moc|przyszle/);
  });

  it('an added article not yet in force stays in the text with a date', () => {
    // Hiding it would put the unit index out of sync with the text: `build_index` knows
    // about „Art. 255b.", so a jump from the index would land on nothing.
    const text = stripHtml(applyVersions(ADDED, BEFORE).html);

    assert.match(text, /Art\. 255b\./);
    assert.match(text, /Kto czyni przygotowania/);
    assert.match(text, /wejdzie w życie 23 sierpnia 2026/);
  });

  it('every part of a not-yet-binding provision carries a mark, not just the first', () => {
    // Distinguishing this from provisions in force can't rest on color alone — the same
    // rule as the verdict in the ABC quiz. The class is the hook for the font style, so it
    // has to cover the whole provision, not just the paragraph with the date.
    const result = applyVersions(ADDED, BEFORE).html;

    assert.equal(result.match(/class="przyszle-tresc"/g)?.length, 2);
    assert.equal(result.match(/przyszle-data/g)?.length, 1);
    // There's nothing to hide in an attribute — the provision stands right in the text.
    assert.doesNotMatch(result, /data-przyszle=/);
  });

  it('an article added after its entry-into-force date is a plain provision', () => {
    const result = applyVersions(ADDED, new Date(2026, 7, 23)).html;

    assert.match(stripHtml(result), /Art\. 255b\./);
    assert.doesNotMatch(result, /przyszle|wersja/);
  });

  it('doesn’t absorb a neighbouring position, even one with the same date', () => {
    // One amendment changes art. 5 and adds art. 5a — both changes take effect on the same
    // day, and between the end of one unit and the heading of the other there's nothing but
    // markers. Without the position stamp, art. 5a used to vanish from the text, its content
    // landing as the „new wording" of art. 5, and a jump from the index landed on an empty
    // shell.
    const result = applyVersions(
      '<div class="unit unit_arti" data-id="arti_5"><div class="pro-text">' +
        wording('do', '2028-05-19', 0, 'stare brzmienie art. 5') +
        wording('od', '2028-05-19', 0, 'nowe brzmienie art. 5') +
        '</div></div>' +
        '<div class="unit unit_arti" data-id="arti_5a">' +
        `<h3>${wording('od', '2028-05-19', 1, 'Art. 5a.')}</h3>` +
        `<div class="pro-text">${wording('od', '2028-05-19', 1, 'Kto narusza zakaz.')}</div>` +
        '</div>',
      BEFORE,
    ).html;
    const text = stripHtml(result);

    assert.match(text, /stare brzmienie art\. 5/);
    assert.match(text, /Art\. 5a\./);
    assert.match(text, /Kto narusza zakaz/);
    assert.doesNotMatch(result, /data-przyszle="[^"]*Art\. 5a/);
    assert.match(result, /data-przyszle="nowe brzmienie art\. 5"/);
  });

  it('a bundle without stamps shows both wordings, instead of guessing the pair', () => {
    // The bundle on the phone can be older than the code. The degradation is meant to be
    // visible, not to rely on guessing which wording replaces which.
    const noStamps =
      '<span class="wersja wersja-do" data-od="2028-05-19">stare</span>' +
      '<span class="wersja wersja-od" data-od="2028-05-19">nowe</span>';
    const text = stripHtml(applyVersions(noStamps, BEFORE).html);

    assert.match(text, /stare/);
    assert.match(text, /nowe/);
    // Without a pair, each wording is its own provision: the future one stands in the
    // text as a provision-in-waiting, so it carries the entry-into-force label, not a change
    // announcement.
    assert.match(text, /wejdzie w życie 19 maja 2028/);
  });

  it('doesn’t silently swallow a marker with a nested element', () => {
    // A non-greedy match would close on the inner `</span>`, and the tail of the future
    // wording would leak into the visible text **as law currently in force**.
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));

    const nested =
      '<span class="wersja wersja-do" data-od="2028-05-19" data-poz="0">stare</span>' +
      '<span class="wersja wersja-od" data-od="2028-05-19" data-poz="0">' +
      'nowe <span class="obce">wtrącenie</span> dalej</span>';
    const result = applyVersions(nested, BEFORE).html;
    console.warn = original;

    // Loudly, because a silent change in the marker's layout is the worst thing that could
    // happen here.
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /recognised 1 of 2/);
    // An unrecognised marker is left untouched: no tail leaks into the text as law in force,
    // and no orphaned `</span>` closes someone else's element.
    assert.match(result, /nowe <span class="obce">wtrącenie<\/span> dalej<\/span>/);
    assert.match(stripHtml(result), /stare/);
  });

  it('after a wording change, no empty unit with the same number remains', () => {
    // The bracket covers the unit together with its number, so a pair of wordings is two
    // units sharing one `data-id`. `jumpTo` takes the first one — a jump from a question's
    // legal basis would land on the shell, with the provision in force left below the fold.
    const result = applyVersions(
      '<div class="unit unit_pint" data-id="pint_1"><h3>' +
        wording('do', '2028-05-19', 0, '1)') +
        `</h3><div class="unit-inner"><div class="pro-text">${wording('do', '2028-05-19', 0, 'stare')}</div></div></div>` +
        '<div class="unit unit_pint" data-id="pint_1"><h3>' +
        wording('od', '2028-05-19', 0, '1)') +
        `</h3><div class="unit-inner"><div class="pro-text">${wording('od', '2028-05-19', 0, 'nowe')}</div></div></div>`,
      AFTER,
    ).html;

    assert.equal(result.match(/data-id="pint_1"/g)?.length, 1);
    assert.match(stripHtml(result), /1\) nowe/);
  });

  it('a provision repealed with no replacement keeps its number and „(uchylony)"', () => {
    // Removing the whole unit would leave an entry in the index that does nothing when
    // tapped. The number has to stay: this branch is only reachable when nothing at all was
    // left in the unit, i.e. when the heading was also inside the bracket — and a bare
    // „(uchylony)" between art. 8 and art. 10 doesn't say what it refers to.
    const result = applyVersions(
      '<div class="unit unit_arti" data-id="arti_9"><h3>' +
        wording('do', '2028-05-19', 0, 'Art. 9.') +
        `</h3><div class="unit-inner"><div class="pro-text">${wording('do', '2028-05-19', 0, 'stare')}</div></div></div>`,
      AFTER,
    ).html;

    assert.match(result, /data-id="arti_9"/);
    assert.match(stripHtml(result), /Art\. 9\. \(uchylony\)/);
    assert.doesNotMatch(result, /stare/);
  });

  it('a repeal with no pair stays, even if the same unit number appears in another article', () => {
    // Sub-unit identifiers repeat in every article, so asking "does `data-id` exist anywhere
    // else" answered "yes, it has a replacement" almost always. Point 1 used to vanish
    // entirely, and the article started at „2)".
    const result = applyVersions(
      '<div class="unit unit_arti" data-id="arti_7"><h3>Art. 7.</h3><div class="unit-inner">' +
        '<div class="unit unit_pint" data-id="pint_1"><h3>' +
        wording('do', '2028-05-19', 0, '1)') +
        `</h3><div class="unit-inner"><div class="pro-text">${wording('do', '2028-05-19', 0, 'pierwszy punkt')}</div></div></div>` +
        '<div class="unit unit_pint" data-id="pint_2"><h3>2)</h3>' +
        '<div class="unit-inner"><div class="pro-text">drugi punkt</div></div></div>' +
        '</div></div>' +
        '<div class="unit unit_arti" data-id="arti_8"><h3>Art. 8.</h3><div class="unit-inner">' +
        '<div class="unit unit_pint" data-id="pint_1"><h3>1)</h3>' +
        '<div class="unit-inner"><div class="pro-text">obcy punkt z innego artykułu</div></div></div>' +
        '</div></div>',
      AFTER,
    ).html;

    assert.match(stripHtml(result), /1\) \(uchylony\)/);
    assert.match(stripHtml(result), /2\) drugi punkt/);
    assert.doesNotMatch(result, /pierwszy punkt/);
  });

  it('a successor taking effect later doesn’t erase „(uchylony)"', () => {
    // Repeal from 2028, new wording only from 2030 — that's two Chancellery positions,
    // not a pair. Between one date and the other, the unit is repealed, and the new
    // wording stands next to it as a provision-in-waiting. A criterion based on `data-id`
    // used to remove the shell, so the article showed only the wording that wasn't yet in
    // force.
    const result = applyVersions(
      '<div class="unit unit_arti" data-id="arti_9"><h3>' +
        wording('do', '2028-05-19', 0, 'Art. 9.') +
        `</h3><div class="unit-inner"><div class="pro-text">${wording('do', '2028-05-19', 0, 'stare')}</div></div></div>` +
        '<div class="unit unit_arti" data-id="arti_9"><h3>' +
        wording('od', '2030-01-01', 1, 'Art. 9.') +
        `</h3><div class="unit-inner"><div class="pro-text">${wording('od', '2030-01-01', 1, 'przyszłe')}</div></div></div>`,
      new Date(2029, 0, 1),
    ).html;
    const text = stripHtml(result);

    assert.match(text, /Art\. 9\. \(uchylony\)/);
    assert.match(text, /przyszłe/);
    assert.match(text, /wejdzie w życie 1 stycznia 2030/);
  });

  it('a pair of wordings doesn’t leave „(uchylony)" — the point wasn’t repealed, only changed', () => {
    const result = applyVersions(PAIR, AFTER).html;

    assert.doesNotMatch(result, /uchylony/);
  });

  it('doesn’t glue content to a footnote reference with a space the act doesn’t have', () => {
    const result = applyVersions(
      wording('do', '2028-05-19', 0, 'stare') +
        wording(
          'od',
          '2028-05-19',
          0,
          'nowe<abbr class="skrot przypis" data-term="Przypis 1" data-def="tresc"><sup>1)</sup></abbr>',
        ),
      BEFORE,
    ).html;

    assert.match(result, /data-przyszle="nowe1\)"/);
  });

  it('escapes the attribute value, so the rest of it doesn’t spill into the results', () => {
    // An unescaped quote or `>` cuts the attribute short and spills the content into the
    // document's text — i.e. into the search engine's hit counter.
    const result = applyVersions(
      wording('do', '2028-05-19', 0, 'stare') +
        wording('od', '2028-05-19', 0, 'broń &amp; &quot;amunicja&quot; &gt; reszta'),
      BEFORE,
    ).html;
    const attribute = /data-przyszle="([^"]*)"/.exec(result)?.[1];

    assert.equal(attribute, 'broń &amp; &quot;amunicja&quot; &gt; reszta');
    assert.doesNotMatch(stripHtml(result), /amunicja|reszta/);
  });

  it('a document with no wording markers stays unchanged', () => {
    const akt = '<div class="unit unit_arti" data-id="arti_4"><h3>Art. 4.</h3></div>';

    assert.equal(applyVersions(akt, BEFORE).html, akt);
  });
});

describe('units with a provision-in-waiting', () => {
  it('flags the unit holding a provision not yet in force', () => {
    // The unit index and the results card don't render the act's content, so the label
    // with the date never reaches them. Without this collection, both surfaces used to
    // present a provision not yet in force exactly like one that is.
    const { units } = applyVersions(ADDED, BEFORE);

    assert.deepEqual(units.get('arti_255b'), { from: '2026-08-23', kind: 'nowy' });
  });

  it('doesn’t flag a chapter where the provision-in-waiting is just one of many', () => {
    // Art. 255b sits in chapter XXXII of the Penal Code, and that chapter in the special
    // part. A condition of "contains a provision-in-waiting" would date-stamp half the code
    // — in the index it would look like an announcement that the whole chapter stops being
    // in force come August.
    const { units } = applyVersions(
      '<div class="unit unit_chpt" data-id="chpt_XXXII"><h3>Rozdział XXXII</h3>' +
        '<div class="unit-inner">' +
        '<div class="unit unit_arti" data-id="arti_255"><h3>Art. 255.</h3>' +
        '<div class="unit-inner"><div class="pro-text">Przepis obowiązujący.</div></div></div>' +
        ADDED +
        '</div></div>',
      BEFORE,
    );

    assert.deepEqual([...units.keys()], ['arti_255b']);
  });

  it('says nothing about units where nothing changes', () => {
    assert.equal(applyVersions(ADDED, new Date(2026, 7, 23)).units.size, 0);
    // The same layout after the change takes effect: the new wording is already standing
    // in the text, so there's nothing left to announce.
    assert.equal(applyVersions(CHANGING_POINT, AFTER).units.size, 0);
  });

  it('a change announcement flags the article, not the point or the chapter', () => {
    // A point isn't in the index (`build_index` picks up parts, chapters, articles and
    // paragraphs), so a label attached to a point would have nowhere to show up. A chapter
    // above the article would be the opposite overreach: only a single point is changing.
    const { units } = applyVersions(
      '<div class="unit unit_chpt" data-id="chpt_2"><h3>Rozdział 2</h3>' +
        `<div class="unit-inner">${CHANGING_POINT}</div></div>`,
      BEFORE,
    );

    assert.deepEqual([...units.entries()], [['arti_15c', { from: '2028-05-19', kind: 'zmiana' }]]);
  });

  it('an article with two changing units doesn’t flag the chapter or the part', () => {
    // A unit "claims" **all** the references within its range, not just the first one it
    // meets. One article with two Chancellery brackets (two positions, two references) used
    // to leave the second one unclaimed, and then the chapter would scoop it up, and above
    // that the code's part — exactly the message the "nothing but a provision-in-waiting"
    // condition guards against for an added unit.
    const point = (pos: number, num: string, previous: string, next: string): string =>
      `<div class="unit unit_pint" data-id="pint_${num}">` +
      `<h3>${wording('do', '2028-05-19', pos, `${num})`)}</h3><div class="unit-inner">` +
      `<div class="pro-text">${wording('do', '2028-05-19', pos, previous)}</div></div></div>` +
      `<div class="unit unit_pint" data-id="pint_${num}">` +
      `<h3>${wording('od', '2028-05-19', pos, `${num})`)}</h3><div class="unit-inner">` +
      `<div class="pro-text">${wording('od', '2028-05-19', pos, next)}</div></div></div>`;

    const { units } = applyVersions(
      '<div class="unit unit_part" data-id="part_OGOLNA"><h3>Część ogólna</h3>' +
        '<div class="unit-inner">' +
        '<div class="unit unit_chpt" data-id="chpt_2"><h3>Rozdział 2</h3><div class="unit-inner">' +
        '<div class="unit unit_arti" data-id="arti_15c"><h3>Art. 15c.</h3>' +
        '<div class="unit-inner">' +
        point(0, '1', 'dyplom magistra psychologii,', 'prawo wykonywania zawodu,') +
        point(1, '2', 'pięcioletni staż pracy,', 'trzyletni staż pracy,') +
        '</div></div>' +
        '</div></div></div></div>',
      BEFORE,
    );

    assert.deepEqual([...units.entries()], [['arti_15c', { from: '2028-05-19', kind: 'zmiana' }]]);
  });

  it('a lapse announcement reaches the index the same way as the other two', () => {
    // The index is a second surface where the article is visible, and it used to say
    // nothing about this state at all.
    const { units } = applyVersions(REPEALED, BEFORE);

    assert.deepEqual(units.get('arti_9'), { from: '2028-05-19', kind: 'moc' });
    assert.equal(applyVersions(REPEALED, AFTER).units.size, 0);
  });

  it('an announcement from a unit with no identifier doesn’t float up to the chapter', () => {
    // An index unit with no `data-id` has no row in the index, so the label has nowhere to
    // stand anyway — and letting it float upward would claim a change in the chapter.
    const { units } = applyVersions(
      '<div class="unit unit_chpt" data-id="chpt_2"><h3>Rozdział 2</h3><div class="unit-inner">' +
        '<div class="unit unit_arti"><h3>Art. 15c.</h3>' +
        `<div class="unit-inner">${PAIR}</div></div>` +
        '</div></div>',
      BEFORE,
    );

    assert.deepEqual([...units.keys()], []);
  });

  it('a statute’s paragraph gets no entry, a regulation’s paragraph does', () => {
    // In an act, `§` is a sub-unit of an article and doesn't go into the index; in
    // a regulation it's a top-level unit and does — that's exactly how `build_index` splits
    // them. An entry under the key `para_1` from inside an article would therefore be a
    // label with no row, and on top of that an identifier that means something else in
    // a regulation: these numbers repeat in the code at every article.
    const paragraph =
      `<div class="unit unit_para" data-id="para_1"><h3>${wording('od', '2026-08-23', 0, '§ 1.')}</h3>` +
      `<div class="unit-inner"><div class="pro-text">${wording('od', '2026-08-23', 0, 'Kto czyni przygotowania.')}</div></div></div>`;

    const inStatute = applyVersions(
      '<div class="unit unit_arti" data-id="arti_255b">' +
        `<h3>${wording('od', '2026-08-23', 0, 'Art. 255b.')}</h3>` +
        `<div class="unit-inner">${paragraph}</div></div>`,
      BEFORE,
    );
    const inRegulation = applyVersions(paragraph, BEFORE);

    assert.deepEqual([...inStatute.units.keys()], ['arti_255b']);
    assert.deepEqual([...inRegulation.units.keys()], ['para_1']);
  });
});

describe('splitFuture', () => {
  it('cuts the document into binding and non-binding pieces, in order', () => {
    // The boundary falls right on a marker — exactly where `textNodes` ends a node anyway —
    // so gluing the nodes from the pieces back together gives the same split as it would for
    // the whole document.
    const { html } = applyVersions(ADDED, BEFORE);
    const parts = splitFuture(html);

    assert.deepEqual(
      parts.filter((part) => part.from !== null).map((part) => stripHtml(part.html)),
      ['Art. 255b.', 'Kto czyni przygotowania.'],
    );
    assert.equal(parts.map((part) => part.html).join(''), html.replace(/<\/?span[^>]*>/g, ''));
  });

  it('a document with no provisions-in-waiting is a single piece', () => {
    const parts = splitFuture('<p>Zwykły przepis.</p>');

    assert.deepEqual(parts, [{ html: '<p>Zwykły przepis.</p>', from: null }]);
  });
});

describe('labels', () => {
  it('the date reads in Polish, not like an identifier', () => {
    assert.equal(dateLabel('2026-08-23'), '23 sierpnia 2026');
    assert.equal(dateLabel('2028-05-19'), '19 maja 2028');
    assert.equal(dateLabel('2027-01-01'), '1 stycznia 2027');
  });

  it('say two different things, because they are two opposite states', () => {
    // The heart of the whole fix. Both labels carry the same date, and because of that they
    // used to sound the same for a long time („od 19 maja 2028"). Next to a provision in
    // force, that read like "this point will take effect then" — the opposite of what's
    // actually true.
    assert.equal(changeLabel('2028-05-19'), 'zmieni się 19 maja 2028');
    assert.equal(startLabel('2026-08-23'), 'wejdzie w życie 23 sierpnia 2026');
    assert.equal(lapseLabel('2028-05-19'), 'traci moc 19 maja 2028');
  });

  it('the index row takes its label from the announcement’s kind, not from a guess', () => {
    // Three states, three sentences — and the index row is one and the same for all three.
    assert.equal(unitLabel({ from: '2026-08-23', kind: 'nowy' }), 'wejdzie w życie 23 sierpnia 2026');
    assert.equal(unitLabel({ from: '2028-05-19', kind: 'zmiana' }), 'zmieni się 19 maja 2028');
    assert.equal(unitLabel({ from: '2028-05-19', kind: 'moc' }), 'traci moc 19 maja 2028');
  });
});
