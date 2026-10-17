// Shared request-URL readout for the legal tests' scripted fetch fakes.

/** The exact URL a stubbed fetch was asked for, whatever shape it arrived in. */
export function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}
