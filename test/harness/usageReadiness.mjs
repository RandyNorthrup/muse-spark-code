// Shared Usage browser readiness (RVCM1141B, RVCM1141C P2).
//
// A Usage browser certification accepts ONLY the ready marker the Usage view
// sets after rendering real host state (`data-usage-ready`, set when `state`
// is defined in `src/webview/usage/UsageApp.tsx`), never an idle shell:
// `aria-busy` settles on error and loading shells too, and the header
// title/subtitle render before any host state arrives. An error shell, an
// empty shell or a loading state must therefore fail the wait with a named
// reason instead of passing the certification.
//
// Success paths use `waitForUsageReady` + `assertUsageContent`. The explicit
// error paths (the initial error shell, which never carries the marker, and
// the native-transport failure after a load, which keeps the rendered state
// and its marker under the alert) use `waitForUsageSettled` for
// synchronization plus `assertUsageError` for the alert text. `usage/error`
// never clears `state`, so an error assertion must never refuse the marker:
// only the success assertion refuses the alert.
export const USAGE_READY_SELECTOR = 'main.usage-page[data-usage-ready="true"][aria-busy="false"]'

// Settled but not necessarily rendered: an idle page with or without host
// state. For explicit error-path synchronization only; a success
// certification waits on USAGE_READY_SELECTOR above instead.
export const USAGE_SETTLED_SELECTOR = '.usage-page[aria-busy="false"]'

// State-backed copy every successful Usage render carries
// (src/shared/l10n/usageEn.ts; the long-* scenarios only override
// title/subtitle/groupBy/refresh/deleteHistory in test/harness/usageHost.mjs,
// never this line).
export const USAGE_HOST_LINE = 'History is stored on win11 · remote workspace.'

// Headings only a rendered state can show (same table): `empty` and
// `history-off` carry no breakdown rows, every other scenario does.
export const USAGE_SCENARIO_HEADINGS = {
  empty: 'No usage yet',
  'history-off': 'Usage history is off',
}

export async function waitForUsageReady(page) {
  await page.locator(USAGE_READY_SELECTOR).waitFor()
}

export async function waitForUsageSettled(page) {
  await page.locator(USAGE_SETTLED_SELECTOR).waitFor()
}

export async function assertUsageError(page, { title, message }) {
  const alert = page.getByRole('alert')
  await alert.waitFor()
  const text = await alert.textContent()
  if (text === null || !text.includes(message))
    throw new Error(`${title}: expected error "${message}", saw "${text ?? ''}"`)
}

export async function assertUsageContent(page, { title, scenario }) {
  await waitForUsageReady(page)
  if ((await page.getByRole('alert').count()) !== 0)
    throw new Error(`${title}: a ready page must not show an error alert`)
  await page.getByText(USAGE_HOST_LINE).first().waitFor()
  const heading = USAGE_SCENARIO_HEADINGS[scenario]
  if (heading !== undefined) await page.getByRole('heading', { name: heading }).waitFor()
}
