/**
 * The five subject areas the licence exam draws from.
 *
 * § 19 ust. 1 of the PZSS licence regulation prescribes the *composition* of the paper, not
 * the way it is drawn: "test składający się z 10 pytań, po 2 pytania z następujących
 * zagadnień", followed by five areas. The word "losowanie" never appears about the written
 * part. So the sheet has a fixed shape, and this table is that shape.
 *
 * The table is deliberately import-free: the exam engine reads it through `examPool`, the
 * store resolves an area's slug to questions, and neither may end up importing the other.
 *
 * Each area is a sum of the course's own question sets. We do not classify the course's
 * content question by question — that would mean maintaining our own taxonomy of someone
 * else's material through every content refresh. The price of the cheap route shows in one
 * area: the course's "Ograniczenia broni ISSF" set holds technical data *and* descriptions of
 * competitions, distances and penalties, so `zg-budowa` is named after both. Splitting it
 * would need per-question tags, and the `law` field can't do it either — "Skrócone dane
 * regulaminowych ograniczeń broni" is the basis for both "Wymiar pudełka pistoletów na 25m"
 * and "Jakie konkurencje są strzelane na 25m".
 */

/** One subject area of the exam, and one row of the diagnosis on the exam screen. */
export interface Category {
  /**
   * Slug used both as a route parameter (`/practice/test/<slug>`, which is how the diagnosis
   * opens an area's quiz) and as a source reference in the exam profile. Prefixed so it can
   * never collide with a course set slug.
   */
  slug: string;
  title: string;
  /** Course sets the area is assembled from. */
  setSlugs: readonly string[];
  /**
   * Whether questions belonging to no thematic set land here.
   *
   * Exactly one area carries this. 55 questions in the bundle belong to no set other than
   * "wszystkie" — practical ones about storage, carrying, moving, lending and registration
   * ("Klucz do szafy z bronią palną należy", "Broń uznaje się za załadowaną, jeśli"). Without
   * a home they would silently stop appearing in any exam, which is the worst kind of defect
   * here: invisible on screen. They all concern the Act or its regulations, so area 1 — "UoBiA
   * i przepisy wydane na jej podstawie" — is where they belong, and the rule is safe in one
   * direction: a question that would fit safety rules better is not lost, it just lands in a
   * different slot of the paper.
   *
   * There is deliberately **no exception list**. Three of those questions are arguably outside
   * § 19 ust. 1 — the stamp duty on a promesa, and a registration deadline falling on a
   * Saturday — but excluding them would buy a tidier label at the price of a rule to maintain
   * and a judgement call that is ours to make and shouldn't be. Three questions in a pool of
   * 295 change nothing about the paper, and this way every question the course teaches stays
   * reachable in an exam.
   */
  includeUnassigned?: true;
}

export const CATEGORIES: readonly Category[] = [
  {
    slug: 'zg-uobia',
    title: 'UoBiA i przepisy wykonawcze',
    setSlugs: ['uobia', 'rozp-noszenie', 'rozp-transport'],
    includeUnassigned: true,
  },
  {
    slug: 'zg-bezpieczenstwo',
    // The course's own name for the same set, deliberately: the area *is* that set, so a
    // second name for it would only make someone wonder what the difference is.
    title: 'Bezpieczeństwo w strzelectwie',
    // Maps 1:1 onto the PZSS document "Ogólne zasady bezpieczeństwa w strzelectwie
    // sportowym": all 18 points of its § 3 are covered, no question without a counterpart
    // and no point without a question.
    setSlugs: ['pzss-bezpieczenstwo'],
  },
  {
    slug: 'zg-regulaminy',
    // Reading closest to the wording of § 19 ust. 1 pkt 3, though not the only defensible
    // one: § 20 ust. 1 pkt 1 pairs "regulamin strzelnicy oraz ogólne zasady bezpieczeństwa"
    // in one breath, and PZSS's own published question list keeps both in a single block
    // (items 58-84, interleaved) — so PZSS does not isolate this area at all. Moving the
    // range rules under area 1 (they are a regulation issued under the Act) would be a
    // one-line change here.
    title: 'Wzorowy regulamin strzelnicy',
    setSlugs: ['reg-strzelnicy'],
  },
  {
    slug: 'zg-budowa',
    // Named after what is inside, not after § 19 ust. 1 pkt 4. Of the 84 questions, 49 carry
    // the lesson "Przepisy sportowe ISSF" (competitions, distances, penalties) and only 7
    // "Budowa broni" — so a name promising construction would send someone back to the wrong
    // lesson to fix a weak result.
    title: 'Budowa broni i przepisy ISSF',
    setSlugs: ['bron', 'pzss-bron'],
  },
  {
    slug: 'zg-prawo-karne',
    // Both course sets in the name: "Prawo karne" alone is also the name of one of them, and
    // it has 49 questions against this area's 60 — same name, different number.
    title: 'Prawo karne i obrona konieczna',
    setSlugs: ['prawo-karne', 'obrona-konieczna'],
  },
];

/**
 * The course's umbrella set, which says nothing about a question's subject.
 *
 * Membership in it is what makes a question "unassigned" rather than genuinely categorized.
 */
export const ALL_SET_SLUG = 'wszystkie';

/** Category for a slug, or undefined when the slug names a course set instead. */
export function category(slug: string): Category | undefined {
  return CATEGORIES.find((entry) => entry.slug === slug);
}
