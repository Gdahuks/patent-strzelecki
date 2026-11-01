/**
 * Where "Oceń w Google Play" leads.
 *
 * `market://` opens the listing in the Play Store app itself, which is where the rating form
 * lives. A device without the Play Store (an emulator image without Google services, a
 * de-Googled phone) has nothing registered for that scheme, so the caller falls back to the
 * web listing, which works anywhere.
 */
export function storeListingUrls(packageName: string): { market: string; web: string } {
  const id = encodeURIComponent(packageName);
  return {
    market: `market://details?id=${id}`,
    web: `https://play.google.com/store/apps/details?id=${id}`,
  };
}
