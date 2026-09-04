/**
 * The address the preview screen hands to its WebView.
 *
 * The screen used to point at the image with a plain `file://` address inside an HTML
 * string. That string is loaded with no base address, so for WebKit the picture is a
 * resource from a foreign origin, and the origin policy drops it: on iOS the preview showed
 * the description and nothing else. Android renders it, because there `allowFileAccess`
 * governs the same request. Handing the bytes over inside the address removes the question
 * — there is no second resource left to fetch, so no policy left to fail.
 *
 * The rule lives in the engine, apart from the disk, so it can be tested: `materialize.ts`
 * imports `expo-file-system` at module scope, which vitest can't parse.
 */

/** The types a browser will decode — the same list the scraper recognises by magic bytes. */
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/**
 * The `data:` address for an image, or null when its extension names no image type.
 *
 * Deriving the type from the name is only sound because the bundle guarantees the two
 * agree: the scraper renames a file whose bytes contradict its extension, refuses to build
 * a bundle where any of them still does, and `assets.package.test.ts` checks the same thing
 * on the built bundle. That guarantee was bought the hard way — the course serves a PNG
 * under a `.jpg` name.
 */
export function previewSource(name: string, base64: string): string | null {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const mime = MIME[extension];

  return mime ? `data:${mime};base64,${base64}` : null;
}
