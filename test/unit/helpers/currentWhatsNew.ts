import {
  encodeWhatsNewContent,
  parseWhatsNewContent,
  type ReleaseNotes,
} from '../../../src/core/whatsNew/whatsNewContent'

/**
 * The two newest releases as the build encodes them. The build publishes
 * smaller notes when these do not fit (`selectWhatsNewReleases`); a regression
 * that reads the published text must then follow that selection, so this
 * throws rather than read notes nobody ships.
 */
export function currentWhatsNewEncoding(releases: readonly ReleaseNotes[]): string {
  const encoded = encodeWhatsNewContent(
    JSON.stringify({ schema: 1, releases: releases.slice(0, 2) }),
  )
  if (encoded.kind !== 'encoded')
    throw new Error(
      `The two newest releases are ${String(encoded.bytes)} bytes of What’s New content; the budget is ${String(encoded.maxBytes)}`,
    )
  return encoded.text
}

/** The actual shipped round trip, shared by the C-X-1 publication regressions. */
export function currentWhatsNewText(releases: readonly ReleaseNotes[]): string {
  return JSON.stringify(parseWhatsNewContent(currentWhatsNewEncoding(releases)))
}
