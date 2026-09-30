// An esbuild plugin for the bundles that load after activation: the Model API
// backend (dist/modelApi.js, M57) and the review (dist/review.js, M70). Each
// of them installs the activation bundle's display table before it reads a
// string (its factory calls `setUiText` first, PLAN.md D33), so the English
// table `text.ts` starts from is never read there, and carrying a copy of
// it (72 KiB of the Model API bundle, which the review's 68 strings would
// have pushed past its budget) buys nothing. The plugin loads an empty table
// in its place; the bundle-split gate fails the build if an English table
// comes back into either bundle (scripts/check-bundle-split.mjs).

const ENGLISH_TABLE = /[\\/]src[\\/]shared[\\/]l10n[\\/]en\.ts$/

/** @type {import('esbuild').Plugin} */
export const withoutEnglishTable = {
  name: 'without-english-table',
  setup(build) {
    build.onLoad({ filter: ENGLISH_TABLE }, () => ({
      contents: 'export const EN = {}\n',
      loader: 'ts',
    }))
  },
}
