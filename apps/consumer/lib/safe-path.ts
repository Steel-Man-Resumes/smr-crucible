/**
 * Is this a same-site path that is safe to send a browser to?
 *
 * Starts with one "/", and contains no backslash and no control character
 * anywhere. Browsers strip tab and newline from URLs and treat "\" like "/",
 * so "/\t/evil.com", "/\n/evil.com" and "/\evil.com" all become
 * "//evil.com", which is another site. Checking only the first characters is
 * not enough.
 *
 * Pure (no imports): used by client pages and server code alike. One helper
 * for every "where do I go next" parameter, so the rule cannot drift.
 */
export function isSafeRelativePath(url: unknown): url is string {
  return (
    typeof url === "string" &&
    url.startsWith("/") &&
    !url.startsWith("//") &&
    !/[\\\u0000-\u001f\u007f]/.test(url)
  );
}
