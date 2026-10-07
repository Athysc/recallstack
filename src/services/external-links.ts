// Classification of link targets that must open in the system browser rather
// than inside the application webview. Only http(s) URLs qualify.

/** Returns the normalised URL when `href` is an absolute http/https URL, else null. */
export function externalHttpUrl(href: string | null | undefined): string | null {
  const raw = String(href ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}
