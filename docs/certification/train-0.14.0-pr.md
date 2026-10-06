# Prepare Muse Spark Code (Unofficial) 0.14.0

This train integrates the completed feature branches with 0.13.0’s paid policy,
then reduces activation and package size while preserving all translated text,
release notes, protocol validation and feature behavior. Metered Judge calls
now reserve and settle against D78’s durable shared daily budget; subscription
Judge calls do not ask a Model API price question. Extension hooks also honor
the held-project trust restriction before loading or executing.

Included history (each branch head is retained, merges are not squashed):

- 0.13.0 and PR #121: README release highlights and version regression.
- M94: inline Tab completions, first-use consent, local-day ledger and lazy provider.
- M71 / PR #78: panel Git and GitHub pull requests with held-project trust.
- M100: multi-device plan and decisions only; no connectivity implementation.
- DEFLAKE3: deterministic turn-checkpoint copy ordering.
- M91 and M91b: hook format parity, Setup/Manual hooks, paid hook models and bounded plugins.
- M93: previewable scrubbed local problem reports and flight recorder.
- Knip constants: restore named-import dead-export detection and namespace checks.
- DEFLAKE4: direct production split-guard drills over pure in-memory fixtures; retain M93’s parse skip and remove M91’s temporary override.
- M98 phase 1: uncalibrated approval caution, hidden-session routing, first-charge consent and D78 shared-budget adapter.
- ACTDIET: lazy conversation and recorder factories, regional Node English, browser-only review comment text and focus-safe lazy Report.
- Train repairs: shared Node wire schemas, lossless packaged translation matrix and browser dictionary, complete bounded compressed What’s New notes and exact report frame registrations.

Release preparation updates package versions and both README summaries to 0.14.0,
consolidates Unreleased into one dated section with five contributed-command or
setting highlights, and preserves every older released changelog byte.

Validation and conflict-by-conflict decisions are in
[the train certification](train-0.14.0.md). The final universal VSIX is 2,246,965 bytes (cap 2,252,800). Activation is
447,145 bytes and browser startup 914,592. Packaging, static gates, audit, secrets, SAST (zero findings) and accessibility
(all 620 pages, zero violations) pass; the complete quality run exits 1 with three paused Judge fixture
cases and a browser inventory timeout (the final inventory fixture now passes
scoped verification). **Blocked for merge/release until full quality exits zero.** This is a local integration draft; no push,
publish, live model call, paid model call or hosted-platform certification was
performed. M94 lane K and CI badge refresh were explicitly unready and skipped.
M98 phase 2, calibration, the remaining M100 implementation and M80’s hosted/live
receipts remain outside this release certification.
