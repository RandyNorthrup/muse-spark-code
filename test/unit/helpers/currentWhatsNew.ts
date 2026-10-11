import {
  encodeWhatsNewContent,
  parseWhatsNewContent,
  type ReleaseNotes,
} from '../../../src/core/whatsNew/whatsNewContent'

/** The actual shipped round trip, shared by the C-X-1 publication regressions. */
export function currentWhatsNewText(releases: readonly ReleaseNotes[]): string {
  const encoded = encodeWhatsNewContent(
    JSON.stringify({ schema: 1, releases: releases.slice(0, 2) }),
  )
  return JSON.stringify(parseWhatsNewContent(encoded))
}
