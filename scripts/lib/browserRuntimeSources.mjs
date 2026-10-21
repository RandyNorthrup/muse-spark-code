// Where the browser check's runtime pin comes from (M81 A1, design spec v4
// §4.2), shared by the release and weekly pin check
// (scripts/check-browser-runtime-pin.mjs) and the pin's generator
// (scripts/pin-browser-runtime.mjs), so both read the same records the same
// way: Chrome for Testing's own metadata for a version and its revision, and
// ChromiumDash's Stable records (field `time`, epoch ms) for that exact
// version on each desktop platform. `dashUrl` gives the URLs the pin records
// in `publication.sources`.

/** Chrome for Testing's newest version on each channel, with its revision. */
export const CFT_LAST_KNOWN_GOOD =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json'
/** Every version Chrome for Testing has published, with its revision. */
export const CFT_KNOWN_GOOD =
  'https://googlechromelabs.github.io/chrome-for-testing/known-good-versions.json'
/** ChromiumDash's desktop platforms; the earliest of their records dates a version. */
export const DESKTOP = ['Windows', 'Linux', 'Mac']
export const VERSION_PATTERN = /^\d+\.\d+\.\d+\.\d+$/

/** ChromiumDash's newest 200 Stable releases on one desktop platform. */
export function dashUrl(platform) {
  return `https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=${platform}&num=200`
}

/** The `time` of the single dated Stable record for exactly `version`, or undefined. */
export function stableRecordTime(releases, version) {
  const matches = releases.filter(
    (release) => release?.version === version && release?.channel === 'Stable',
  )
  return matches.length === 1 && Number.isSafeInteger(matches[0].time) && matches[0].time > 0
    ? matches[0].time
    : undefined
}
