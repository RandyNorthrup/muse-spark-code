/** A fetch the test can read. The reply is whatever `respond` returns; nothing here stands in for GitHub. */
export function scriptedFetch(
  respond: (url: string, init: RequestInit | undefined) => Promise<Response>,
): typeof globalThis.fetch {
  return (input, init) => {
    let url: string
    if (typeof input === 'string') url = input
    else if (input instanceof URL) url = input.href
    else url = input.url
    return respond(url, init)
  }
}
