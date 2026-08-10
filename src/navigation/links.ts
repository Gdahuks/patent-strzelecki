/**
 * Router for links found in lesson content.
 *
 * Lessons are rendered as the course's original HTML, so they carry links written for a
 * website: "/pzss", "/testy/uobia", "assets/schemat.jpg", addresses pointing at ISAP. This
 * function translates them into app screens, so navigation doesn't kick the user out to
 * the browser.
 *
 * The module is pure — no React Native, no expo-router — so it's tested without the app.
 */

export type LinkTarget =
  | { kind: 'lesson'; slug: string }
  | { kind: 'test'; sets: string[] }
  | { kind: 'flashcards'; sets: string[] }
  | { kind: 'contents' }
  | { kind: 'exercises' }
  | { kind: 'exam' }
  | { kind: 'image'; name: string }
  | { kind: 'anchor'; id: string }
  | { kind: 'external'; url: string };

/**
 * Site paths that have their own native screen in the app.
 *
 * A `Map`, not an object literal: the latter inherits from `Object.prototype`, so a link
 * to "/toString" returned a function instead of a target, and "/__proto__" — the prototype
 * itself. There are no such paths in the bundle today, but it's one course content change
 * away from a crash.
 */
const NAMED_ROUTES = new Map<string, LinkTarget>([
  ['', { kind: 'contents' }],
  ['spis-tresci', { kind: 'contents' }],
  ['cwiczenia', { kind: 'exercises' }],
  ['konto', { kind: 'exam' }],
]);

const ASSETS = 'assets/';

function splitSets(value: string): string[] {
  return value
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
}

/**
 * @param href the value of the href attribute from lesson content
 * @param knownLessons lesson slugs present in the bundle — an unrecognised internal path
 *   falls through to the browser, since it may point at a sub-page added after the last
 *   content update
 * @param siteUrl the course's address, used to build a full URL for unknown paths
 */
export function resolveLink(
  href: string,
  knownLessons: ReadonlySet<string>,
  siteUrl = 'https://patentstrzelecki.eu',
): LinkTarget {
  const trimmed = href.trim();

  if (!trimmed) return { kind: 'contents' };

  if (trimmed.startsWith('#')) {
    return { kind: 'anchor', id: trimmed.slice(1) };
  }

  // A schemeless address ("//cdn.example.com/a.js") gets completed by the browser with the
  // page's own scheme. Here the "page" is a file, so without this it carried on as a path
  // on the course site and ended up as "https://patentstrzelecki.eu/cdn.example.com/a.js".
  if (trimmed.startsWith('//')) {
    return { kind: 'external', url: `https:${trimmed}` };
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    // mailto:, tel:, http(s):// — everything outside the app.
    return { kind: 'external', url: trimmed };
  }

  // The hash and query parameters aren't part of the path. Without stripping the
  // parameters, "/testy/uobia?utm=1" produced a set with the slug "uobia?utm=1", i.e. an
  // empty practice screen. For an external address, we append the parameters back — there
  // they carry meaning.
  const [beforeHash] = trimmed.split('#', 1);
  const queryAt = beforeHash.indexOf('?');
  const rawPath = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt < 0 ? '' : beforeHash.slice(queryAt);
  const path = rawPath.replace(/^\/+/, '').replace(/\/+$/, '');

  // Images rewritten by the scraper into local paths. Checked after stripping slashes,
  // since "/assets/x.jpg" points at the same file as "assets/x.jpg", and the first form
  // used to fall through to the browser as an unknown course sub-page.
  if (path.startsWith(ASSETS) && path.length > ASSETS.length) {
    return { kind: 'image', name: path.slice(ASSETS.length) };
  }

  const named = NAMED_ROUTES.get(path);
  if (named) return named;

  if (path.startsWith('testy/')) {
    const sets = splitSets(path.slice('testy/'.length));
    if (sets.length > 0) return { kind: 'test', sets };
  }

  if (path.startsWith('fiszki/')) {
    const sets = splitSets(path.slice('fiszki/'.length));
    if (sets.length > 0) return { kind: 'flashcards', sets };
  }

  if (knownLessons.has(path)) {
    return { kind: 'lesson', slug: path };
  }

  return { kind: 'external', url: `${siteUrl}/${path}${query}` };
}

/**
 * Turns the address the WebView is trying to navigate to back into the link from the
 * content.
 *
 * Lessons are loaded from a file, so the browser resolves links relative to `file://`:
 * the root-relative link "/pzss" becomes "file:///pzss" (the filesystem root, not the
 * content directory), and the relative "assets/schemat.jpg" becomes
 * "file://<content directory>/assets/schemat.jpg". Both forms need to be brought back to
 * the shape they had in the content.
 *
 * @param url the address from the navigation request
 * @param contentDir the path to the directory holding the materialized content (without
 *   the "file://" scheme)
 */
export function fileUrlToHref(url: string, contentDir: string): string {
  if (!url.startsWith('file://')) return url;

  const raw = url.slice('file://'.length);
  // A filename with a literal percent sign ("100%.html") is an invalid escape sequence in
  // the address, and `decodeURI` throws a URIError. The exception used to escape from
  // `onShouldStartLoadWithRequest`, i.e. from the WebView's callback, instead of a
  // navigation decision being returned. An address that can't be decoded is taken as-is —
  // the router will send it out to the browser anyway.
  let path: string;
  try {
    path = decodeURI(raw);
  } catch {
    path = raw;
  }

  const base = contentDir.replace(/^file:\/\//, '').replace(/\/+$/, '');

  if (path.startsWith(`${base}/`)) {
    return path.slice(base.length + 1);
  }
  return path;
}

/** Whether the address points at the same lesson (e.g. a jump to an anchor on the page). */
export function isSameDocument(url: string, lessonUri: string): boolean {
  return url === lessonUri || url.startsWith(`${lessonUri}#`);
}

/**
 * The expo-router path for a target, or null when the target is handled some other way
 * than navigation.
 */
export function routeFor(target: LinkTarget): string | null {
  switch (target.kind) {
    case 'lesson':
      return `/learn/${target.slug}`;
    case 'test':
      return `/practice/test/${target.sets.join(',')}`;
    case 'flashcards':
      return `/practice/flashcards/${target.sets.join(',')}`;
    case 'contents':
      return '/';
    case 'exercises':
      return '/practice';
    case 'exam':
      return '/exam';
    default:
      return null;
  }
}
