// The legal header-fix planner, deferred (D6): preparing header patches
// needs the header fixer, the code-aware text helpers and the patch
// document, none of which a scan that only reports needs. dist/legalScan.js
// loads this as dist/legalFix.js on the first scan with a fixable finding
// (or the first fix request). A scan that needs it and cannot load it is
// refused, never silently unfixable.
export { prepareLegalHeaderPatches } from './headerFix'
// The selected-fix preview store rides the fix chunk too: previews are
// built only on a fix request, never during the scan, so the 150 KiB scan
// budget holds the scan.
export { LegalFixPreviews } from './fixPreviews'
