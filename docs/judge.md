# Muse Judge phase-2 integration

Muse Judge is advisory: an answer never grants an action, skips a question
or replaces a deterministic check. This integration packages B's
offline calibration, D's sampling/contrastive techniques and CS's loopback
boundary, plus G's reviewed bounded CLI/MCP implementation. An explicit
judge command loads the shared factory without starting an ACP connection
or chat backend. Source, admission and offline/surface command adapters
remain required; MCP initialization and tool listing work without inference.
GH, H, J and FU join later, then C/E/A/I/FP after M95. TypeSafe/Jev remains
experimental, untested and opt-in; historical research is not product
certification.

`dist/judge.js` is a CommonJS bundle beside shared `dist/uiText.js` and
`dist/validation.js`,
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
- `runJudgeCommand` and `runJudgeMcp`, preserving G's validated argument,
  request, result and cancellation boundaries, deadlines and bounded stdio.
  Paid dispatch requires the injected durable admission adapter and a positive
  run cap; no fake source or ledger is installed. The CLI refreshes the lazy
  factory's language after its initialization reads the caller's table.

The factory selects no model, creates no backend, reads no API key, starts
no listener and makes no inference call. Compared with the merged 0.13.0
release baseline, extension, Model API and browser startup bytes remain
unchanged. ACP dispatch changes as G moves out of its bundle; the shared
validation bundle adds calibration's existing `lt` check. The judge retains its
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
[round-2 integration receipt](certification/m98-p2int-round2.md) records its exact checks,
drills and artifact hashes.

Round 3 exposes `loadLint()` and `loadHook()` through the same lazy factory.
Their separate bundles install the caller's language before use. Lint keeps
its captured-tree/symbol and admission dependencies; the hook adapter borrows
the parent's existing ask runner. Cursor's five blocking rows are excluded
from the registration list regardless of later neutral-parser changes;
observation rows retain validated caution/neutral delivery. Installed command
and real-source/grammar receipts remain separate acceptance work.
