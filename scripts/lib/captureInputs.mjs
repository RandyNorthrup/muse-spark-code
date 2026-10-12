// What a screenshot is made from: the paths whose change can move a pixel of
// the reviewed baseline. One list for every reader: a reviewed update refuses
// to start while any of them is uncommitted, and the candidate a comparison
// renders is identified by them (scripts/check-visual.mjs, which takes the
// list from visualManifest.mjs). No imports: a CI decision can read it before
// anything is installed.
//
// - `scripts/lib` beside `scripts/build.mjs`: the build's helpers (the UI
//   text regions, the What's New builder) shape the bundles as it does.
// - `package.json` and `package-lock.json`: a dependency's version changes
//   the bundle a scene runs.
// - Not `CHANGELOG.md`: What's New is rendered from a fixed fixture under
//   test/harness (test/harness/whats-new/CHANGELOG.fixture.md), so a release's
//   notes and its version move no frame.
export const CAPTURE_INPUTS = Object.freeze([
  'src',
  'design',
  'test/harness',
  'scripts/build.mjs',
  'scripts/lib',
  'package.json',
  'package-lock.json',
])

/** The reviewed baseline: its hashes, and the revision it was rendered from. */
export const VISUAL_MANIFEST = 'test/harness/goldens/manifest.json'
