// The URLs of a browser check's requests still in flight (M81, PLAN.md D49;
// review RV81), kept only to name a request that later fails: by session and
// request id, each cut to BROWSER_CHECK_ENTRY_MAX_CHARS, taken out when the
// request finishes or fails, and at most BROWSER_CHECK_MAX_TRACKED_REQUESTS
// at once (past it the oldest is forgotten, and a failure it later has goes
// unnamed), so a page that floods requests cannot grow the extension host.

import {
  BROWSER_CHECK_ENTRY_MAX_CHARS,
  BROWSER_CHECK_MAX_TRACKED_REQUESTS,
} from '../../shared/constants'

/** A page's text cut to the entry bound, marked where it was cut. */
export function clipEntry(text: string): string {
  return text.length > BROWSER_CHECK_ENTRY_MAX_CHARS
    ? `${text.slice(0, BROWSER_CHECK_ENTRY_MAX_CHARS)}…`
    : text
}

export class RequestLog {
  private static keyOf(sessionId: string, requestId: string): string {
    return `${sessionId}\0${requestId}`
  }

  private readonly urls = new Map<string, string>()

  /** A request sent, or sent on to a redirect's target (the same id, a new URL). */
  public add(sessionId: string, requestId: string, url: string): void {
    const key = RequestLog.keyOf(sessionId, requestId)
    // A redirect moves the request to the end, as the newest.
    this.urls.delete(key)
    if (this.urls.size >= BROWSER_CHECK_MAX_TRACKED_REQUESTS) {
      const oldest = this.urls.keys().next()
      if (oldest.done !== true) {
        this.urls.delete(oldest.value)
      }
    }
    this.urls.set(key, clipEntry(url))
  }

  /** The request's URL, taken out: it finished or failed. */
  public take(sessionId: string, requestId: string): string | undefined {
    const key = RequestLog.keyOf(sessionId, requestId)
    const url = this.urls.get(key)
    this.urls.delete(key)
    return url
  }

  /** How many requests are kept. */
  public get size(): number {
    return this.urls.size
  }
}
