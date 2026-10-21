// Where the browser check's runtime pin comes from (M81 A1, design spec v4
// §4.2), shared by the release and weekly pin check
// (scripts/check-browser-runtime-pin.mjs) and the pin's generator
// (scripts/pin-browser-runtime.mjs), so both read the same records the same
// way: Chrome for Testing's own metadata for a version and its revision, and
// ChromiumDash's Stable records (field `time`, epoch ms) for that exact
// version on each desktop platform. `dashUrl` gives the URLs the pin records
// in `publication.sources`. Each answer is parsed with its schema below
// before any field of it is read.

import { z } from 'zod'

/** Chrome for Testing's newest version on each channel, with its revision. */
export const CFT_LAST_KNOWN_GOOD =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json'
/** Every version Chrome for Testing has published, with its revision. */
export const CFT_KNOWN_GOOD =
  'https://googlechromelabs.github.io/chrome-for-testing/known-good-versions.json'
/** ChromiumDash's desktop platforms; the earliest of their records dates a version. */
export const DESKTOP = ['Windows', 'Linux', 'Mac']
export const VERSION_PATTERN = /^\d+\.\d+\.\d+\.\d+$/
const REVISION = z.string().regex(/^\d+$/)

/** CFT_LAST_KNOWN_GOOD's answer: the newest Stable version and its revision. */
export const LAST_KNOWN_GOOD = z.object({
  channels: z.object({
    Stable: z.object({ version: z.string().regex(VERSION_PATTERN), revision: REVISION }),
  }),
})
/** CFT_KNOWN_GOOD's answer: every published version and its revision. */
export const KNOWN_GOOD = z.object({
  versions: z.array(z.object({ version: z.string(), revision: REVISION })),
})
/** A dashUrl answer: the releases, each with its version, channel and record time. */
export const DASH_RELEASES = z.array(
  z.object({ version: z.string(), channel: z.string(), time: z.number().optional() }),
)

/** ChromiumDash's newest 200 Stable releases on one desktop platform. */
export function dashUrl(platform) {
  return `https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=${platform}&num=200`
}

/** The `time` of the single dated Stable record for exactly `version`, or undefined. */
export function stableRecordTime(releases, version) {
  const matches = releases.filter(
    (release) => release.version === version && release.channel === 'Stable',
  )
  return matches.length === 1 && Number.isSafeInteger(matches[0].time) && matches[0].time > 0
    ? matches[0].time
    : undefined
}
