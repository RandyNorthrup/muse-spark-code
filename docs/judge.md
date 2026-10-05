# Muse Judge phase-2 integration

Muse Judge is advisory: an answer never grants an action, skips a question
or replaces a deterministic check. This first integration packages B's
offline calibration, D's sampling/contrastive techniques and CS's loopback
boundary. It does not register CLI commands or enable a real source. G,
GH, H and J join later through the lead's integration. TypeSafe/Jev remains
experimental, untested and opt-in; historical research is not product
certification.

`dist/judge.js` is a CommonJS bundle beside the shared `dist/uiText.js`,
included in both the VSIX and the ACP npm package. The type-only
`judgeFeaturesLoader` in `src/runtime/judge/judgeBundle.ts` loads it on the
first explicit call, retries missing/corrupt files, and installs the caller's
current language before every use. Its factory exposes:

- `parseCalibrationDataset`, `parseCalibrationProfile`, `fitCalibration`,
  `reportCalibration` and `applyCalibration`, with required caller-supplied
  limits. Fitting/tuning/evaluation groups stay disjoint. Profiles bind the
  provider, source, model/version/endpoint, technique, family and prompt,
  criteria and fit versions. Synthetic or partial evidence cannot activate
  a calibrated label. Reports measure evaluation groups only.
- `sampleJudge` and `contrastiveJudge`, with the captured source,
  measurement and per-attempt admission dependencies required by D.
  Sampling requires explicit opt-in and refuses forced reasoning; the cold
  run's first sample establishes the prefix without an extra inference.
  Contrastive sends each binary question and its explicit inverse together
  in one admitted request. Neither technique inherits a calibrated label.
- `startJudgeServer`, with a required `JudgeRuntime` and existing token
  parent directory. It accepts only literal `127.0.0.1`/`::1`, exact bound
  Host, no Origin, and a per-start bearer from a private owner-only file.
  Input/output validation and streamed size limits precede inference.
  Shutdown cancels calls, closes sockets and removes the token. A hard kill
  can leave a private stale token, which never authenticates a restart.

The factory selects no model, creates no backend, reads no API key, starts
no listener and makes no inference call. Existing extension, Model API,
ACP and browser bundles are unchanged in this slice. The new bundle has a
75 KiB cap; the build rejects phase-2 implementations in any other bundle,
missing implementations and duplicated English fallback. Both package
inventories require the new member, and its dependencies enter notices and
SBOM inventories through the production metafile.

Before a dispatcher enables inference, it must inject the canonical D78
durable daily ledger and source policy: a new uncached worst-case claim
before every attempt/retry, first-charge consent with price and shared daily
budget, rebinding after waits, idempotent settlement, known-nonsend refunds
only, and retained uncertain liability. Repeated per-answer cost metadata
must not be summed as separate charges. No production fake or fallback
substitutes for these dependencies.

Independent calibration and paired M75 technique measurements, captured
eligible sources, real-ledger/M80/FIXDEF checks, installed Windows ACLs and
the integrated CLI/VS Code/npm receipts remain open with their owners.
macOS Node/socket/ACL tests and Linux's prior receipts do not certify Windows.
Full quality, coverage and hosted checks run on the lead's final integrated
tree. This slice made zero live, paid or local model calls; the
[integration receipt](certification/m98-p2int.md) records its exact checks,
drills and artifact hashes.
