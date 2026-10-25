/**
 * True when a request path carries a percent-escape that does not decode
 * (`%E0%A4%A`, `%zz`). Such a path cannot name any page or record; the proxy
 * answers 400 instead of letting routing fail on it with a 500.
 */
export function hasMalformedEscape(pathname: string): boolean {
  if (!pathname.includes('%')) return false
  try {
    decodeURIComponent(pathname)
    return false
  } catch {
    return true
  }
}
