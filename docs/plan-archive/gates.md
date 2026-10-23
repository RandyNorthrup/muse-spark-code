# PLAN.md archived gate records (section 7)

Gate records moved here from PLAN.md §7 to keep the plan well under the plan
reader's size bound (2026-10-11, lead decision). They are the per-lane
verification notes dated 2026-10-08 or earlier that no open branch touched on
that day. PLAN.md §7 keeps every later record, every record an open branch
touches together with its neighbours, and the records of milestones that have
nothing in a release yet.

Each passage below is unchanged from PLAN.md: the bytes between a
`plan-archive:begin` marker and its `plan-archive:end` (without the blank line
after the first and before the second) hash to the marker's `sha256`, which
`test/unit/planArchive.test.ts` checks for every block; `lines` are the
passage's line numbers in PLAN.md at commit 5161b6476.

<!-- plan-archive:begin id="7-0001" lines="39714-39727" bytes="989" sha256="ab87ae8d4454d3da8134cbec7191d4db918c04fa1eaa507a7d5da26b731cee15" -->

**PORTS017 inherited release checks (2026-10-08, Kubuntu).** The lane
fixes the 21 numeric current-money declarations identified above; the guard
assertions remain unchanged. Fresh owning checks also expose four existing
failures, reproduced with all 41 changed source files restored to `1a2086399`:
`accountUsageBundle` includes the shared USD formatter in its static graph;
`acpNpmReadme` expects adjacent package inputs; two `acpResources` cases omit
an existing built-in report command. Those unrelated bundle/package/command
repairs and integrated full quality remain with the lead. The unchanged
zero-clone duplication gate also retains the two pre-existing ACP/question
clones (`acp/agent.ts`, queued-answer/model-API fixture); new money conversion
clones are removed. No failing case,
threshold or ignore is removed. Full duplication receipts, scoped repairs,
base/drill hashes and final gate exits are recorded in
`docs/certification/int0170-combined.md`, Money ports (PORTS017).

<!-- plan-archive:end id="7-0001" -->

<!-- plan-archive:begin id="7-0002" lines="39729-39735" bytes="554" sha256="a7c8ec3ec6314080a69f9acaf75b14e2899732e30a0f7f85c1bd77042a6accf3" -->

**MONEY017 integrated gate boundary (2026-10-08, Kubuntu).** The assigned rig
brief requires fresh-clone scoped checks and forbids full quality in this lane.
The production build reaches the unchanged size gate and fails only the nine
pre-existing integrated caps: runtimeQuestions, conversation, runtimeEngine,
usagePanel, headless, runtimeAccounts, surface English, Palette and estimator
panel. No threshold or ignore changes. Their repair and integrated full quality
belong to the lead; exact receipts are in `docs/certification/int0170-combined.md`.

<!-- plan-archive:end id="7-0002" -->

<!-- plan-archive:begin id="7-0003" lines="39737-39746" bytes="752" sha256="b6c766377237ae84560ec44170e29cea9dc9e9ea185605ec3bab1c316f4dd698" -->

**MONEY017B inherited inventory gate (2026-10-08, Kubuntu).** The required
`paid*` sweep exposes `paidMoneyPorts`' source-wide numeric-port inventory:
1 failed / 12 passed, with the same 21 entries on `054a9fd12` and the repaired
tree. They span captured account projections, schedule/CLI caps, reporting,
voice and estimator ports; none is added by P2/P3. Do not suppress its assertion
or migrate unrelated protocols in this bounded repair. The lead owns that
integrated inventory reconciliation. Fresh-clone owning regressions and every
assigned static gate pass; the broad sweep remains 588 passed / 1 inherited
failure. The unchanged nine bundle-cap failures remain as recorded above.
Receipts: `docs/certification/int0170-combined.md`, MONEY017B.

<!-- plan-archive:end id="7-0003" -->

<!-- plan-archive:begin id="7-0004" lines="39748-39763" bytes="1260" sha256="14e9d9dfed6fcd0f780007624f1c3d75fb16f746b5d5c7a7832a8a0f72096568" -->

**MONEY017C inherited scoped-gate findings (2026-10-08, macmini).** A fresh
ordinary clone with `npm ci`, `CI=true` passes all five typechecks, changed-file
lint/format, plain knip, localization, reference, host API and plan checks.
The complete assigned-family/host sweep has 1,379 passed / 3 failed (32 files):
`paidMoneyPorts`' same 21 inherited entries, plus two unchanged M52 concurrent
schedule-lease assertions expecting two claims but receiving one. The base
`1a2086399` replay reproduces all three (694 passed / 3 failed in the three-file
comparison). Full jscpd has three base clones in ACP prompts, exact currency
formatting and question fixtures. The one new test clone is removed without an
ignore or threshold change. The separate split audit also fails on the base:
`src/shared/slashCommands.ts` is an unlisted deferred surface. These integrated
findings, the existing nine other caps and full quality remain with the lead;
this bounded lane preserves their assertions/gates. Model API is 521.8/525 KiB
and activation 571.4/600 KiB. Production uploads remain blocked by D85.6's
unrecorded storage decision and M105's capture/binding inventory; no fake receipt
closes them. Detailed receipts: `docs/certification/int0170-combined.md`, MONEY017C.

<!-- plan-archive:end id="7-0004" -->

<!-- plan-archive:begin id="7-0005" lines="39765-39765" bytes="218" sha256="8716193f7655fd9d18863f4d40548d3fa922d823fba6b2375d3b09034517435c" -->

**INT0170 activation repair (2026-10-08, Kubuntu).** `paidConsent.ts` reads zod/mini; activation 1,033,339 → 578,192 B, `navigator` 2 → 0; the split check fails classic zod in a zod/mini Node bundle (`69b0e152b`).

<!-- plan-archive:end id="7-0005" -->

<!-- plan-archive:begin id="7-0006" lines="39767-39767" bytes="254" sha256="38ceb9acc63be3509a03fc3c560b4623ebb429fd0c68d4149ae6041414b60496" -->

**INT0170 headless repair (2026-10-08, Kubuntu).** `WINDOWS_PATH_MODEL_TEXT` and the shared `windowsPathSpelling.ts`; headless 113,255 → 101,878 B and twelve lazy bundles lose `MODEL_TEXT`; the split check fails `MODEL_TEXT` in headless (`b706a89e8`).

<!-- plan-archive:end id="7-0006" -->

<!-- plan-archive:begin id="7-0007" lines="39769-39769" bytes="293" sha256="c95b0d236c7249058dba56fb22437145ef25bcd01f7fdcc64a9bb97617b7a764" -->

**INT0170 Model API pin (2026-10-08, Kubuntu).** `usdSchema.ts` is shared through `dist/modelApiBoundaries.js` (13 bundles, −387 to −564 B each); pin re-measured to 530,883 B, ratcheted down after `m105/media-w2`; the split check fails a copied boundary source (`c1ee73965`, `0a38d850e`).

<!-- plan-archive:end id="7-0007" -->

<!-- plan-archive:begin id="7-0008" lines="39771-39780" bytes="693" sha256="f9b884100025b2146380d524a555753aa58255ba1a2c41724c143cc6928e285c" -->

**SPAWN017C Windows residual (2026-10-08).** Bounded commands no longer
build temp roots, and the runtime prepares its job helpers once. With those
fixes the real-Git schedule regression passes on Kubuntu and the Mac mini.
On win11 it passes at about 10.5 s of its 15 s budget with ten CPUs, but
times out with four, the hosted-runner size. Each governed Windows launch
still starts a launcher and up to six cold PowerShell tree queries (root,
membership, members, usage, retirement). This is the T reader's
per-query design. Removing that cost needs a persistent reader or
launcher-attested retirement. That is a redesign for the lead, not a
third patch. No assertion or deadline is changed.

<!-- plan-archive:end id="7-0008" -->

<!-- plan-archive:begin id="7-0009" lines="39782-39796" bytes="1126" sha256="2ea7031fc28b17217c832662067cbae74db2841eaeca37fef570f9e4345ae3bd" -->

**SPAWN017B scoped delivery and stop (2026-10-08).** Shared common.md forbids
aggregate quality on this lane; the lead owns it. Retain all caps and run
fresh-clone scoped gates. Runtime global admission and bootstrap compilation
are implemented, but the real-Git schedule regression still refuses at native
created-file publication. Binding admission and then moving the runtime
registry to machine storage did not restore it. The shared two-failed-fixes
rule stops further repair of this path; no assertion or deadline is changed.
This is a release blocker, not a governance exemption. Exact qualification
and the remaining native publication work are in int0170-combined.md.
Fresh-clone full jscpd also exits 1 on four inherited clones. The same four
clones reproduce on b6e717f74 and their six files are unchanged by this lane.
The lead owns their joined-tree repair; the zero-clone threshold and all
ignores remain unchanged. All five typechecks, changed-file lint/format,
plain knip, localization, reference and host API pass. Existing candidate
bundle caps remain enforced and failing; the resource bundle fits its cap.

<!-- plan-archive:end id="7-0009" -->

<!-- plan-archive:begin id="7-0010" lines="39798-39847" bytes="3505" sha256="12a0a2bf00bbbadc52b6d72fede6ddde8c1f766e29a81a7365e023ee6c04fb2f" -->

**SPAWN017 (2026-10-08):** the lane brief delegates aggregate quality to
the lead and requires fresh-clone scoped delivery gates. Existing combined
candidate caps remain release blockers; no threshold is changed. Native
compiler bootstrap and the runtime's unbound global admission are unresolved
under the owner's no-exceptions spawn decision, not accepted exceptions.
The spawn inventory and exact receipts are in `docs/certification/int0170-combined.md`.

INT0180B (2026-10-07): source `9733edba2` supersedes INT0180's local reds
below. Fresh ordinary installation, exact static job, all four coverage shards
and merge, full 988-page accessibility, legal's 96 keyboard/zoom plus 24 WCAG
pages, both actual VS Code versions (40 tests each), pinned SAST and pinned
history secrets pass. Unit result: 20,034 passed, 146 existing skips; no added
skip, suppression, default deadline or coverage-threshold change. Startup is
739,475 / 751,411 bytes. Account closure shrinks to 27,338 bytes; its explicitly
authorized D6 cap is 51,200 bytes. Twenty-six guard drills fail and restore exact
bytes. Current completion and command/hash receipts: docs/certification/int0180.md
and docs/certification/int0180b-linux.json.

The remaining external hold is genuine hosted macOS helper input and actual
universal measurement (Q-REL0150M-UNIVERSAL). Helperless VSIX is 2,897,076 bytes,
55,476 over the unchanged 2,841,600-byte cap; four VSIX native members and the
ACP vault member are absent. All independent ACP export/localization/process,
SBOM and asset-hash checks pass. Package job and replayed required aggregate
remain failed; no hosted helper pass or universal cap measurement is inferred.
The lead must supply the genuine artifacts, measure/shrink the universal archive,
apply only its authorized D6 formula if still needed, and rerun package/required.

Historical INT0180 checkpoint (superseded by INT0180B above):

INT0180 (2026-10-07): the four ordered integrations retain every existing cap.
Fresh committed clones measure startup at 752,182 B versus 751,411 B,
residual 771 B. The partial Linux VSIX is 2,889,541 B versus 2,841,600 B;
genuine macOS dictation, signed screen-recorder and vault artifacts are absent.
Contract/price/session splits removed most incoming estimator growth. Further
budget rewrites stopped under the assigned two-fix rule; no waiver is requested
or implied. The regression remains active and final CI reports it. The earlier
vault English fixture deferral was resolved by reader classification; its
unchanged assertion now passes. Fresh-clone performance diagnostics also fail
without coverage (simulation 2.2–3.0 s / 2 s; scrub 20.94 / 50 MB/s). Account
closure remains 77.4 / 25 KiB after two fixture repairs; stop that path. B12
reference/provider-auth disagreement likewise awaits lead review after setup
repairs. The full Linux shards still fail despite passing merged coverage
thresholds. Both latest and floor VS Code ignore nested vault settings beneath
the boolean `museSpark.vault`; resolving that public contract needs lead review
under the assigned no-renames rule. Request-attempt goldens, private vault
bindings, recorder vocabulary, media/CLI contracts and default-deadline failures
remain open. SAST findings remain active, including vault host-pattern matching
and estimator JSON-pointer/HTML handling; no scanner rule is waived. Full CI
records each failure and missing native artifact; no threshold or rule is
weakened. See `docs/certification/int0180.md`.

<!-- plan-archive:end id="7-0010" -->

<!-- plan-archive:begin id="7-0011" lines="39849-39855" bytes="532" sha256="72f6dce62ab6d51c08a42fc0e5d81ef80dc35c070090332f52b81ce3f0015596" -->

**FIX0160W2 scoped Windows qualification (2026-10-07).** The named lane
brief and shared common rules prohibit aggregate quality and delegate it to
the lead. This lane runs complete owned suites with short TEMP/TMP and
repository deadlines, every prescribed individual compiler/static/build gate,
and deliberate byte-exact failure drills. No gate, timeout, assertion or native
guard is weakened. Hosted Windows replay remains the release's qualification;
`docs/certification/fix0160w2.md` records the local evidence and its limits.

<!-- plan-archive:end id="7-0011" -->

<!-- plan-archive:begin id="7-0012" lines="39898-39898" bytes="925" sha256="802a0636d1623a127f11c2065516f8b667f68598373bf2417134d1d2e6c53f5d" -->

**INT0170B VSIX diet stop (2026-10-08).** Exact final package measures 2,874,038 bytes against the unchanged 2,841,600-byte cap, even without the genuine macOS helper. The seven losslessly re-encoded README captures save 91,046 media bytes, but `.vscodeignore` excludes them from the VSIX; this cannot repair its size. A bounded real 51-member solid-archive probe compares quality-11 Brotli windows 22/24 with byte-exact decode and the original 14 MiB output bound: only 934 bytes saved from 4,689,015 decoded bytes, insufficient for the 32,438-byte deficit. The actual installed ACP archive saves zero. No larger window is installed and no member, cap or native requirement is dropped. Shared rules require a fitting bundle or a stop/report; remaining package diet and the actual macOS workflow artifact need separate follow-up. Receipts retain both failed directions and the misleading media-size expectation is corrected.

<!-- plan-archive:end id="7-0012" -->

<!-- plan-archive:begin id="7-0013" lines="39900-39900" bytes="657" sha256="4210f35d39d759d12b91cbc260df12721affafdb0f2fd65e57281872431d5299" -->

**INT0170B journal coverage stop (2026-10-07).** The validated base cache passes the complete normal 10,000-fire file but coverage still reaches 243.543 s against 240 s. A second bounded parsed-delta cache preserves byte checks and cloned ownership; the complete normal journal/store batch passes, including the workload in 192.606 s. Final coverage at `6fa423c56` still times out (journal file 256.598 s). Both new corruption controls fire and are restored exactly; every other journal assertion passes. The shared two-fix stop applies: keep the 240 s budget and report the storage workload uncertified, without a third cache rewrite or deadline increase.

<!-- plan-archive:end id="7-0013" -->

<!-- plan-archive:begin id="7-0014" lines="39902-39902" bytes="893" sha256="e7b5338eb6e4a2df5f036ad80db905b887b9a9eb327bcfd8f4d5bb0ead1dc208" -->

**INT0170B remaining scope stops (2026-10-07).** The current design inventory has 221 files against 112 recorded inputs; 81 current renderers need new scene/selector mappings, theme capture and reviewed PNGs. This complete expansion exceeds common.md’s approximately 300-new-lines-per-finding limit, so no hashes or manifest are rewritten to claim an uncaptured review. Exact Linux replay will still run and retain its failures. The M115 Model API review ratchet also remains red: its private fixture lacked the production text-compression plugin; fixing that makes the legal scanner guard green and measures 483,191 bytes against 474,100. The actual production 475 KiB cap remains intact. Extracting the required additional behavior from the integrated 219 KiB session implementation exceeds that same scope limit; its retained provider/schedule semantics require a separately scoped diet.

<!-- plan-archive:end id="7-0014" -->

<!-- plan-archive:begin id="7-0015" lines="39904-39904" bytes="490" sha256="73a0a6da81d62e2f7b36caad718c36e1d05300eeb719f9afaa194c759ac68aa2" -->

**INT0170B capture/stability setup stop (2026-10-07).** The provisional 20 s hook limit leaves both full files red. Native selector polling at the original deadlines also leaves them red; direct Chrome isolates approval-several's paused-clock readiness wait, while board/deferred/What's New scenes take 1.6–2.5 s each. Stop after these two unsuccessful fixes under common.md. Both provisional changes are reverted; no capture count, source manifest, PNG evidence or deadline is weakened.

<!-- plan-archive:end id="7-0015" -->

<!-- plan-archive:begin id="7-0016" lines="39906-39906" bytes="463" sha256="9ff2e3d33d56858a26f7482f605cfae75b54b26c02bd0e68247e3b9723a68cc6" -->

**INT0170B browser test stop (2026-10-07).** The first repair waited for native mount and closed failed pages but retained 61 failures. A second repair supplied the required `settings.schedules` fake-host field: the panel and capture files pass, while six conversation-review cases still inspect `.tool-toggle` before deferred rows appear. The common two-failed-fixes stop applies to those six cases; no additional timing rewrite or deadline change is attempted.

<!-- plan-archive:end id="7-0016" -->

<!-- plan-archive:begin id="7-0017" lines="39908-39908" bytes="413" sha256="d4f15eb41da44af230313c5c90690e2e9010575e881537fc4571e867822e1448" -->

**INT0170B render-cost fixture stop (2026-10-07).** Awaiting the deferred row failed while the group remained folded; explicitly opening that group still failed the fixture's `/Read t3.ts/` accessible-name lookup. The common two-failed-fixes stop applies; the original row-count and highlight assertions and default deadline remain. This isolated fixture needs a reviewed follow-up, not a performance pass claim.

<!-- plan-archive:end id="7-0017" -->

<!-- plan-archive:begin id="7-0018" lines="39910-39910" bytes="561" sha256="fca2f389dd6650d7f5fc8b59eabb550e4dc55d877c4b545c17fd1cbf3a873c91" -->

**INT0170B exec archive fixture stop (2026-10-07).** Sharing schedule usage through the CLI formatter cleared installed help checks but the exec private fixture still lacked new bundles. Copying the real built JS inputs makes all remaining process/admission cases pass except the single shipping-schema assertion, which requires legacy key-major archive fields from a leaf-major archive. The shared two-failed-fixes stop applies to that remaining case; no archive assertion or production format is weakened. Exact final Linux/package commands still execute it.

<!-- plan-archive:end id="7-0018" -->

<!-- plan-archive:begin id="7-0019" lines="39912-39912" bytes="599" sha256="f64205d413093882cd77c5aafd9bcd859cf657e1e5d05f72df3517bdad5be801" -->

**INT0170B startup ratchet stop (2026-10-07).** The shared stop rule applies after two unsuccessful repairs of the merged first-paint ratchet: lazy tool rows recover about 13 KiB; first-use schedule channel recovers another KiB. The owning regression still sees 751,494 bytes against 751,411.2 (733.8 KiB), and the legacy deferred inventory is 32.9 KiB against its 32.1 KiB review ratchet because diff.ts is newly deferred and shared with ReviewPane. The 900/50 KiB hard build caps pass. Neither ratchet is relaxed; this path remains blocked for owner review while other requested repairs continue.

<!-- plan-archive:end id="7-0019" -->

<!-- plan-archive:begin id="7-0020" lines="39914-39926" bytes="1002" sha256="42b34230f1ee54bcd288cfc1864fd98a176b42795b2e9015ee52b8585d39ad2c" -->

**INT0170 final residuals (2026-10-07).** Exact committed-tree verification
is complete and red. Source commit `a30efbad` and its command receipts are in
`docs/certification/int0170-ci.json`. Full JS lint reaches the original job
limit; CSS lint finds 15 retained raw report/usage fallbacks; four test clones,
the missing reviewed-baseline usage fixture/stale M114 evidence, six SAST
findings and the documented full-shard/package cases remain. Certification is
deferred to a dedicated repair slice: map the retained fallbacks to generated
palette roles while measuring both native and standalone themes; actually
recapture the reviewed visual baseline; resolve fixture/lifecycle/performance
failures and scanner findings without suppressions. The package-fixture path
stays stopped under the shared two-failed-approaches rule. Full standalone
accessibility now passes, but its macOS duration does not certify the hosted
15-minute job. No gate level, assertion, threshold, timeout or byte cap changes.

<!-- plan-archive:end id="7-0020" -->

<!-- plan-archive:begin id="7-0021" lines="39928-39966" bytes="2740" sha256="963285157941f422ea1f3005f7214d6d01e997f754b6e5953f5cb9fe2bf04687" -->

**INT0170 integration certification (2026-10-07).** The lane brief requires
exact macOS workflow jobs in fresh clones, with Node 22 and `CI=true`; these
replace the common brief's scoped-only test restriction for final verification.
Do not run the forbidden aggregate `npm run quality`. All original gate levels,
assertions, coverage thresholds, timeouts and byte caps remain. The first merged
clone exposes inherited M114 audit/source receipts and cold package fixtures in
addition to structural merge bugs. Package-fixture repair stops after two failed
approaches, as the common brief requires: isolated production setup exceeded
the existing 60-second hook, and fake HTTP validation rejected its incomplete
public-tree response. The unproven setup helper and compressor preload are
removed; only actual required fixture inputs remain. Historical M114 receipts
are not rehashed without recapture. These are explicit certification blockers,
not exemptions or a green release claim. Full results and the next repair slice
belong in `docs/certification/int0170.md`; hosted Windows/Linux, editor receipts
and release publication remain the release lane's responsibility.

**CI0150W round 3 certification.** Whole-shard and whole-job reproductions
are explicitly required by `CI0150-os-common.md`; they run with unchanged
default deadlines in fresh clones of local hooked commits. Targeted runs
retain the three-file cap. Early scoped commits can precede aggregate
`npm run quality` while the cross-platform failures assigned to the Linux
lane remain; every failure and final Windows job result is recorded without
weakening gates, assertions or deadlines. A complete quality claim requires
the actual aggregate to exit zero.

The final implementation run at `2548f459` passes the static CI job and all
scoped test files in four complete shards. Aggregate quality stays deferred:
clean/package fixtures remain red, integration has an external release-lookup
timeout, and dedicated browser/credential-store checks have the exact residuals
listed in §3 and the train record. Original coverage thresholds are exceeded;
the merge command still fails because it replays failed package suite setup.
No gate, refusal, assertion, timeout, retry or skip is weakened to claim green.

**FIX0150R scoped certification.** The rig brief requires complete owning test
files in batches of at most three, with three clean `CI=true` repetitions and
individual static/build gates. Shared lane rules reserve aggregate
`npm run quality` for the lead; its whole-repository coverage invocation exceeds
this lane's test-file limit. Defer that aggregate to release integration without
changing any threshold or gate. Receipts are in `docs/certification/fix0150r.md`.

<!-- plan-archive:end id="7-0021" -->

<!-- plan-archive:begin id="7-0022" lines="39968-39995" bytes="1815" sha256="26d99bb598d1ecf1b9c56eed2084f15b4307990621da6fa9be735274f8a1cce3" -->

**FIX0150P scoped release-review verification (2026-10-07, linuxlt).**
The rig/common briefs prohibit a full quality run in this lane. Full quality
and cross-platform release certification remain with the lead; this lane
runs the prescribed complete owning suites and scoped static/build gates
without weakening thresholds, timeouts, isolation or hooks. Detailed red/base
and restored-green receipts belong in `docs/certification/fix0150p.md`.

**CI0150A scoped certification.** CI0150-common.md requires three clean
repetitions of complete owning files and individual static gates; the rig note
caps each test run at three files. Aggregate `npm run quality` includes an
unbounded whole-repository test/coverage run, so it is deferred to integration
under this scoped repair. Hosted OS/release checks also include CI0150B/C work
and are not certified here. This justified deferral changes no gate or threshold.

**TRAIN15H scoped certification.** The lead's rig brief and shared common.md
reserve aggregate quality for the lead. This lane runs complete owning files
under default deadlines and individual gates, including every accessibility
page. No baseline increase, new feature, command, setting or escape hatch.

**TRAIN15G scoped certification.** The rig brief and shared common.md prohibit
aggregate quality here. Run owning default-timeout suites and individual gates;
the lead retains aggregate quality, hosted matrices and native/live receipts.
The sole authorized cap decision is the measured universal VSIX formula above.

**TRAIN15F final package cap hold (resolved in TRAIN15G).** The lead’s new
brief authorizes measured universal +5%, rounded up to 25 KiB after the
shared-browser audit. Actual TRAIN15G packages pass the resulting cap; the
measurements below retain the earlier hold’s history.

<!-- plan-archive:end id="7-0022" -->

<!-- plan-archive:begin id="7-0023" lines="39997-40002" bytes="473" sha256="58e6cb1183d1e64339c1b731f36d8354ce7269117601215e7ef6b789ed23e532" -->

**TRAIN15E D78 deferral (2026-10-06, win11).** Restoring M102's delayed recall
declaration passes its unused-packing-default test but fails 72 train golden
assertions by changing a tool declaration and cache key. Preserve the train's
fixture bytes: all 89 golden assertions pass, while that one D78 test remains
red. No fixture, assertion, timeout or gate is weakened. The precise conflict
and both outcomes are in the train certification; the owner's decision is pending.

<!-- plan-archive:end id="7-0023" -->

<!-- plan-archive:begin id="7-0024" lines="40004-40004" bytes="445" sha256="f56acb538ac4239cf335bd5de221780368869c93c146a04ab148f3df267bb93b" -->

**M113 W rig constraint (2026-10-06).** The explicit rig brief requires individual full gates and the complete test suite in batches of at most three files at default deadlines; its shared rules prohibit aggregate `npm run quality` and public network. This integration runs the named gates individually. Aggregate quality, hosted OS/editor/live receipts and network badge checks remain lead-owned; no threshold, ignore, hook or timeout changes.

<!-- plan-archive:end id="7-0024" -->

<!-- plan-archive:begin id="7-0025" lines="40006-40011" bytes="418" sha256="85bca7c288e72e257e53db2b02cac9a73c1fe87e653f7796043fe2d8247c70ef" -->

**REL0160 README guard (2026-10-06).** The pre-promotion draft belongs in
`docs/certification/rel0160-readme-draft.md` while the manifest is held at
0.14.3. Two existing default-timeout assertions prove the README/contents
version invariant fires; restoring the public headline and link fixes the
mismatch. The draft stays reviewable and will be applied with the main sync
and 0.16.0 bump. No gate or timeout changes.

<!-- plan-archive:end id="7-0025" -->

<!-- plan-archive:begin id="7-0026" lines="40013-40019" bytes="485" sha256="f7a769fbb01094f229c53091328b49104592711b214cd8111903216bf10f1523" -->

**PR132M bounded merge verification (2026-10-06, linuxlt).** Run every
configured Vitest file at repository-defined deadlines in sequential batches
of at most three, then the named compiler/static/build checks. The explicit
lane brief overrides the shared full-suite prohibition for these batches;
aggregate quality and external network gates remain lead-owned. Record
failures also present on main with comparison evidence; never widen gates.
Receipt: `docs/certification/pr132w.md`.

<!-- plan-archive:end id="7-0026" -->

<!-- plan-archive:begin id="7-0027" lines="40021-40048" bytes="2158" sha256="4073c1f8a528a37dcaacc05b9c863e8855e72fee644fe1461405ec605088524b" -->

**REL0160 joined-tree blockers (2026-10-06).** The M106/M107 composition
still refuses `agentImport.js` at 126.3/125 KiB after the bounded retention
repair. Startup measures 746.6 KiB against the inherited 733.8-KiB regression
assertion (the public 900-KiB cap is unchanged). These are failed gates,
not accepted waivers: the lead owns a bounded import/startup diet before
release qualification. This lane stops the failed retention path after its
recorded attempts and completes the remaining requested checks. No threshold
or test is relaxed. The compiled macOS helper is absent on this Linux rig;
universal VSIX measurement and D6’s authorized +5%-rounded-to-25-KiB budget
calculation require that real artifact. Local size alone cannot establish a
universal budget. The final local VSIX measures 2,863,706 bytes against the
unchanged 2,457,600-byte cap; normal build/package and direct size qualification
remain failed. ACP packaging succeeds at 1,960,102 bytes. Main’s release handoff `sync/main-0160` is also absent;
manifest/lock promotion remains held at 0.14.3. See `rel0160.md` for final
individual gate, batch, screenshot and archive receipts.
The immutable pre-K activation-growth regression also refuses the joined tree:
605,188-byte baseline, 678,746-byte current fixture, 73,558-byte growth against
its unchanged 3,072-byte cap. Its minimal externals differ from the full current
production split; neither the immutable comparison nor its threshold is changed.
This remains a lead reconciliation/diet qualification, not a waived pass.
**PR132W scoped Windows certification (2026-10-06).** The rig/shared brief
prohibits aggregate quality/full-unit runs and external requests. Run the
complete built-exec file three times at repository-defined timeouts, prove
the real package validator rejects a fake HTTP 404, compare the main snapshot,
and run scoped static/build checks. The packager's public transport is fake
only in this test process tree; production badge checks, including the CI
skip prohibition, stay intact. Full quality, hosted CI and public pre-release
badge checks remain lead-owned. Receipt: `docs/certification/pr132w.md`.

<!-- plan-archive:end id="7-0027" -->

<!-- plan-archive:begin id="7-0028" lines="40050-40068" bytes="1439" sha256="b92f9ebe560eeeca0d274b589799168d6b863ac395f764e6b0d8676ead199fdf" -->

**REL0160 gate ownership (2026-10-06).** The named shared lane rules prohibit
aggregate `npm run quality`; the release rig brief explicitly authorizes the
complete unit/e2e suite in default-timeout batches, plus the individual delivery
and accessibility gates. This lane commits reviewable release drafts with those
receipts and keeps full aggregate quality/coverage, hosted OS-native checks and
universal publication-artifact validation assigned to the lead. None is waived
or reported green without a receipt. Round 2 joins `sync/m106-final`; release promotion now waits only on
`sync/main-0160`; see `docs/certification/rel0160.md`.
**INFRA015 scoped integration certification (2026-10-06, linuxlt).** The rig
brief authorizes the three named no-fast-forward merges and requires full
accessibility, README preview comparison, owning default-timeout tests, static
checks, production build and a VSIX under the existing 2400 KiB cap. The shared
lane rules prohibit aggregate quality/full-unit runs and external network
requests; integrated quality, coverage and hosted cross-platform certification
remain lead-owned. Packaging retains the existing explicit network-skip reason
for external badge requests while checking staged badge/version contents. This
Linux package cannot certify the separately built macOS dictation helper.
No timeout, cap, hook, threshold, ignore or rule level changes. Receipts:
`docs/certification/infra015.md`.

<!-- plan-archive:end id="7-0028" -->

<!-- plan-archive:begin id="7-0029" lines="40070-40077" bytes="553" sha256="ad9d9c00eb0a42ccc247fedda93f2687d50735028c6d24ab29cf1f6f42a5c24d" -->

**HARNESSWAIT scoped rig certification (2026-10-06).** The rig/shared brief
prohibits aggregate `npm run quality` and full unit-suite runs. Run the complete
harness-owning files at repository default timeouts, intentional red drills,
all accessibility scenarios in four themes, ten visual comparisons, compiler
projects and scoped static/build checks directly on Kubuntu. The lead retains
aggregate quality, coverage and hosted cross-platform certification. No gate,
timeout, hook or budget is weakened. Receipts:
`docs/certification/harness-waits.md`.

<!-- plan-archive:end id="7-0029" -->

<!-- plan-archive:begin id="7-0030" lines="40079-40095" bytes="1258" sha256="99d73986a578be57e1c0ace19ba5118264c990cee9efb117b0931ebdfc7c35e6" -->

**SHOTS bounded-lane verification (2026-10-06).** The rig brief and shared
rules prohibit aggregate quality and full-suite runs. The screenshot lane
runs its complete owning test files with default timeouts, new scenes in all
four accessibility themes, five compiler projects, scoped lint/format,
plain knip, duplication, localization, host API, reference, production build
and actual package size comparison. Full integrated quality stays with the
lead; no gate, threshold or timeout is weakened. The local Linux package
omits the macOS helper, which cannot be built here; both size measurements
use that same content set. External badge checks stay with the lead because
the lane forbids network calls; staged badge/version validation still runs.
**M119 scoped rig certification (2026-10-06–07).** The lane's shared brief
prohibits aggregate quality, full-suite tests, live model calls and unlisted
merges. Complete owning suites at default timeouts and the individual
typecheck, lint, format, knip, duplication, localization, reference, host,
production and four-theme accessibility checks certify the local work.
The lead retains aggregate quality and live recovery/checkpoint captures.
No gate is weakened. See `docs/certification/agent-outcomes.md`.

<!-- plan-archive:end id="7-0030" -->

<!-- plan-archive:begin id="7-0031" lines="40097-40104" bytes="619" sha256="214f165fe62b6273fe099b9e5d7c8cbc64d40d8f7389bd3046d1bde4d076a55c" -->

**FIX0144W bounded Windows repair (2026-10-06).** The rig/shared brief
prohibits aggregate quality and unlisted merges. Scoped default-timeout M118/D89.5
tests, typecheck, changed-file lint/format and individual static/build checks
certify this local commit; the lead retains full hosted quality and release
publication. No timeout, retry, threshold, rule or cap is widened. See
`docs/certification/m118.md` for the lifetime regression and drill receipts.
The continuation's unchanged release/main comparison, completion-event wait,
raw environment probes and restored controls are in `docs/certification/envfence.md`.

<!-- plan-archive:end id="7-0031" -->

<!-- plan-archive:begin id="7-0032" lines="40106-40113" bytes="615" sha256="185d7b439d8c5eff0995ebb8873e1bd0927fc789d79f3cfbe1dc6196c1e6cc72" -->

**REL0144 bounded release verification (2026-10-06, Kubuntu).** The rig brief
requires the complete configured Vitest suite in at-most-three-file batches
with repository-default timeouts, every accessibility scenario in four themes,
all named individual static gates, production and package caps, and live public
badges. The shared rig rule prohibits aggregate `npm run quality`; the lead
retains integrated coverage/quality, hosted CI and cross-platform publication
checks. No threshold, timeout, ignore or cap is widened. Exact receipts and
byte-restored intentional failures are in `docs/certification/m118.md`.

<!-- plan-archive:end id="7-0032" -->

<!-- plan-archive:begin id="7-0033" lines="40115-40120" bytes="452" sha256="fb82311b99b8c147cdff34d401e26e3715dce01b3fb0720aedfe4ea8680aa55f" -->

**FIXM118INT repair certification (2026-10-06).** All five RVM118INT P2s
have regressions and restored red drills; the owning files run directly on
Kubuntu at repository-default timeouts. The repair brief/shared rules prohibit
aggregate quality and unlisted merges, so the lead retains full hosted quality.
No existing gate, budget, timeout, ignore or guard is relaxed. See
`docs/certification/m118.md` for exact results and byte-exact drill receipts.

<!-- plan-archive:end id="7-0033" -->

<!-- plan-archive:begin id="7-0034" lines="40122-40133" bytes="922" sha256="063b9f9dc7ea4d53aeba900180d5b12e93290cf8bc0ee41ca4ca4da99d4231f7" -->

**M118INT bounded integration certification (2026-10-06).** The rig brief
explicitly prohibits aggregate `npm run quality` and requires at most three
Vitest files with three workers per run. This override permits local integration
commits after scoped checks; hosted CI remains the required full release gate.
W binds the P/C/X production consumers and records actual checks, cap measurements,
byte-exact gate-fire drills and editor waits in `docs/certification/m118.md`.
`check:reference` is included in the hosted `quality:gates` sequence.
Runtime sharing scrubs the agent's already-known credential-variable values and,
only on an active Model API ACP backend, its current stored key. Preview and
release refresh those values; a newly sensitive document refuses release.
Local save/list/use never load a key. This closes D98's registered-value contract.
No threshold, ignore, rule level or existing budget is weakened.

<!-- plan-archive:end id="7-0034" -->

<!-- plan-archive:begin id="7-0035" lines="40135-40142" bytes="612" sha256="76a88690b7008c1b85cbb2be261cfe8514e3f146fb321fbe9e59f1be1244afcc" -->

**FIXM118C bounded repair certification (2026-10-06).** All four RVM118C P2s
are fixed with 140 passing tests in 12 owning files and eight deliberately red,
byte-exact restored mutations. All five typecheck projects, scoped lint/format,
plain Knip, zero-clone duplication, localization, host API, schema consistency,
cycles and production build pass on Kubuntu under unchanged caps and gates.
The authoritative lane brief reserves aggregate quality and integration for
the lead and prohibits merge/push/rebase. Receipts and existing W/X handoffs:
`docs/certification/m118-c.md`. No reviewed finding is deferred.

<!-- plan-archive:end id="7-0035" -->

<!-- plan-archive:begin id="7-0036" lines="40144-40184" bytes="2854" sha256="9725e548c047364f353e35f2b90d8e69f587dffb41c378324893a8da760378e9" -->

**FIXM118P bounded rig certification (2026-10-06).** Follow the rig/shared
rules: complete owning test files (at most three per invocation), byte-exact
red controls, typecheck, changed-file ESLint/Prettier, localization, deadcode,
duplication, host API and build directly on macmini. Do not run aggregate
quality or merge/push. W owns full integrated quality, its stale host inventory,
prompt bundle packaging, deferred-surface registration and size recovery;
record actual failures in `docs/certification/m118-p.md` rather than weaken
any threshold. W also owns the integrated CHANGELOG, README and help reference
(the catalog/generator are absent here).

**M118 lane X bounded certification.** The rig brief prohibits aggregate
quality, merges, pushes and other lanes' edits. Run at most three owning test
files per invocation, all typechecks, scoped lint/format, localization,
deadcode, duplication, host API and production build directly on win11. Keep
unbound P/C/TUI/MHP and main/help wiring explicit in the handoff; no fake
production implementation, gate weakening or quality claim.

FIXM118X's review repair checks run directly on Kubuntu under the same bounds.
README/changelog/ACP guide and feature-reference changes remain W's handoff
because the fix brief restricts edits to X-owned files; no installed command
or native-binding claim is made. Full integrated quality remains W/lead's.

**M118 lane 0 bounded certification.** The rig brief and shared rules prohibit
aggregate quality, merges and pushes. Run the owning contracts, typecheck,
scoped lint/format, localization, deadcode, duplication, host API and build
directly on macmini. Full integrated quality remains the lead's. No caps,
thresholds, ignores or rule levels change. Contract-only exports have test
and schema-generator consumers until P/C/X merge; the lead must then check
production consumers and remove any unused contract instead of adding ignores.
**FIXM117I scoped rig certification (2026-10-07, linuxlt).** The specific
lane/shared brief prohibits aggregate quality, full-unit runs, merges and
pushes. Fresh committed source `c129da97` with `CI=true npm ci` passes 42
complete owning files three times (1,806 tests each), default timeouts, five
typechecks, scoped lint/format, plain Knip, duplication, unchanged build caps,
reference, localization and host-API gates. Browser e2e: 11 passed; accessibility:
716 pages, zero violations/undecided rules/exemptions/missing results. Three
unpacked packages pass fake-only engine/wire/first-wave smoke; installed CLI
help passes. Remote badges, Windows PowerShell lint, integrated quality and
installed-editor/cross-rig receipts remain lead-owned. No P1/P2 deferral;
per-node duration evidence and P Slice 2 remain explicit internal work, and
production handoffs remain unavailable. Evidence: `docs/certification/m117.md`.

<!-- plan-archive:end id="7-0036" -->

<!-- plan-archive:begin id="7-0037" lines="40186-40195" bytes="760" sha256="8250272608e0414b642ef8a8247e2616ac60aa166b1cc7f4d5ebcdeceaba5e1a" -->

**REL0143F release CI repair (2026-10-06, Kubuntu).** The complete configured
Vitest matrix passes at repository default timeouts (532 files, 11,430 passing
tests, 72 existing platform/live skips). Required static checks, production build
and VSIX package all exit 0. Four intentional failures have byte-exact restoration
receipts; the shipped fixed JavaScript inventory is exact. The rig/shared rules
prohibit aggregate `npm run quality` and public network: that aggregate, hosted
Windows/macOS, remote badges, native macOS helper and live/editor release receipts
remain with the lead. Packaging uses the existing named offline badge option,
which CI refuses. No gate, hook, skip, timeout or budget was weakened. Evidence:
`docs/certification/rel0143-ci.md`.

<!-- plan-archive:end id="7-0037" -->

<!-- plan-archive:begin id="7-0038" lines="40197-40229" bytes="2263" sha256="bef43e8655014a9f69bf181b12f7cc74c4ab2e40afd6df5660a68653e1b80089" -->

**M112 integration closure (2026-10-06, Windows 11 rig).** The listed U
and A merges close the frozen Q/runtime, History and build-reader handoffs.
The extension supplies its real private store and machine clock through the
first-conversation factory; ACP supplies the real registry and bounded durable
queue through runtimeQuestions.js; exec explicitly declines. ACP owns its
only deadline timer. Queue prefixes are removed durably before dispatch,
restored only before admission, and retired after uncertain admission; a
crash before dispatch can lose a prefix, avoiding an unsafe replay. Initial
corrupt-store failures are observed immediately, and failed flushing cannot
prevent backend/journal shutdown. The exact existing answer text stays intact.

The question cards, dock body and action/outcome rendering use a measured
25 KiB lazy browser closure. ACP question/elicitation handling, runtime
registry/queue and the first-deferral notes use separate measured 25 KiB
ceilings; every existing aggregate/hard cap is unchanged. QUESTION_MODEL_TEXT
is read only by questionNotes.js; QUESTION_DELIVERY_MODEL_TEXT only by
conversation.js and runtimeQuestions.js. Both are guarded. The baseline and
all production artifact measurements, owning suites and failure drills are
in docs/certification/m112.md.

The rig brief prohibits full quality locally; hosted CI owns that gate.
Round 2's unchanged zero-duplication gate exposed two repeated setup blocks
in U's new dock priority regressions; share only those test fixtures and
retain every assertion. The MCP accessibility fixture uses its existing
bounded field waiter so the new lazy dock is measured after it renders.
check:reference, featureCatalog.ts and its generator are absent on this base,
so HELPREF must add the named dock, setting, navigation, ACP commands and flag
when its sources arrive. Native MHP adapters/envelopes are absent; acceptance
12 certifies only shared schemas/fakes, with M104b–d/M110a0/M111b handoffs
named in the record. Live model behavior, installed editor keys, README
shots remain release-lead checks. U's review continuation is merged in round 2;
its startup target waiver is recorded in §9. No paid/live
call, dependency install, cap increase or gate suppression was made.

<!-- plan-archive:end id="7-0038" -->

<!-- plan-archive:begin id="7-0039" lines="40287-40313" bytes="2005" sha256="ca7cd3acc65172ba90ebf5ec8ecac2862ed46cb375e34db31b566865c468e484" -->

**M113-L0-RVM113L02 bounded rig certification (2026-10-06).** The brief
reserves aggregate quality for the lead. Run complete owned unit files with
default timeouts and the scoped static/build checks directly on Kubuntu;
record exact-restoration drills in lane 0's certification. The seven existing
unused manifest keys remain W's wiring handoff; no gate is weakened. Full
integrated quality and native-host implementation remain the lead's work.
**M114 F scoped certification (2026-10-06).** The rig/shared brief prohibits
aggregate quality and assigns it to the lead; F runs owning files, default
Vitest timeouts, deliberate failures and static/build/package checks directly
on Kubuntu. Existing startup/deferred/VSIX caps are unchanged. The runtime-only
font installer has a measured-plus-15%, rounded-to-25-KiB budget of 25 KiB;
the font pack's own 675 KiB budget uses the same rule. README/CHANGELOG remain
S-owned; complete additions and the absent featureCatalog rows are supplied in
`design/fonts/README.md`. M104/C, M110/N and M111/D bind F's explicit appearance
and asset ports; no production fake stands in for them. The lead must publish
asset commit `52af8cef9` before advertising pinned online installation and add
`src/runtime/fonts/fontsEntry.ts` to the package.json cycle entry list (lane 0's
script region). F runs that entry's cycle check directly. The S-owned host-API
record needs F's Node use counts (crypto 46→47, fs/promises 47→48, path 84→85)
alongside lane 0's existing theme-source inventory repair. ACP startup grows
1,162 bytes from this base, within its 2 KiB target; the separately budgeted
installer and manifest add package bytes beyond that target. All hard caps hold.
The asset-range `git diff --check` flags two original OFL trailing spaces
(Cascadia line 22, JetBrains line 21); exact upstream licence bytes are retained,
and no whitespace rule or gate is weakened.
All receipts and guard restore hashes are in
`docs/certification/m114-f-fonts-and-licences.md`.

<!-- plan-archive:end id="7-0039" -->

<!-- plan-archive:begin id="7-0040" lines="40315-40320" bytes="447" sha256="3bedca4842fca456b084de0ff8e958efc70c04c5ea6bea19f5107779de0de145" -->

**M113-L0-RVM113L02 bounded rig certification (2026-10-06).** The brief
reserves aggregate quality for the lead. Run complete owned unit files with
default timeouts and the scoped static/build checks directly on Kubuntu;
record exact-restoration drills in lane 0's certification. The seven existing
unused manifest keys remain W's wiring handoff; no gate is weakened. Full
integrated quality and native-host implementation remain the lead's work.

<!-- plan-archive:end id="7-0040" -->

<!-- plan-archive:begin id="7-0041" lines="40322-40329" bytes="596" sha256="1ebceb464307f939a448fce738260af4f8ff4ab1dbde41126120ce9c674349a9" -->

**M106 W integrated-tree gate boundary (2026-10-06, macmini).** The owner's
rig brief delegates aggregate `npm run quality`, full coverage, the four-host
matrix, live/M75 receipts and release qualification to the lead. W runs scoped
checks and keeps every threshold unchanged. Native effort/feedback/deletion
ports await the scrubbed MSP captures; M95 capability-record and M96/M96c
bindings absent from this prescribed merge base remain explicit typed handoffs.
See `docs/certification/m106.md` and the W gate-fire record for actual results;
this statement does not certify the whole milestone.

<!-- plan-archive:end id="7-0041" -->

<!-- plan-archive:begin id="7-0042" lines="40544-40560" bytes="1248" sha256="946ddfbd0fb5d1c96e26632cc51441cfa2b375c478619c322ec13744dee86007" -->

**FIXM106R review and bundle repair (Kubuntu, 2026-10-06).** All four
RVM106R P2s and its P3 are fixed, with failing guard drills and byte-exact
source restoration. `npm run build` exits 0: original deferred UI 49.9/50 KiB,
exclusive pacing UI 1.1/25 KiB, eager webview 894.6/900 KiB, Model API
452.3/475 KiB and activation 437.0/600 KiB. The split gate verifies pacing
only in its lazy Model API inventory and the dynamically loaded status row.
The prior R-BUNDLE deferral is closed. Full quality, coverage, accessibility,
live and platform checks remain the lead's gates under the rig/common brief.
No dependency, existing cap, timeout, hook or protocol guard is weakened.
**FIXM106S3 scoped review certification (2026-10-06).** The rig brief
requires the repository's default test timeout, at most three files and
three workers per run, hook-on commits, and no aggregate quality or merge.
Four regressions fail under deliberate mutations restored byte-exact, and
268 final tests pass without skips. Typechecks, scoped lint/format, deadcode,
duplication, localization, host API and production build pass. Receipts are
in `docs/certification/m106-s.md`; integrated quality remains the
lead's gate, with no gate, hook, timeout or size cap changed.

<!-- plan-archive:end id="7-0042" -->

<!-- plan-archive:begin id="7-0043" lines="40562-40568" bytes="519" sha256="f6ad0538b74e667f26796cf5c79636c0253e407ee8b4bf1bf776a6d6a464b883" -->

**FIXM106S2 scoped review certification (2026-10-06).** Both RVM106S2
P2 findings are fixed by construction; the three-file repair batch passes
132 tests at the repository timeout. Eight deliberate mutations fail named
regressions, with SHA-256 verified byte-exact restoration. The ten observer
invocation sites all use the shared `notify` utility. The rig's prohibition
on aggregate quality and merging still applies; the lead retains that gate.
Full scoped verification is recorded in `docs/certification/m106-s.md`.

<!-- plan-archive:end id="7-0043" -->

<!-- plan-archive:begin id="7-0044" lines="40603-40613" bytes="846" sha256="3562bd03aeb2a16ee7b6ce887da9639f66404a2df85b6df3f589c66bb90fb48f" -->

**FIXM106T budget recovery (2026-10-06, macmini).** The authorized correction
loads `sessionTransfer.ts`'s import sanitizer from the existing lazy
`dist/hookRuntime.js`, installs the caller's language at use, and passes its
English model-text block without duplicating that block into the lazy bundle.
`npm run build` exits 0: Model API is 484,569 bytes against the unchanged
486,400-byte cap (1,831 bytes free); hook runtime is 48,808 against 51,200.
An eager-import red drill fails the same size gate at 487,584 bytes; split,
language and invalid-export regressions also fail under deliberate mutations,
with source restored byte-exact. The historical budget blocker above is resolved
on this lane. Aggregate quality/coverage and installed/live qualification remain
with the lead under the bounded-lane brief; no cap, hook or gate is weakened.

<!-- plan-archive:end id="7-0044" -->

<!-- plan-archive:begin id="7-0045" lines="40615-40637" bytes="1780" sha256="adf0028120873fe45d9f4c7647385157b61ed36967c31602b17e136008acb665" -->

**M102INT3 round 3 (2026-10-06, Win11).** The rig brief forbids the full
quality wrapper and authorizes bounded owning suites and individual gates.
RequestTransport owns allowlisted headers, retry observations and first-token
timing for Meta and CodecClient. Configured admission forwards recorder metadata.
ACP usage rendering/aggregation and headless execution load on first use.
The production headless provider success test failed after preserving observer
metadata and correcting its fake credential; the shared two-failed-fixes rule
stopped that path. The attempted provider runner/ledger changes were removed.
M95's explicit refusal before dispatch remains. Headless BYO journal/page/CLI
success and ACP/headless shared paid-daily admission remain open. The missing
feature catalogue, reference generator and check:reference script remain a
lead prerequisite. The exec stdio fixture retains all strict validators and
now supplies complete joined package inputs and the usage archive in its cache.
Its final receipt is 38 passed, 1 failed, 3 existing Windows exclusions: the
first cold package/export build exceeds the unchanged 30-second command bound.
Adding the missing headless member and then replacing incomplete inert inputs
were the two fixture fixes; stop this path under common.md, without widening
any bound or dropping a check. The production build and all JavaScript caps
pass; the helperless VSIX fits, but the universal VSIX exceeds its unchanged
2,252,800-byte cap. Stop that package path without raising the cap. The real
ACP package passes its localization and native export checks. This is a local
integration checkpoint, not a green release/coverage proposal. Existing caps
are unchanged. See docs/certification/m102.md for the exact final measurements.

<!-- plan-archive:end id="7-0045" -->

<!-- plan-archive:begin id="7-0046" lines="40639-40676" bytes="2630" sha256="72fbfe293a5add7ca5359e8b23238a84ac9384a7df807d6037833280bcf28edc" -->

**M102INT2 round 2 (2026-10-05, Win11).** The new rig brief authorizes one
complete quality wrapper after the individual gates and authorizes pinned
PSScriptAnalyzer installation. This supersedes the original local exclusions
below. R/U and both diet merges are present with hooks. Shared browser React,
solid usage contrast, explicit surface capabilities, bounded encoded exports,
validated OpenRouter observations, read-only Tab/conversation budgets and the
platform-independent opener simulation are implemented. Packaged localization
reads the UI archive by locale and checks the separate solid usage archive;
both VSIX and ACP retain all 14 source objects. Exact lazy code members have a
deterministic compression order, and a bounded ZIP repack verifies all VSCE
decoded members before replacement. The function/surface matrix, HELPREF inventory (no catalogue
on this base), failing guard drills and exact measurements are recorded in
`docs/certification/m102.md`. Kubuntu rendering timing is measured by the lead
on Kubuntu, not fabricated here. Native IDE installation and hosted CI remain
their owners' release sign-off, distinct from the nine browser route receipts.

The one authorized full quality attempt exposed stale package frame names,
the confirmed-contributor path omitting its confidentiality warning, and an ACP guard fixture that
predates the usage assets/archive. Repair those without weakening assertions
or production guards. Its Windows five-second default test deadlines and the
GNU tar drive-path error are recorded separately; scoped rig runs retain the
brief's 120-second CLI limit. Do not repeat the full wrapper or raise a deadline.
Run its unreached checks individually and retain the original result in the
certification; a fresh aggregate coverage run remains a lead gate.

The unreached audit refuses high advisory `GHSA-68fv-2mgg-jv7q` in
`source-map-js` 1.2.1. Registry metadata reports fixed release 1.2.2 and no
peer dependencies. A lockfile-only exact override attempt is refused by the
repository's seven-day minimum release age (ETARGET); the attempted override
is removed. No age bypass, audit exception, threshold change or shared-install
mutation is made. Dependency remediation and fresh aggregate coverage remain
required before release.

The separately run SAST exits 1 with nine blocking findings in the merged
makers research, plugin child-process adapter and companion launch HTML,
plus five reported rule timeouts. No suppression or deadline change is made.
These require review and remediation before release; focused M102 receipts
do not certify the aggregate security gate.

<!-- plan-archive:end id="7-0046" -->

<!-- plan-archive:begin id="7-0047" lines="40678-40700" bytes="1676" sha256="d735c11e93ca239c59e8ef9784c7aeaf581194b6148e425648a24e3c108b8007" -->

**M102INT local gate scope and deferral (2026-10-05, Win11).** The rig brief
requires composed lane tests (at most three files per run), types, scoped lint
and format, plain knip, duplication, localization, cycles, host API and all
build/package caps; it explicitly forbids full quality here. The three-call
real-host fixture, shared totals, JSON export and bearer companion pass. The
Linux foreground opener lifetime case times out on Win11 after two repairs
(cleanup of an already-dead supervised child; no stdin reader for non-stdio
commands). Under the common two-fix stop rule this path is deferred to the
lead/POSIX rig, with its failed receipt retained; it is not skipped and no
timeout rises. The earlier isolated Kubuntu E receipt remains separate from
this composed Win11 result. Native-editor installs, universal-helper VSIX,
Kubuntu first-render timing, hosted CI/full quality and incoming U/R review
repairs remain final certification work, not local passes. Exact receipts
and acceptance rows are in `docs/certification/m102.md`.
**FIXVSIX2 scoped certification (2026-10-05).** RVMVSIX2 P1 and P2 are
fixed. All 78 owning unit tests and 49 native packaged-module tests pass,
with declared-export, private-reader and absent-dist red drills restored
byte-exact. Typecheck, scoped lint/format, Knip, duplication, localization,
host API, cycles, production caps and both package commands exit 0.
Universal VSIX is 2,033,170 bytes, with 219,630 bytes headroom; activation
is byte-identical. The rig brief reserves aggregate quality/coverage and
installed-editor/platform certification for the lead. No gate is weakened.
Receipts: `docs/certification/vsix-diet-2.md`.

<!-- plan-archive:end id="7-0047" -->

<!-- plan-archive:begin id="7-0048" lines="40702-40711" bytes="761" sha256="4817d66919bfc74b9b5209d9f04f6ee5c652a449a99a92dd2814745a93e2b3a9" -->

**VSIXDIET2 scoped certification (2026-10-05).** This lane's explicit shared
rules prohibit aggregate `npm run quality`/full-test runs and reserve coverage
and installed-editor/platform certification for the lead. Its required scoped
gates pass: 286 tests in 17 complete files, five-project typecheck, changed-file
lint/format, localization, host API, Knip, zero-clone duplication, cycles, all
production caps and universal/ACP packages. Ten faults reject and restore
byte-exact. Universal headroom is 221,523 bytes with byte-identical activation;
the full member table and receipts are in `docs/certification/vsix-diet-2.md`.
No threshold, ignore, test skip, timeout or gate is weakened. This local lane
handoff does not claim aggregate release certification.

<!-- plan-archive:end id="7-0048" -->

<!-- plan-archive:begin id="7-0049" lines="40713-40750" bytes="2640" sha256="f24dfce706e67c7cc5d565ef1f90ac2ecfba0f63bb1825a52cfabda0b0e83dae" -->

**M95R5 integration (2026-10-05).** T's actual transport/codec/auth path
is joined to configured inference and scans, and X's free terminal probes.
The sanitized X squash excludes its scanner-flagged history; range scanning
has zero findings without an ignore. Shared validation's existing `safeParse`
export resolves X's old split blocker. Runtime provider management uses the
same credential envelope as the panel and the newer endpoint wizard guards.
The rig explicitly authorizes hook-enabled local integration checkpoints
before its single final quality receipt; these do not propose a release.
Headless `ExecDeps.runProvider` still has no production accounting runner:
its input assembly is wired, but the current ledger/fetch boundary assumes
Meta's endpoints, tariffs and context bound. T does not supply that runner.
Keep the explicit pre-dispatch refusal until T/I implements provider-aware
admission and settlement; no unbudgeted success. The absent feature-catalog,
reference generator and check script remain a lead integration prerequisite.
Actual suites, caps, drills and the final quality tail are recorded in
`docs/certification/m95-r3.md`, round 5.

The sole R5 aggregate run on `003e55f2` exits 1: all static gates pass;
coverage reports 31 failures in 12 files (12,244 passing, 99 existing skips).
Repair the confirmed stream-payload redaction, legacy resolved-origin,
structural Tab error and command-parser regressions without changing their
assertions. Pin native Windows tar in the remaining package fixture.
Executable content keeps its syntax while exact request-key echoes, including
JSON-escaped keys, are removed; diagnostics keep the full scrub. Continue only
complete owning suites and individual gates; the brief forbids a second
aggregate wrapper. Record the four checkpoint shutdown failures and five
package timeouts honestly, even if scoped reruns pass. Final aggregate
coverage and release certification remain a lead prerequisite.

Final independent production package, static, audit and SAST checks pass;
the certificate records final caps and 1,053 scoped test passes. The entire
repaired HEAD history and required merge-base range scan have zero findings.
The unchanged default all-ref secret gate still finds the known original-X
line at `0bffa2de…:docs/certification/m95-x.md:73`, outside HEAD's ancestry:
the brief requires retaining that original ref, not rewriting it or ignoring
the finding. Its disposition remains with the lead. Final-tree a11y is
unreached by the one failed wrapper and cannot fit the remaining time box;
the previous 764-page pass is evidence only for its earlier tree.

<!-- plan-archive:end id="7-0049" -->

<!-- plan-archive:begin id="7-0050" lines="40752-40762" bytes="805" sha256="e76b9b19577c1d6cf500e70f71158e321879ff5fc04e888855feff1482473099" -->

**FIXM95N scoped proof and delegation (2026-10-05).** The user-invoked
FIXM95N/common.md brief forbids a full quality run in this lane and delegates
combined certification to the lead. All seven review findings are fixed:
477 owning tests across 12 files pass on Mac mini; subsequent affected media
and fixture sweeps pass; all 12 mutations fail their named regressions,
restore SHA-256 exact and pass restored suites. Required typecheck, changed
lint/format, deadcode, cycles, duplication, localization, host API and full
production build/split/globals/notices checks pass, without gate changes.
Exact receipts and the initial lint/duplication corrections are in
`docs/certification/m95-n.md`. Full quality, package/editor/live proof and
the missing release ref remain named lead-owned residuals in §9.

<!-- plan-archive:end id="7-0050" -->

<!-- plan-archive:begin id="7-0051" lines="40764-40795" bytes="2333" sha256="0a8de4e9a865ca847b8827fa272c0a1c729f44026df4b1e0ea966b6baf2b85dc" -->

**M95 N package gate remains open (2026-10-05).** CAPREC's eight targeted
static/build gates and final owning suites pass; all seven red drills fail
as intended and restore hash-exact. The real universal-helper VSIX is
2,454,970 bytes against the unchanged 2,252,800-byte cap. This is a recorded
release deferral, not a waiver or a release-ready claim. The lead owns the
combined package diet/release integration; this lane does not raise the cap.
The prescribed `integrate/m72-on-24ff` ref is absent locally and its replacement
is pending. Receipts, base comparison and remaining work are in
`docs/certification/m95-n.md`.
**M95-I dependency and acceptance limits (2026-10-05).** The rig brief
requires scoped gates, not full quality or a dependency merge. The lead owns
full quality and integrated live acceptance. The five wire-format tests use
real codecs, captured frames and real host tools through a test-only client;
they do not certify lane T's missing production transport, credentials or
redirect policy. W must assemble the registered production factory and panel
seam; N supplies capability provenance/native effort metadata; P2 owns
one-hour-write settlement; CAPPAR owns paid feature observers and picker
consumers. No stub or guessed transport is shipped, and no support claim is
made until those dependencies and integrated gates pass. Native hosted search
on BYO needs its separately captured tool/price adapter; capability evidence
alone cannot prove that route. No gate is weakened.
**M95BINT rig delegation (2026-10-05).** The explicit integration brief
requires whole-file lane suites with at most three files and three workers,
all five typechecks, scoped lint/format, deadcode, duplication, localization,
cycles, generated host API and every production cap. It expressly forbids
full quality on the shared rig; the lead must run `npm run quality` before a
release/commit proposal is accepted. Local commits preserve reviewable work
with unchanged hooks. No test, threshold, timeout, rule or ignore is relaxed.
Acceptance 9 remains deferred because the base has no general M95 transport
composition; the panel's ordinary provider ports continue to throw their
explicit unavailable error. Building that missing prerequisite exceeds this
subscription integration lane. No API-key/plan-key success is fabricated.

<!-- plan-archive:end id="7-0051" -->

<!-- plan-archive:begin id="7-0052" lines="40797-40802" bytes="437" sha256="9699e22a6c7e6e9ba188aebd7d2350d734698972d1e6323fabd082d2e1862a8b" -->

**FIXM95BC gate boundary (2026-10-05).** The rig/common brief prohibits
aggregate `npm run quality` and full-test runs in this lane; the lead owns
that gate on the integrated tree. Run the owned codec suites and required
static/build checks directly on Kubuntu with every existing gate unchanged.
Shared README/CHANGELOG updates remain lane W's work. Results and deliberate
failure drills are recorded in `docs/certification/m95b-c.md`.

<!-- plan-archive:end id="7-0052" -->

<!-- plan-archive:begin id="7-0053" lines="40804-40810" bytes="522" sha256="2fb40b0c37107e7c14ac9a314c6c37158833203e9cfc32f99a3cb3a62fa1ee0f" -->

**FIXM95BV gate delegation (2026-10-05).** The rig/common brief expressly
forbids full quality and complete test runs in this repair lane, and the rig
note forbids integration merges. Run the two owned suites, required scoped
static checks and production build here, with hooks enabled for every commit.
The lead must run `npm run quality` after integrating subscription contracts
and the blocked V panel path. No gate or threshold is weakened; the offline
adapter certificate does not certify an integrated M95b release.

<!-- plan-archive:end id="7-0053" -->

<!-- plan-archive:begin id="7-0054" lines="40812-40827" bytes="1122" sha256="6ce19241ffa6a933bbb8ad6c84fafc531ea6d0a1a5bc8880995dfa3684743f49" -->

**FIXM95BX scoped gate delegation (2026-10-05).** The rig brief/common.md
reserve full quality for the lead and prohibit merge/rebase/push. Run scoped
whole-file suites and local type/lint/format/deadcode/duplication/l10n/build
checks without changing a gate. `providersPolicy`'s simultaneous-save test
intermittently hits Windows EPERM on rename. This was reproduced with the
byte-original `9e4be782` providersFile source (24 pass, one fail), then the
repair source was restored with SHA-256 equality. The unrelated atomic-writer
repair belongs to lane P/integration; this is a named validation deferral,
not a green receipt or a relaxed assertion. The existing broad execStdio
suite cannot start without Bash on this rig; the focused real npm-pack
regressions run here without it.
The host API check retains exactly the four stale Node import counts in the
original RVM95BX report (crypto 35→36, http 3→4, net 4→5,
timers/promises 3→4). Regenerating that shared inventory belongs to the
integration lane; record BX-HOST-API-INVENTORY rather than expanding this
repair's file ownership or claiming a green check.

<!-- plan-archive:end id="7-0054" -->

<!-- plan-archive:begin id="7-0055" lines="40829-40864" bytes="2550" sha256="0f3aa528d9b7bc701e51d9322cea4e029ecfcee309cdfdf414fce6a23d3ffd50" -->

**FIXM95BU gate boundary / M95BU-R-composed-gates (2026-10-05).**
The rig brief forbids full `quality`, full coverage and merges here; the lead
runs aggregate acceptance. Scoped tests, five-project typecheck, lint,
formatting, localization, knip, duplication and production build run here.
The host API check has its inherited sole count mismatch: the stored inventory
has 35 `node:crypto` imports, source generates 36. API membership is unchanged;
this UI repair adds no Node import. W/lead owns the generated inventory and
must run `npm run check:host-api -- --write`, review it and rerun the unchanged
gate on integration. No gate is weakened; receipts are in
`docs/certification/m95b-u.md`.

**M95INT final whole-chain rerun — deferred under the 120-minute rig brief.**
The final 548-page rerun still returns 1: `dark/models-pick` has one selected
description at 4.41:1 contrast (4.5:1 required), and `hc-light/models-table`
hits the harness readiness error. The other 1,068 initial violated elements
and all 869 undecided contrasts are resolved. M/W must repair those two
remaining outcomes and rerun accessibility plus the complete quality chain.
The common brief's stop-after-two-fixes rule and the elapsed timebox end
further UI repair here. No exemption is added and this gate remains failing.
The completed SAST call also returns 1: one dynamic-RegExp finding in
`src/core/providers/presets.ts:53` and three manual-HTML-escaping findings
in `src/host/providers/oauthLoopback.ts:32`, plus scan timeout warnings.
These P/K security surfaces belong to the explicitly pending S lane;
that lane must repair/review the findings and obtain a complete clean scan.
No ignore, suppression, timeout or dependency is changed here.
The complete `npm run quality` reached accessibility after every
`quality:gates` check passed: 7,376 tests, coverage and all production caps.
Real Chrome then exposed the combined panel routing/style/markup failures
recorded in `docs/certification/m95-int.md`. The shared causes were repaired,
and the final full browser gate plus affected unit/type/lint/build/security
checks are rerun directly. A fresh complete wrapper run after those last
repairs belongs to the lead: the browser CLI stall and two full browser
sweeps consumed the lane's explicit timebox. No gate, rule, exemption,
threshold or timeout is weakened. This defers only the final whole-chain
receipt, the two named browser failures and the four SAST findings; see the final
record for the actual exit codes. Do not describe the final wrapper as green.

<!-- plan-archive:end id="7-0055" -->

<!-- plan-archive:begin id="7-0056" lines="40866-40871" bytes="420" sha256="644d560db07e67457cd8aaacc6fbb07f6198e17622d61ee1a6a0b37a46149f37" -->

**FIXM95P host API record deferral — closed by M95INT (2026-10-05).**
Integration regenerated the complete record (276 APIs, 22 adapters, 23
Node built-ins, 59 theme variables) and the unchanged check passes. The
combined-tree diff includes crypto 33→35, fs/promises 34→35, net 3→4,
path 65→66 and the Models panel stylesheet in the theme source list.
The original isolated-lane report follows for provenance.

<!-- plan-archive:end id="7-0056" -->

<!-- plan-archive:begin id="7-0057" lines="40873-40885" bytes="880" sha256="1d1cb45e5ed88c38f924ebe0c83b0dad0c7984d5360a8b47f05e04158138e7e3" -->

**FIXM95P host API record deferral (2026-10-05).** The scoped rig check
finds only four stale Node import counts in
`docs/ide-compatibility/host-api.md`: crypto 32→34, fs/promises 34→35,
net 3→4, path 65→66. The lane brief restricts changes to lane P files;
the generated integration record is outside that scope. Keep the gate
unchanged and failing until integration regenerates it with
`npm run check:host-api -- --write` and verifies the resulting diff.
No portable-to-VS-Code boundary or host API mismatch was reported.
**FIXM95G build deferral — closed by M95INT (2026-10-05).**
All three landed codecs build only into `dist/providers.js`; the split
guard requires each there and rejects codecs/provider core in every other
JavaScript output. Presence and exclusion drills fail as expected and
restore byte-exact. The original lane deferral follows for provenance.

<!-- plan-archive:end id="7-0057" -->

<!-- plan-archive:begin id="7-0058" lines="40887-40938" bytes="3765" sha256="aca8c95efa41100a042afacde310e66fcc7e4c18832b611cad9347fe3786ee3b" -->

**FIXM95G build deferral (2026-10-05).** The correction lane fixes all six
assigned Gemini review findings and runs the required focused gates on
Kubuntu. `npm run build` generates all production bundles within their
unchanged caps, then exits 1 at the existing bundle-split gate because
`src/core/backends/modelapi/codecs/gemini.ts` is on neither classification
list in `scripts/check-bundle-split.mjs`. This unwired codec and missing
registration predate the fixes. Gate-script/provider integration ownership
is outside lane G; the brief prohibits widening this lane's files or any
guard. No ignore or rule is changed. Follow-up: the lead's integration lane
classifies/wires the provider codec under D74's lazy-bundle contract, reruns
the build and combined full quality, and records certification before
release. `docs/certification/m95-g.md` records the failed build and the
separately run later build checks; no successful full-build claim is made.
**FIXM95A gate delegation (2026-10-05).** The owner's rig brief expressly
forbids a full `quality` / full-test run and integration merges in this
lane. Local focused suites, five-project typecheck, scoped lint/format,
localization, host API, knip, duplication, cycles and production build run
here; the lead must run full quality on the integrated tree. No threshold,
ignore or rule is weakened. `docs/certification/m95-a.md` records results.
M95 K repair: FIXM95K/common.md delegates full quality to the lead. The new
activation-growth test passes at 2,901 bytes versus 3,072; no threshold
or test was weakened. Final M/U integration remains a certification gate.
**FIXM95H gate boundary (2026-10-05).** The rig brief requires scoped
tests and static/build checks here; full `npm run quality` is the lead's
integrated gate. Chat's existing bundle-split registration failure belongs
to lane W, which the brief explicitly forbids this lane from editing. Keep
the gate unchanged and record its exact failure and passed size budgets in
`docs/certification/m95-h.md` before integration.
**FIXM95SC gate deferral: RVM95SC-R-host-api-record (2026-10-05).** After
required merges, `npm run check:host-api` exits 1 solely because generated
`docs/ide-compatibility/host-api.md` has stale Node import counts:
`node:crypto` 32→33, `node:fs/promises` 34→35, `node:net` 3→4,
`node:os` 6→7, `node:path` 65→66. Membership and API rows have no reported
difference; the fresh receipt reports 279 VS Code APIs, 19 importing files,
23 Node built-ins and 57 theme variables. FIXM95SC's redactor import is
unchanged; its new imports are test-only. The generated record is outside
the lane brief's allowed files, so lane W/lead must run
`npm run check:host-api -- --write`, review these five counts and rerun the
unchanged gate on the integrated tree. No gate is disabled or weakened, and
this lane does not claim all gates or full quality green. See §9 and the
S/C certification records.
**FIXM108M/M2 bounded-lane certification (2026-10-06).** The overriding rig
brief and shared rules prohibit aggregate quality/full unit runs, merges and
network calls. Use complete owning test files, repository default timeouts,
at most three files/workers per run, scoped static/build checks and normal
hook-on local commits. The lead owns integrated quality/coverage and live
editor/capture gates. W owns the pre-existing host-API record count drift and
CHANGELOG integration; no gate is weakened. **M2-W-HOST-API:** the current
record check is red for crypto 46→47 and path 84→85 (existing), plus the
account adapter's child_process 13→14 importer. There is no host boundary
violation. W must regenerate/review its owned host-API record and rerun the
gate in integration; this lane does not change that out-of-scope record.

<!-- plan-archive:end id="7-0058" -->

<!-- plan-archive:begin id="7-0059" lines="41218-41256" bytes="2808" sha256="db8a1536f8cfc3786455c71c005c1ae3c0b06ce14dc9d18774ad314d3ac8de49" -->

**CIFIX14M bounded macOS certification (2026-10-05).** The explicit lane brief
requires all four unit/process-e2e coverage shards and two complete green runs.
The rig note overrides the shared prohibition on full suites for that work,
while retaining its three-file/three-worker batches. Shared rules still prohibit
`npm run quality`; hook-on commits use scoped regressions, typecheck, lint and
format, with the available static/build checks and merged coverage recorded in
`docs/certification/cifix14-macos.md`. The lead retains the integrated aggregate
quality, accessibility and hosted certification. No gate is weakened.
**CIFIX14W Windows hosted-CI repair (2026-10-05).** Reproduce all four unit
and process-e2e shards on the Windows 11 rig, in the rig brief's bounded
three-file batches with V8 coverage, then repeat the complete suite twice
after repairs. Correct foreign-platform fixtures with explicit path/platform
semantics and make in-memory bundle tests independent of existing `dist`.
Check the real PowerShell directory case before deciding whether product
changes are needed. Run the Windows integration suite using local VS Code
downloads only; network, live models, timeout increases and gate changes are
prohibited. Exact receipts and any unavailable checks belong in
`docs/certification/cifix14-windows.md`.
The shared rules prohibit the aggregate `quality` command; scoped gates and
the expressly requested full tests run instead. The rig's Node is 24.21.0,
not CI's Node 22, and only installed VS Code 1.139.1 is available offline.
The first full scan also hits the unchanged five-second restore-lease deadline
in checkpoint restore; that entire file then passes in isolation. These
limits are recorded, with no green full-run or exact-CI-version claim until
the required receipts exist.
The continued scan finds one more foreign-shell fixture:
`importHookSources.test.ts` starts Bash for a POSIX quoting case on Windows.
Use each OS's actual shell and generated command, and assert the complete
literal path and absence of command substitution on both branches.
The complete scan additionally exposes a missing Bash-name dependency in
the headless fixture and a POSIX-only missing-chunk error-path assertion.
Git's installed `sh.exe` on this rig identifies itself as GNU Bash 5.3.15;
admit that existing binary only after verifying it is Bash, keep executing
the actual fake-only headless/workflow fixtures, and normalize filesystem
separators while retaining the missing-file and failed-stat assertions.
The last shard also exposes four fake-child plugin dispatch cases whose
POSIX plugin paths are parsed with the real Windows platform. Give those
fixtures a drive-qualified root on Windows, retaining native-platform
parsing and all cap, grant-stripping and containment assertions.

<!-- plan-archive:end id="7-0059" -->

<!-- plan-archive:begin id="7-0060" lines="41472-41494" bytes="1647" sha256="87b3037638f65a2198372724d498d274ab3b1b24505eb6cb256d53f8fe19058a" -->

**M95INT round-two whole-chain receipt (2026-10-05) — still deferred.**
The single full `npm run quality` authorized by the 150-minute rig brief
passes format, lint, all five type projects, localization, host API, dead
code, cycles and duplication, then returns 1 at unit tests: 27 failures
and one failed setup across five files. Two fake package fixtures omit the
new required `validation.js`; four panel/sidebar assertions expect the old
script tag, and a handoff test expects synchronous usage-dialog loading.
The repaired five complete files pass 73/73 with no assertion removed.
Together with the full run, every offline test has passed, but V8 emits no
coverage report after the failed suite. Preserve the brief's single-wrapper
limit: its remaining build, audit, accessibility, secret and SAST gates run
separately and all return 0. Accessibility covers 668 pages with zero violations,
undecided rules or missing results; SAST runs 287 rules on 954 targets with
zero findings and no timeout warnings. The helper-free diagnostic VSIX is
2,050,323 bytes, under the fixed 2,252,800-byte cap, but is not the requested
universal package. A fresh whole-chain/coverage receipt belongs to the lead after
the release/helper prerequisites in §3 are resolved; do not call this
wrapper green. The earlier four SAST findings, timeout warnings and two
browser failures are repaired, with red proofs and clean scoped/full scans
recorded in `docs/certification/m95-int.md`. No gate is weakened.

**M95INT round-one whole-chain receipt — historical 120-minute rig brief.**
The browser and SAST failures below are historical and repaired in round two.

<!-- plan-archive:end id="7-0060" -->

<!-- plan-archive:begin id="7-0061" lines="41496-41504" bytes="678" sha256="e64b4974667192d838fb8f7a57124596e8745c7ac8ef67cd76848864af98b80c" -->

**FIXM102R lane gate deferral (2026-10-05).** The rig brief reserves full
`npm run quality` for the lead and prohibits running it in this lane. Scoped
unit tests, all five typechecks, scoped lint/format, knip, cycles, duplication,
bundle sizes, host-globals and notices pass. Three existing L/W integration
failures remain: fourteen missing usage translations and three unregistered
manifest keys (17 localization problems), the generated host API record's
`env.appName`/crypto drift, and `partialRecord` absent from the shared
validation bundle. Keep every gate intact; L/W must finish these and run
integrated quality before release. Evidence: `docs/certification/m102-r.md`.

<!-- plan-archive:end id="7-0061" -->

<!-- plan-archive:begin id="7-0062" lines="41506-41517" bytes="879" sha256="da4258d7c40e4f942f9d388a6eda76d42a663c8a786cff2ca8f5bcd5b6f951dc" -->

**M95-I dependency and acceptance limits (2026-10-05).** The rig brief
requires scoped gates, not full quality or a dependency merge. The lead owns
full quality and integrated live acceptance. The five wire-format tests use
real codecs, captured frames and real host tools through a test-only client;
they do not certify lane T's missing production transport, credentials or
redirect policy. W must assemble the registered production factory and panel
seam; N supplies capability provenance/native effort metadata; P2 owns
one-hour-write settlement; CAPPAR owns paid feature observers and picker
consumers. No stub or guessed transport is shipped, and no support claim is
made until those dependencies and integrated gates pass. Native hosted search
on BYO needs its separately captured tool/price adapter; capability evidence
alone cannot prove that route. No gate is weakened.

<!-- plan-archive:end id="7-0062" -->

<!-- plan-archive:begin id="7-0063" lines="41519-41524" bytes="420" sha256="644d560db07e67457cd8aaacc6fbb07f6198e17622d61ee1a6a0b37a46149f37" -->

**FIXM95P host API record deferral — closed by M95INT (2026-10-05).**
Integration regenerated the complete record (276 APIs, 22 adapters, 23
Node built-ins, 59 theme variables) and the unchanged check passes. The
combined-tree diff includes crypto 33→35, fs/promises 34→35, net 3→4,
path 65→66 and the Models panel stylesheet in the theme source list.
The original isolated-lane report follows for provenance.

<!-- plan-archive:end id="7-0063" -->

<!-- plan-archive:begin id="7-0064" lines="42112-42124" bytes="964" sha256="167719ad9dba8afb62f13ece517ac5c0914fe552c541ef97a8bf287428ef002a" -->

**CI0150C scoped repair certification (2026-10-07, macmini).** The rig brief
requires clean `CI=true` verification in batches of at most three test files,
three times at repository default deadlines, plus all five typechecks, lint,
changed-file formatting, plain knip and duplication. The aggregate
`npm run quality` is deferred to the joined release repair: its all-file Vitest
invocation exceeds this lane's explicit three-file limit, and the other lanes
own the remaining hosted failures. This is a scoped certification record, not
a full-release quality claim; no threshold, rule, assertion or CI gate is
disabled. The badge gate still performs real public network checks in CI.
The extra `security:audit` run reports the pre-existing, now-unreported
`GHSA-68fv-2mgg-jv7q` (`source-map-js`) exception in
`.github/audit-exceptions.json`; that unowned cleanup is deferred to the lead,
without changing an exception or suppressing the audit failure in this lane.

<!-- plan-archive:end id="7-0064" -->

<!-- plan-archive:begin id="7-0065" lines="42126-42160" bytes="2333" sha256="f350ee2dd94f997c13de9809fa9be4fe7ea68b1d22857e0ddc6a2ea9f9c2a71c" -->

**CI0150B scoped verification (2026-10-07).** This lane owns the ten slow suites
in its brief. The shared CI0150 rules require three clean-tree whole-file runs,
all compiler projects, lint, formatting, plain knip and duplication. Full
`npm run quality` certification is deferred to the integrated CI repair: the
other lanes own clean-checkout artifact failures in configured-provider,
headless/package and other suites, and this lane must not edit their files.
No threshold, assertion, retry or global timeout is relaxed. This branch's
receipts certify only its named suites and checks, not a complete release gate.

**TRAIN15H scoped certification.** The lead's rig brief and shared common.md
reserve aggregate quality for the lead. This lane runs complete owning files
under default deadlines and individual gates, including every accessibility
page. No baseline increase, new feature, command, setting or escape hatch.

**TRAIN15G inherited DIET1 measurement hold (resolved by TRAIN15H).** Main adds
a regression assertion for its own 733.8-KiB startup and 32.1-KiB deferred
measurement. The integrated train measures 815,775 startup bytes (796.7 KiB)
and about 32.5 KiB deferred, within unchanged 900/50-KiB production caps.
The assertion remains enabled and unchanged. Shared ownership, deferred
loads, and package membership assertions pass. The brief authorizes only
the universal VSIX cap formula; an additional startup diet or revision of
this main-only measurement expectation needed a lead decision. TRAIN15H's
lead decision requires compaction; the restored production graph passes both
inherited assertions. The final receipt records exact bytes and all new
closure budgets. No startup baseline or existing cap is raised.

**TRAIN15G scoped certification.** The rig brief and shared common.md prohibit
aggregate quality here. Run owning default-timeout suites and individual gates;
the lead retains aggregate quality, hosted matrices and native/live receipts.
The sole authorized cap decision is the measured universal VSIX formula above.

**TRAIN15F final package cap hold (resolved in TRAIN15G).** The lead’s new
brief authorizes measured universal +5%, rounded up to 25 KiB after the
shared-browser audit. Actual TRAIN15G packages pass the resulting cap; the
measurements below retain the earlier hold’s history.

<!-- plan-archive:end id="7-0065" -->

<!-- plan-archive:begin id="7-0066" lines="42162-42170" bytes="619" sha256="80580e4eadf103f90bb2cbe389d6229fc9b91745b83a4145ec0edae82f4f241a" -->

**Original TRAIN15F package cap hold (2026-10-06, win11).** Actual post-diet
helperless VSIX is 2,600,909 bytes (66,509 over);
verified-helper universal is 2,680,457 (146,057 over).
The existing 2,534,400-byte / 2475-KiB cap is unchanged. Raw bundle,
split/global, staged localization/badges and native export checks pass. The
lead explicitly requires recording this remaining decision after excluding
unneeded payload, rather than raising the cap. Full quality is reserved under
the scoped-certification rule below. Exact inventories and default-timeout
owning receipts: docs/certification/train-0.15.0-train15f.json.

<!-- plan-archive:end id="7-0066" -->

<!-- plan-archive:begin id="7-0067" lines="42172-42178" bytes="530" sha256="70d9f66e769426962e8f9860b7696caac004a106d298612734d2e7ca1d8553d3" -->

**TRAIN15F scoped certification (2026-10-06, win11).** The continuation brief
requires the 132 complete owning files, default Vitest deadlines and individual
static/build/package checks. Its shared common.md explicitly prohibits full
`npm run quality` on this rig; full quality, hosted matrices, native macOS and
live paid receipts remain the lead's release checks. No gate is weakened.
The lead lifted the exec fixture's two-fix stop and authorized the exact
2aa9cbff7 main merge and correcting D78 to immutable request goldens.

<!-- plan-archive:end id="7-0067" -->

<!-- plan-archive:begin id="7-0068" lines="42180-42189" bytes="735" sha256="6a6d4ce102b5162a5186ec4fd6ee1b0aba69ffea88b304370461b39c8543388d" -->

**TRAIN15E exec fixture stop (2026-10-06, win11).** Exec stdio now passes
38 cases, with three existing Windows exclusions, but its first packaging
fixture expects the former single `de` table while using all fourteen real
production tables. After the missing-directory and catalog-cache fixes this
is its third failure. The common brief requires stopping after two distinct
fixes; retain the assertion and record the remaining fixture mismatch. ACP
stdio passes all ten cases, and production package/native checks pass. The
one cold packaging case now has the specifically authorized 60-second limit;
its measured 41.466 seconds includes archive compression and native checks.
Ordinary packaging and exec deadlines remain 30 seconds.

<!-- plan-archive:end id="7-0068" -->

<!-- plan-archive:begin id="7-0069" lines="42191-42198" bytes="608" sha256="c2ee7e98d3fa307cf3d707af2bfb0a9ba4d32aed12bd5ade606b23103b746cc5" -->

**TRAIN15E universal cap hold (2026-10-06, win11).** The real helperless VSIX is
2,505,428 / 2,534,400 bytes. The certified prior helper contributes 81,327
compressed bytes; adding that contribution alone projects 2,586,755 bytes,
at least 52,355 over the unchanged cap before its ZIP entry headers. The
289,568-byte macOS helper is absent on this rig; no placeholder is fabricated
and no universal receipt is claimed. Further universal size recovery and an
actual helper-bearing package remain for the lead. Helperless packaging and
all native export checks pass; they do not certify the universal archive.

<!-- plan-archive:end id="7-0069" -->

<!-- plan-archive:begin id="7-0070" lines="42200-42205" bytes="473" sha256="58e6cb1183d1e64339c1b731f36d8354ce7269117601215e7ef6b789ed23e532" -->

**TRAIN15E D78 deferral (2026-10-06, win11).** Restoring M102's delayed recall
declaration passes its unused-packing-default test but fails 72 train golden
assertions by changing a tool declaration and cache key. Preserve the train's
fixture bytes: all 89 golden assertions pass, while that one D78 test remains
red. No fixture, assertion, timeout or gate is weakened. The precise conflict
and both outcomes are in the train certification; the owner's decision is pending.

<!-- plan-archive:end id="7-0070" -->

<!-- plan-archive:begin id="7-0071" lines="42207-42222" bytes="1279" sha256="620f3375a00e12008bd5d5157ea4829c9157f9d5c53f4ad097da5d702fdcbdbc" -->

**TRAIN15C M96 bounded size stop (2026-10-05, kubuntu).** The first composed
Model API build is 494,346 / 486,400 bytes. Sharing captured validators and pure
team admission brings it to 486,677 (+277); sharing the existing team bootstrap
text through that same boundary brings it to 486,463 (+63). The same raw-size
gate remains red after two distinct fixes. Under the owner's shared `common.md`
stop rule, hold further Model API recovery and subsequent ordered merges pending
an explicit continuation decision. The original deferred cohort is recovered
by conditionally lazy paid usage; no cap, threshold or feature is changed.
Independent M96 tests and packaging measurements continue for a reviewable
candidate, not release certification. The universal archive is 2,397,730 /
2,252,800 (+144,930), with exact largest-20 entry deltas retained. Static,
source and native export checks do not excuse either cap. A local review
checkpoint preserves the candidate with these explicit §7 deferrals; subsequent
merges and release remain blocked. The inherited committed-source binding is
checked after that checkpoint, because the pre-merge HEAD lacks its worker files. Full quality remains delegated to the
lead after M95/M102 join. Receipts: `docs/certification/train-0.15.0.md`.

<!-- plan-archive:end id="7-0071" -->

<!-- plan-archive:begin id="7-0072" lines="42547-42560" bytes="1079" sha256="75c6d69eb2955b0af166f126b63a9746d91e6272186ce0e622d19e27fd0d8425" -->

**M101INT package blocker (2026-10-06).** All unchanged raw startup/lazy caps,
split/global/notices gates pass, but the final composed VSIX is 2,534,138 bytes
against its unchanged 2,252,800-byte cap (+281,338). The earlier 2,533,864-byte
archive still yielded 2,523,608 after ZIP level-9 recompression, so packaging
overhead cannot close it. M95's independent
Models browser graph, providers/catalogue and joined translations remain shipped
as their lanes require. Removing them would drop intent; sharing browser runtimes
or changing the localization archive is broader work with readership/CSP/runtime
and installed-editor consequences, beyond the bounded image/strict integration
finding. This is a release blocker, not an exception or raised threshold.
Follow-up owner: M95 W / lead performs a reviewed package-size integration diet
and rechecks the unchanged cap on universal artifacts. Local ACP package passes;
its success does not waive VSIX acceptance. The overriding common rules require
stopping/reporting when fitting needs a larger design or an owner cap decision.

<!-- plan-archive:end id="7-0072" -->

<!-- plan-archive:begin id="7-0073" lines="42562-42600" bytes="3295" sha256="352f55458ff8a952b027f4d0fae5150fe3cff7dd2aaf5ed2557b6baa66770d51" -->

**M96INT round 3b preflight and explicit deferrals (2026-10-05, macmini).**
The six ordered merge commits and the single W-owned Git classifier are
integrated. X2's callable scheduler/runner factories, helper packaging and
build-derived tool schemas are integrated; the M95 Models & Agents shell and
window-owned scheduler/accounting/launch/landing bindings are absent from all
six named heads, so Traffic/Runners registration and real team dispatch remain
blocked rather than replaced by invented adapters. Live isolation capture and
Windows-native certification remain with round 3c.

Production activation is 596,609 B against the independently rebuilt pre-M96
604,810 B (growth -8,201 B; limit 4,096 B). All three ordinary metafiles exclude
team/runner modules. All seven original golden fixtures are unchanged, but
64 golden assertions fail because the main release inherited through B includes
D78's deferred `recall_output` declaration and changed cache keys. This conflicts
with the brief's pre-M96 byte baseline; preserve the release decision pending
lead resolution, never update the fixtures to conceal it.

Keep every existing cap: lossless English encoding reduces uiText to 59.5/125
KiB and browser startup to 820.7/900 KiB. Deferred browser JS remains 55.6/50
KiB, so `npm run build` exits 1. New scheduler (57.8 KiB) and runner (44.6 KiB)
bundles each have a 75 KiB cap under D6's measured ×1.15 rounded to 25 KiB rule.
No existing cap or guard is relaxed. The zero-clone gate exposed A/K settlement and two fake-journal overlaps: use one core settlement algorithm with caller-specific errors and share the test-only day/refund helpers; preserve both restart/acknowledgement suites. The full accessibility matrix exposed the merged harness loading the ordinary App and Traffic into the same root, plus a missing Traffic readiness predicate: load exactly one ESM entry per scenario and wait for its own marker; prove every Traffic/runner route in Chrome. A repeat K test exposed an end-write fault injection installed after the real child could already exit; arm it before launch and target only the end record, without changing production timing or timeouts. The requested published 0.13.0 macOS helper
is absent locally; shared lane rules prohibit downloading it, and the artifact
location/download clarification is pending. A helperless archive is not a
universal certification. Full quality is required once on the final code head;
its actual exit and tail must be reported, including any unvisited downstream
gates, without treating preflight passes as full certification.

The repaired full accessibility matrix passes 596 pages (149 scenarios ×
four themes), with zero violations, undecided rules or missing results and
eight unchanged listbox exemptions. Its focused Traffic/runner matrix passes
20 pages with no exemptions. The harness compiler and final zero-clone scan
also pass.

The complete-history secret scan also exits 1 with seven inherited findings
across `star-line.md`, `m95-x.md` and historical `authSource.test.ts` revisions.
Only file/line/commit metadata is retained in the certification receipt; no
matched text is copied. History is not rewritten and scanner ignores are not
expanded. Investigation and resolution remain a lead-owned release blocker.

<!-- plan-archive:end id="7-0073" -->

<!-- plan-archive:begin id="7-0074" lines="42602-42619" bytes="1248" sha256="cfd432dde304cb8936917cdeb1e1a5722f050901d7e4b10da04861d06ab3bd5a" -->

**M96INT round 2 integrated-source proof (2026-10-05, Windows 11 rig).**
T/W/I/U2/L review heads merge with `--no-ff` in order. The canonical worker
environment, durable claims through the lazy factory, final chat-tree schema,
`done` ledger outcome and verified shared browser grammar are integrated.
All owning/adjacent units pass: 2,208 tests in 75 files, with eight complete-file
failure drills and byte-exact SHA-256 restorations. Native Windows junction
bodies and the case-variant storage refusal execute here. Ordinary activation,
Model API and ACP metafiles contain no team runtime inputs; seven original
golden blobs and all 63 raw single-model scenario/configuration assertions
remain identical under the established generated-id normalization.

Five compiler projects, full lint/format, knip, zero-clone duplication,
localization (0 problems), cycles, regenerated host API/notices and the
production build pass. All 18 build caps pass; the actual win32-x64 VSIX
passes its 2200 KiB cap at 2,243,169 bytes. Evidence is in
`docs/certification/m96-int.md` and `m96-int-round2-results.json`.
A's second fixes, K, M96c, main 0.13.0/0.14.0 and full quality remain outside
the round 2 brief. The earlier record below remains round 1's history.

<!-- plan-archive:end id="7-0074" -->

<!-- plan-archive:begin id="7-0075" lines="42621-42660" bytes="2640" sha256="2f66052190bc4ac175fcf67e8646299800298fb5e11aef2692abce9d91dbd83d" -->

**M96INT round 3a proof (2026-10-05, Windows 11 rig).** Final lane A
`273a9131` is merged with both intents retained. The completed follow-up
moves Node team-view validators and team pricing/scoped consent into the
existing deferred team bundle, shares identical scalar validators and
discards unused role constant factories. Activation is 608,883 bytes versus
the reproduced 604,810-byte pre-M96 source baseline: **+4,073**, within the
unchanged 4,096-byte acceptance limit by 23. This resolves the round 2
growth residual below; the main train's separate 600,000-byte diet is not
integrated or claimed. Named graph/byte tests, seven raw request scenarios,
611 owning tests, eight fired source drills with byte-exact restorations,
five compiler projects and scoped static/build gates pass. Every one of the
18 existing bundle caps passes. The merge hook captured a partial relocation;
the merge and completed follow-up form the review unit, not the transitional
merge alone. Evidence: `docs/certification/m96-int.md` and
`m96-int-round3a-results.json`.

**M96INT-R3A-UNIVERSAL-SIZE (release blocker, no gate waiver).** The
CI-shaped universal VSIX now includes the exact published 0.13.0 macOS
helper and all required members. It measures **2,324,725 bytes**; the
unchanged 2,252,800-byte gate exits 1, an excess of **71,925 bytes**. The
packaging proof is complete, superseding the missing-helper residual below,
but the size acceptance remains red. Keep the cap unchanged and reduce
packaged bytes on the integrated train before release. This measurement
uses the brief's released helper, not a fresh native build for the worktree's
0.12.1 manifest. Round 3b wiring, current main and full quality stay with
the lead; M96 is not shipped or certified by this scoped lane.

**M96INT-R2-ACTIVATION-GROWTH (acceptance 31, resolved by round 3a above).** The final
activation is 611,874 bytes (hard 600 KiB cap passes), versus the independent
pre-M96 measurement of 604,810: +7,064. The separate 4,096-byte growth
target remains unsatisfied by 2,968 bytes. Combined transport/schema and
review additions consume that growth; keep the target unchanged for the
lead's follow-up before M96 certification. No gate is lowered or waived.

**M96INT-R2-UNIVERSAL-VSIX (historical; measured by round 3a above).** This rig has no
compiled `native/darwin/muse-dictate`; only the real Windows-targeted package
is built and cap-checked. A universal package including the macOS helper
requires the lead's packaging rig. The browser has only 264 bytes of cap
headroom and the Windows VSIX 9,631; the measured Windows artifact does not
certify universal size.

<!-- plan-archive:end id="7-0075" -->

<!-- plan-archive:begin id="7-0076" lines="42662-42678" bytes="1144" sha256="e352d869a988a3520c612fe00b33d57fd52ecb016d1c86e2d242fef8443c53e9" -->

**M96INT integrated-source proof (2026-10-05, Windows 11 rig).** R/0, A,
B, F and T are merged in order, preserving round 4. The repaired lazy
boundary excludes team runtime modules from activation, Model API and ACP.
All seven golden scenarios match an independent source-overlay build of
`e23ec61c`; 1,562 tests pass across 50 owning/adjacent files. All five
compiler projects, full lint, formatting, knip, zero-clone duplication,
localization (0 problems), cycles, regenerated host API and production
build pass. All 18 bundle caps pass; activation grows 3,912 bytes.
W/I/U2/L/K and full quality remain with the lead. Evidence and byte-exact
failure drills are in `docs/certification/m96-int.md` and its result JSON.

The lazy-entry regression also covers an older single-model conversation
while another conversation has an in-place worker: its known refusal stays
in the bootstrap and never requires the team runtime. The entry exposes
only the functions it uses; obsolete compatibility exports are removed.
T's reason codes and delegating-worker tools reuse lane 0's definitions,
and the ACP notices list includes the new shipped bundle.

<!-- plan-archive:end id="7-0076" -->

<!-- plan-archive:begin id="7-0077" lines="42693-42698" bytes="429" sha256="bf624140a5dff22bbb87bdb99c5000a5c355087b436f1f6ec3701a8e106b5060" -->

**FIXM96F (2026-10-05).** The rig brief requires focused Windows checks
and forbids full quality or merging. The fifteen lane-F review findings
are corrected with regression tests and 29 distinct SHA-256-verified red
drills (`docs/certification/m96-f.md`). Knip and duplication failures in
the owned modules/tests were fixed without changing gate configuration.
Full quality remains the lead's aggregate gate before integration.

<!-- plan-archive:end id="7-0077" -->

<!-- plan-archive:begin id="7-0078" lines="42700-42705" bytes="417" sha256="258454a8901151a31df9b809d55d293483206919465a99886ebdc0d6be09e56c" -->

**FIXM96T review correction lane (2026-10-05).** The rig/shared brief
requires focused checks and prohibits a full `npm run quality` here; the
lead runs it after integration. No gate is weakened. The existing lane-X
generated host-API record deferral remains owned by X. Findings 1–9 have
37 firing red drills with byte-exact restoration; final focused/static
results are recorded in `docs/certification/m96-t.md`.

<!-- plan-archive:end id="7-0078" -->

<!-- plan-archive:begin id="7-0079" lines="42707-42714" bytes="595" sha256="13b7120b92d4be3cacdcba815ec1bd875e93ab0d5089207238b14d600cc1a09f" -->

**M96-W host API inventory deferral (2026-10-05).** The scoped worker repair
passes the owned suites and production budgets, but `check:host-api` reports
one pre-existing generated-record mismatch: `node:stream` has 10 source
importers, while `docs/ide-compatibility/host-api.md` records 9. The unchanged
import in `src/host/team/acpProcess.ts` exists at lane base `49340fe1`.
The inventory is outside FIXM96W's owned files; the lead regenerates it
after integration. No source import, gate, ignore or threshold is hidden
or weakened. See `docs/certification/m96-w.md` and §9's named residual.

<!-- plan-archive:end id="7-0079" -->

<!-- plan-archive:begin id="7-0080" lines="42716-42733" bytes="1257" sha256="2d8e38e5c1cf055e2fc8c2070e53bc323c0f1abc554b1273838635d89dbea7c9" -->

**WINPUB native publication proof (2026-10-05).** Task imports exclude
automatic maintenance, commit-graph writing and submodule recursion while
retaining object validation and atomic expected-old ref publication. The
final source passes four consecutive complete Windows runs, **214/214** each,
with three workers and default deadlines. An early six-worker loaded run
passes **30/30**, but the repeat under verified Git selection is **18 passed /
10 timed out / 2 hook-cascade skipped**. The loaded performance requirement
remains open; the early green is not substituted for the later failure.
The restored old-path drill times out in five of thirty cases at full
saturation. Every new import
option's guard fires separately and restores SHA-256-exact. A broken alternate
Git installation interrupts an earlier sequence; process-local selection of
the verified rig Git resolves that environment failure without changing gates.
Individual Git syscall timings and a robust loaded deadline guarantee are
not established. Full quality/coverage and Mac/Linux integration remain the
lead's gates. Detailed receipts and retained failures are in
`docs/certification/m96-i-winpub.md`; the historical REDWINI96 results below
are not substituted for this new proof.

<!-- plan-archive:end id="7-0080" -->

<!-- plan-archive:begin id="7-0081" lines="42735-42759" bytes="1698" sha256="4d022b19a4f50afd9b1f21eedc3c59e4b37ff55722c7dbc1ad4989be92576786" -->

**REDWINI96 measured redesign (2026-10-05).** Exact merge blobs use one
binary-safe batch and per-operation reuse; dirty base metadata uses one
query, and isolated revision lookup avoids a driver-config child. Prepared
fixtures compact immutable objects once and keep mutable files independent.
The complete 214-row Windows diagnostic records product children
**362 → 257**, fixture children **120 → 4** and body product/fixture time
**19.947/12.461 s → 17.785/4.349 s**, with shared setup shown separately.
Seven deliberate slow-path/schema/isolation/packing drills fail and restore
SHA-256-exact.

Four consecutive complete final-source native passes remain **unachieved**.
An uninstrumented sequence passes three times, then protected refusal times
out; after measured compaction, the final-source profile is **213/214**,
with two-writer publication taking **5.027 s**. A complete workspace trace
times out in publication refusal again (**5.017 s**). common.md's repeated
failure stop rule prevents another repair/retry on that path. Full quality,
coverage, hosted certification and Mac integration are explicitly delegated
to the lead by the rig brief/common.md; no gate or deadline is weakened.
The measured changes and exact residual actions are in the REDWINI96 section
of `docs/certification/m96-i.md` and its linked timing table. This closes
neither **I-default-timeout** nor **I-path-race**.
All five compiler projects (plus the final unit recheck), changed-file
ESLint/Prettier, deadcode, zero-clone duplication, localization, host API and
production size/split/globals/notices gates pass on the Windows rig. No
dependency, suppression, gate level, deadline or bundle cap changes.

<!-- plan-archive:end id="7-0081" -->

<!-- plan-archive:begin id="7-0082" lines="42761-42773" bytes="938" sha256="53616f37ce3a192cde29e635c957efd10d02079431bf751334310ce16774fa94" -->

**WINI96C fixture proof (2026-10-05).** Overlap and junction setup use real
fast-import without unused task copies; docs-base setup preserves the real
index with read-tree. The overlap test additionally requires its domain
refusal message after a deliberate guard removal exposed a generic-error
false positive. Mac snapshot `86e32b4e` passes all 214 owning cases, all five
compiler projects and the scoped static/build matrix; overlap and native
junction control drills fail as intended and restore SHA-256-exact. Native
full proof remains required: the plain source before message refinement is
211/214, with workspace base-capture, two-writer and drive-alias timeouts.
No deadline, assertion or gate is weakened, and no Windows/CI green is
claimed. Full quality/coverage and hosted certification remain the lead's
gates under common.md. Evidence and exact remaining actions are in the
WINI96C section of `docs/certification/m96-i.md`.

<!-- plan-archive:end id="7-0082" -->

<!-- plan-archive:begin id="7-0083" lines="42775-42792" bytes="1312" sha256="0c9fdeb1aa8dc5677bc9386c4154ce03150708d619825348cf57798ec131ce8b" -->

**WINM96I Windows follow-up (2026-10-05).** Complete owning files pass on
Windows: teamWorkspaces 39, teamRefFence 89, teamMerge 45 and reviewGate /
reviewerPick 16 (189 total; four existing POSIX-only bodies return). Junction
cleanup, unlink, add/overwrite/delete and Undo cases execute, alongside case,
drive, namespace and real reported 8.3 aliases. Six deliberate guard/argv
drills fail as intended and restore byte-exact with SHA-256. All five compiler
projects, changed-file ESLint, deadcode, zero-clone duplication, localization,
host API and production build pass on macmini snapshot `5f4f0f80`. No gate or
budget changed; shared test setup fixes the duplication finding. See the
Windows heading in `docs/certification/m96-i.md`. Full quality and editor
integration remain the lead's gates under the lane brief.
retains the historical stream-count deferral below. FIXM96W4's current
`check:host-api` mismatch is instead two importer counts: child_process
11 recorded / 12 actual and util 4 recorded / 5 actual, from the native
handle-name helper. All other inventory rows agree. The generated inventory
is outside the W repair lane's owned files; the lead regenerates and reviews
it after integration. No gate, ignore or threshold is weakened. See
`docs/certification/m96-w.md` and §9's named residual.

<!-- plan-archive:end id="7-0083" -->

<!-- plan-archive:begin id="7-0084" lines="42794-42803" bytes="779" sha256="df801a0c6df4c705b45b6aed49138bc2a3f03c6bfd6a4aede57008815148c1e5" -->

**FIXM96I local repair proof (2026-10-05).** RVM96B findings 1–12 and 24
are fixed in lane I with 165 passing owning cases and 26 SHA-256-exact
restored guard drills. Five compiler projects, changed-file ESLint/Prettier,
deadcode, duplication (zero clones), localization, host API and production
build pass on macmini. The duplication gate caught repeated test setup and
was fixed with test-local shared fixtures; the host API record's two Node
import counts were regenerated. No gate or budget changed. Full quality remains the lead's certification work under
the rig brief; WINM96I above completes the previously pending Windows
junction execution. See `docs/certification/m96-i.md`; §9 names the remaining
platform validation and existing filesystem atomicity assumptions.

<!-- plan-archive:end id="7-0084" -->

<!-- plan-archive:begin id="7-0085" lines="42805-42820" bytes="1132" sha256="34219fc6a63548670067556b02be7aca766a74a79296e26d8c31113adf227d20" -->

**FIXM96A/FIXM96A2 focused rig certification (2026-10-05).** The rig brief explicitly
forbids full quality and integration merges in this repair lane. Its complete
owned/adjacent test files, typechecks, changed-file lint/format, localization,
host API, dead-code, duplication and production build run directly on macmini.
The lead retains the full quality matrix, editor/UI and live integration
certification; no rule, threshold, ignore or timeout is weakened. Record:
`docs/certification/m96-a.md`.
**FIXVSIX2 scoped certification (2026-10-05).** RVMVSIX2 P1 and P2 are
fixed. All 78 owning unit tests and 49 native packaged-module tests pass,
with declared-export, private-reader and absent-dist red drills restored
byte-exact. Typecheck, scoped lint/format, Knip, duplication, localization,
host API, cycles, production caps and both package commands exit 0.
Universal VSIX is 2,033,170 bytes, with 219,630 bytes headroom; activation
is byte-identical. The rig brief reserves aggregate quality/coverage and
installed-editor/platform certification for the lead. No gate is weakened.
Receipts: `docs/certification/vsix-diet-2.md`.

<!-- plan-archive:end id="7-0085" -->

<!-- plan-archive:begin id="7-0086" lines="42822-42831" bytes="771" sha256="5786e97125d4aeab1235670c11317cc3f36c128152c5400289ea109f24e09500" -->

**ACTDIET preview integration deferral (2026-10-05).** Full quality is prohibited
by the explicit lane brief; focused tests, static gates and production builds
run on Kubuntu instead. `jscpd` reports existing clones in M91 hooks and their
fixtures, MCP/plugin fixture setup, golden/shell test setup and repeated shell
scenarios. The implicated files are byte-identical to merged preview ce99c0fc
(`git diff ce99c0fc --` those ten paths is empty). ACTDIET's repeated split-drill
logic is consolidated and adds no clone. No ignore, threshold or gate changes.
These integration refactors remain with the owning feature/release lanes; the
preview is not certified for release while duplication is red. Exact findings
and other results are in `docs/certification/actdiet.md`.

<!-- plan-archive:end id="7-0086" -->

<!-- plan-archive:begin id="7-0087" lines="42833-42845" bytes="1032" sha256="cc2b77034a676c4919e6e46949731607e00fbffa350193be361d9b63ee815bc8" -->

**FIXM91P4 lane-scope deferrals (2026-10-04, not gate exceptions).** The required
commands ran directly on the Mac mini. `check:host-api` fails on the review base
as well as this correction: its generated record says 65 `node:path` importers,
the scanner finds 66. **P-host-api-baseline:** W/lead must regenerate and review
`docs/ide-compatibility/host-api.md` with `npm run check:host-api -- --write`.
`npm run build` compiles and passes all size caps, then the unchanged split gate
rejects all eleven unwired adapter modules as on neither list. The same original
sources reproduce those eleven errors. **P-bundle-map-baseline:** W must register
the files' actual bundle/type membership while wiring them, then rerun the build.
Both target files are outside lane P's permitted edits. Neither gate, ignore nor
cap was changed; neither failing command is claimed green. Certification and
PLAN §9 name the residuals. Full quality remains the lead's integration gate,
as the shared lane rules expressly forbid running it in the lane.

<!-- plan-archive:end id="7-0087" -->

<!-- plan-archive:begin id="7-0088" lines="42847-42847" bytes="271" sha256="eea22bbc2c5c3c0da40b1ded877f0acd040d96a3238826ea9b6a5580e932b890" -->

**Resolved in integration (lane W, 2026-10-05).** The bundle map is registered: lane P's modules ship in `dist/foreignHooks.js` (`FOREIGN_HOOKS_ONLY`) and its type-only `contract.ts` is listed as such. The host-API record is regenerated with the integration's full gate.

<!-- plan-archive:end id="7-0088" -->

<!-- plan-archive:begin id="7-0089" lines="42849-42860" bytes="878" sha256="0dfd98f813409fbc9217f62eac9870e143a4077f02b8c273e43de09934d882a4" -->

**M91-I-Bundle-budget deferral (FIXM91I3, 2026-10-04).** The required
production build was run and the import bundle alone exceeds its unchanged
125 KiB cap: 148.5 KiB after removing the new heavy name-builder import and
all six duplication-gate clones. An in-memory build of the starting commit
`d1eeaadbb791c93a9440e36d358b9cfdc7f2c9f1`, with the production options and
shared English fallback, is already 147.7 KiB. This is a blocking packaging
deferral, not a gate waiver or support claim. Splitting a bundle needs build,
bundle-split and host entry changes outside lane I's owned files; the lane
brief forbids widening there and common.md says to stop and report when a
bundle cannot fit. Follow-up: W/lead splits the importer under the existing
budgets and reruns the production build and full quality gate before landing.
No cap, threshold, ignore or rule level changed.

<!-- plan-archive:end id="7-0089" -->

<!-- plan-archive:begin id="7-0090" lines="42905-42912" bytes="590" sha256="fe5cc9228d9819b0091ea83d1446c3d80fd3256ffd06f70b141500d9e6794530" -->

**MRG116 bounded merge lane (2026-10-04).** The rig brief requires merging
`main-sync` (M87) into PR #116 with scoped owning tests and static/build
checks. Its shared rules prohibit this lane from running full quality or
the full test suite, assigning those checks to the lead. Full quality,
coverage, accessibility and installed-editor/platform acceptance therefore
remain required after integration; no gate or threshold is changed.
Conflict resolutions, generated material, redaction drills and the observed
Kubuntu results are recorded in `docs/certification/docs-truth-audit-0120.md`.

<!-- plan-archive:end id="7-0090" -->

<!-- plan-archive:begin id="7-0091" lines="43118-43129" bytes="916" sha256="d5eb600df34e62a79eb2e71a0e4f222aed803aa3412e44fd0889145dcb5a479f" -->

**TRAIN15E final continuation result (2026-10-06, win11).** Merge and root
repairs are committed with normal hooks. All 793 files have a final positive
result: 15,966 passed, zero failed and 100 existing skips after the full SSH
rerun removes its independent canary timing race. Actual universal VSIX:
2,703,474 / 2,841,600 bytes; ACP: 1,708,084 bytes, both version 0.15.0.
All requested source-only gates, production/package guards and unit typecheck
pass. Full repository ESLint is interrupted without a result at the 90-minute
brief limit; it is an explicit remaining gate, never waived. The prior 952-page
accessibility receipt is retained because this continuation changes no UI/shared
source; current production/packaged browser bytes match, and identity with the
earlier compiled capture is not claimed. Final receipt and exact holds:
docs/certification/train-0.15.0-final.json. Zero new model calls or push.

<!-- plan-archive:end id="7-0091" -->

<!-- plan-archive:begin id="7-0092" lines="43131-43135" bytes="386" sha256="7811682f226955771bf4aabfdfafbbd8b329a405034be04999aa70ad73e5c596" -->

**TRAIN15E hook hold (2026-10-06, win11).** The required commit hook rejects
`teamHarness.test.mjs:23` for `unicorn/no-top-level-assignment-in-function`.
Lint-staged restores and cleans its automatic backup. The rig time limit has
expired, so no further source rewrite or bypass is attempted. The resolved
merge and release handoff remain staged at c15b7eeae; no new commit is claimed.

<!-- plan-archive:end id="7-0092" -->

<!-- plan-archive:begin id="7-0093" lines="43137-43143" bytes="543" sha256="9991da840923e924c0cd3bee0d6a75ce244dc4717d2452b991bf34a6c82ac425" -->

**TRAIN15E bounded final gate deferral (2026-10-06, win11).** The 120-minute
rig limit stops full lint without a result after more than seven minutes. Final
plain knip, duplication, dpdm cycles, formatting sweep and universal VSIX/ACP
packaging were not reached. Earlier reference/localization/host-API/build checks
remain evidence only for their recorded source. Final packed versions, sizes, cap
compliance and browser hash comparison are pending. All five final TypeScript
projects pass. These are explicit release holds, not waived gates.

<!-- plan-archive:end id="7-0093" -->

<!-- plan-archive:begin id="7-0094" lines="43145-43166" bytes="1551" sha256="612a82a4d4d7055e43073bab480cb0176acd758367472ab3e7f2309a235a5b63" -->

**TRAIN15E bounded Windows verification holds (2026-10-06).** Common.md
requires stopping a path after the same owning test fails following two
different fixes. Preserve the failing full-file receipts; do not skip or
weaken their assertions. `runnerHelperNative.test.ts`: the trusted existing
process-scoped PowerShell prefix gets past script-policy refusal; a named
real-transaction limit then exposes a job that stays running without its exit
marker. `sshRunner.test.ts`: explicit Node/Git Bash execution and portable
paths remove executable-launch failures; fake-only Unix metric probes and
named real Git/shell transaction limits leave two undefined health results
and two setup-count assertions (four failures). Stop those paths and hand
their exact receipts to the lead. The draft can record successful independent
checks and measured packages, but these five assertions remain release holds;
neither aggregate quality nor release readiness is certified.

The final complete `teamLanding.test.ts` run also retains four default
5-second transaction timeouts: deletion-holder admission, dependency/check
identity invalidation, overlapping landings/Git add, and Land-without-checks
consent. The journal escape/revalidation case clears after its named real
transaction limit, but other ordinary deadlines now expose fixture cost.
Stop further deadline rewrites: this file needs shared-fixture/process-cost
work under the lead's review. R014 records 24 passed / 4 failed; these join
the five runner/SSH assertions, making nine Windows release holds.

<!-- plan-archive:end id="7-0094" -->

<!-- plan-archive:begin id="7-0095" lines="43227-43237" bytes="886" sha256="2c9e2b937b3319fe23fef4f14ea6c9d75dd59f1f9dc60f1b3b6e4a779ab1e06b" -->

**FIXM114I integrated repair gates (2026-10-07).** The shared rig rules prohibit
aggregate quality/full-suite runs; the lead retains `npm run quality`. This
lane runs the owning files three times in a fresh committed CI clone, all five
compiler projects, lint/format, plain knip, duplication, build, reference and
localization. Chrome 150 on win11 refuses the visual driver's font-probe PNG;
two bounded viewport/crop attempts were reverted byte-exact. Full integrated
PNG capture/review and replay remain lead-owned: commit capture inputs, run
`npm run check:visual -- --update --review=RVM114W-FIXM114I-integrated --archive=<new-outside-repository-directory>`,
inspect and commit the manifest, then `npm run check:visual` and
`npm run check:visual:a11y`. Current inventory validation deliberately rejects
the old golden until that recapture; no stale pixels are certified as current.

<!-- plan-archive:end id="7-0095" -->

<!-- plan-archive:begin id="7-0096" lines="43239-43245" bytes="503" sha256="ecb1f5f3368331eb51f9e00a79aa68fd8dd7c2ebe1360832b3aa07b1798d720e" -->

**M114 P2 review repair scoped certification (2026-10-06).** The rig/shared
brief likewise prohibits aggregate quality/full unit runs and cross-lane
edits. P2 runs complete owning test files with default timeouts, byte-exact
red drills, scoped lint/format, all compiler projects, localization,
dead-code, duplication and production build checks directly on Kubuntu.
The existing S-owned host-API inventory and final integrated quality/visual
certification remain explicit handoffs; no gate is weakened.

<!-- plan-archive:end id="7-0096" -->

<!-- plan-archive:begin id="7-0097" lines="43247-43259" bytes="990" sha256="bf3653a01e3e5e964582aa05aaa3ad487c53fe79fb750f7a848db7d6ea8845c0" -->

**M114 host-API inventory handoff resolved by S (2026-10-06).**
The scanner now follows local CSS imports, including generated host roles,
and normalizes Windows separators. The reviewed record contains 62 theme
variables with their actual source paths, 332 VS Code APIs, 31 import files
and 25 Node built-ins (including F's new uses). The read-only gate exits 0;
the import traversal guard was deliberately disabled and both regressions
failed, then the source was restored byte-exact. S also binds the inherited `visualMatrix.test.mjs` imported-source handoff
named in P1's final receipt, retaining its exact equality/provenance assertions.
That reveals one genuinely uncaptured new P1 variable,
`--vscode-contrastActiveBorder`, absent from both third-party fixtures.
Lane 0 owns those captured fixtures; S stops at that boundary rather than
inventing a value or dropping a variable. The two strict matrix cases remain
failing for that single variable until its live capture is supplied.

<!-- plan-archive:end id="7-0097" -->

<!-- plan-archive:begin id="7-0098" lines="43261-43267" bytes="501" sha256="28cb0debe19104717d0cf3853027a8616238507936e2c3ac9b6ea1ce3097cd01" -->

**M114 integrated startup measurement (S, 2026-10-06).**
Against P1's recorded pre-polish source `58ed2fc1d`, production eager
JavaScript grows 952 bytes and eager CSS grows 11,789 bytes: **12,741 bytes**
combined, above D94/M114's 4 KiB growth target. The existing hard artifact
caps pass unchanged. P1/P2 own the styles and lane 0 the token outputs;
the lead retains their named startup compaction handoff. S records both
JavaScript and CSS rather than excluding a generated sheet or raising a cap.

<!-- plan-archive:end id="7-0098" -->

<!-- plan-archive:begin id="7-0099" lines="43269-43278" bytes="713" sha256="46838e5834cb772ef9a2fedc311a524100c4703421e50edef6e5f20064ac3fc2" -->

**M114 visual CI binding (S → lead, 2026-10-06).**
Local `quality:gates` now includes `check:tokens` and `check:visual`. The
explicit static command in `.github/workflows/build.yml:93` still lists
neither; its checkout also has no history depth configured. The workflow
owner must bind both gates and fetch the tracked visual source revision
(`git archive` needs that Git object). The six-theme/state source replay is
a separate long browser operation, not a Vitest timeout exception. S owns
neither this workflow nor its job scheduling; it records the handoff rather
than editing another owner's file or adding a network fetch to the gate.
Missing source revisions fail explicitly, and no local gate skips CI.

<!-- plan-archive:end id="7-0099" -->

<!-- plan-archive:begin id="7-0100" lines="43280-43290" bytes="810" sha256="4bbb5654361ce3dcba5837af0534f61f70ae3e039797c16bb2ee3ab2bda053ea" -->

**M114 strict capture-repeat deferral (S, 2026-10-06).**
The complete 4,824-image candidate is outside Git, with its hashes, dimensions,
review and source revision tracked. The actual comparison fails on 2 header
focus pixels; an independent repeated real scene prefix fails on 5 pressed
pixels. Clock/frame settling and Chrome software rasterization both failed
in final verification. The lane brief requires stopping the repair path after
two different fixes fail; both ineffective changes are reverted. S retains
the failing strict gate/test and does not waive AA, pixels or coverage.
Browser raster stability and a fully green normal/source-reconstructed visual
receipt remain with the lead before release. See S's certification for the
exact cases and attempted repairs; no certified baseline is claimed.

<!-- plan-archive:end id="7-0100" -->

<!-- plan-archive:begin id="7-0101" lines="43292-43299" bytes="604" sha256="af0f596ac8a3efe9f6f9000eb285dfe5eac99add7e8eca50a0a307882acaca08" -->

**M114 S continuation (lead authorization, 2026-10-06).** The rendering-noise
stop above is lifted for the dated 0.1/AA-detection/0.01%-or-12-pixel policy.
S now owns the missing captured theme observation and CI binding previously
handed to the lead. Validate two full local comparisons and a scoped source replay;
the new CI job owns the complete source-reconstructed comparison,
record the four actual UI red drills and two consecutive complete passes;
startup compaction remains assigned to P1/P2/lane 0 and integration. The
historical failed receipts above remain evidence of the superseded policy.

<!-- plan-archive:end id="7-0101" -->

<!-- plan-archive:begin id="7-0102" lines="43301-43325" bytes="1663" sha256="5a9acc4882de7ab1719b50f3d1ac052c8c64dc2c3c6a8c903d2de7a60d180ac0" -->

**M114 S continuation 3 scope (rig brief, 2026-10-06).** Diagnose the late
mount timeout with exact scene/theme/width/language and page-error context;
check frozen-clock startup, scenario readiness and resource cleanup before
changing the S-owned capture driver. Keep the existing deadlines, complete
matrix and reviewed pixel policy. If the complete source/candidate replay
cannot fit the CI job, partition the validated manifest deterministically
into independently failing shards and require every shard in both tiers.
Collect two consecutive complete comparison receipts and repeat the four
actual UI red drills on the final driver. Foreign harness scenario fixes
remain named handoffs, unless the cause is in S's owned files. Full quality,
hosted execution and startup compaction stay integration-owned.

For the timeboxed second replay, at most two independent browser capture
jobs may overlap using a byte-identical local Git snapshot inside ignored
scratch. Serialize their builds; merge only real CLI receipts with matching
candidate/manifest/environment identities. No capture, policy or UI input
changes, and no subagents or shared installation writes.

The isolated browser suites also exceed their default setup deadlines when
three or six real scenes share a hook. Their existing complete coverage now
uses one scene per setup hook: all 36 representative captures and both
18-capture stability sets remain, with unchanged test/hook deadlines.
Both complete suites pass (6 assertions, 20.76 s). The new cross-scene
rasterization binding is deliberately made red and restored SHA-256-exact;
see `docs/certification/m114-s-after/c3-raster-drill.json`.

<!-- plan-archive:end id="7-0102" -->

<!-- plan-archive:begin id="7-0103" lines="43327-43338" bytes="883" sha256="9e73ec60dd7399bdfbf63c8389a496b85d1711d65468fed22880e52a3d4c6e3e" -->

**M114 S continuation final boundary (2026-10-06).** The reviewed tolerance,
four real UI red drills, missing theme capture and required CI binding are
implemented. All 25 owning tests pass at default deadlines and scoped
compiler/static/build gates pass. The complete 4,824-image replacement is
235.37 MiB outside Git, with 108 scoped Git-source replay images passing.
Its full CLI comparison reports 4,752 captures before a 30-second page-root
mount timeout; no pixel regression is reported. Zero of the required two
complete comparisons pass, so the candidate remains unaccepted. The
90-minute continuation ends with that failure recorded in S's certification;
the lead must resolve the mount failure and collect both full receipts.
No capture, threshold, deadline or CI gate is waived. Startup compaction and
aggregate/hosted certification retain their named integration owners.

<!-- plan-archive:end id="7-0103" -->

<!-- plan-archive:begin id="7-0104" lines="43340-43352" bytes="932" sha256="e889811106df98a2c3f3466d3638fb601b54a7e31008d99064f065d4a87de474" -->

**M114 S continuation 3 local result (2026-10-06).** Both complete local
comparisons now pass: 4,824 images each, 1,850.478 s resumed and 1,488.964 s
fresh, 12/20 pixels total, maximum 1/2 per image. Every merge requires all
six 804-image receipts and the unchanged policy and 512 MiB budgets. One
final-batch retry per run is retained with its actual failure. The four final
UI drills and five shard guards fire; 27 scoped assertions pass at default
deadlines, including an isolated stability retry after a setup timeout.
Compiler/static/build checks retain their original caps; aggregate quality
remains explicitly deferred to the lead by the rig/shared brief. Historical
timeout provenance, report/history readiness, unmarked code-highlighting
fallbacks and hosted source reconstruction remain named handoffs, not
claimed fixes. See S's final certification and C3 receipts. No baseline
update or foreign production edit is made.

<!-- plan-archive:end id="7-0104" -->

<!-- plan-archive:begin id="7-0105" lines="43459-43495" bytes="2114" sha256="e0fc7d7bfba93c7d463bd4a7fc0ac26ce05517d9893a31578b090e4a2ac4ca2d" -->

**CIFLOW — tiered CI and merge queue (owner request, 2026-10-04).** The owner
said it took "like 4 40 minute checks just to get a release cut": the full
three-OS gate ran on each PR push, again after each refresh from `main`, and
again in the release. He approved a GitHub merge queue plus tiered CI. PRs
run a fast Ubuntu tier: the static gates, the production build, every
unit/e2e test, gitleaks and semgrep, in about 12 minutes or less. The merge
group runs the full tier once, on the commit that becomes `main`, in an
estimated 10–15 minutes; Windows quality alone took 38m23s in run 37211362498. The full tier runs:

- the static gates on all three OSes;
- coverage shards merged per OS before the unchanged 90/85/90/90
  thresholds apply: four on Ubuntu and macOS, six on Windows (lead
  decision, 2026-10-09, on CITIME017's estimate: four Windows shards
  ≈ 18.3/14.2/20.0/18.0 min against the 20-minute job limit, five
  ≤ 15.5 min; `docs/certification/citime017.md`. CIFIX017W2: in the first
  hosted run of five, 37980345168, shard 1 hit the limit after 19.1 min of
  tests with 26 files left; six project to ≤ 16.2 min,
  `docs/certification/cifix017w.md`);
- the a11y harness once, on Ubuntu;
- integration on Linux and Windows;
- the macOS helper and the universal packages.

An aggregate job produces the seven required names on both tiers. Lead
review found and fixed two defects:

- **gitleaks on `merge_group`.** The gitleaks action exits 1 on that event,
  so every queue entry would have failed. The queue now runs the pinned,
  checksum-checked CLI over the history that lands.
- **No interlock.** Nothing stopped PRs taking the fast tier with no queue
  behind it, so they would have merged with no full gate. PRs now get the
  fast tier only after the maintainer sets `CI_MERGE_QUEUE=on`, once the
  ruleset has the queue.

Blocker for the owner: GitHub's documentation offers merge queues only in
organization-owned repositories, and this one is user-owned. Until that is
settled, PRs keep the full tier and no check is weaker than before. Record:
`docs/certification/ciflow.md`.

<!-- plan-archive:end id="7-0105" -->

<!-- plan-archive:begin id="7-0106" lines="43497-43518" bytes="1560" sha256="1a1c8d542e35784dd62d5394173d34091ab0925a5a2c77cb638e38bd0ae1e99e" -->

**FIXM92E lane boundary (2026-10-04).** The rig brief and shared lane
rules prohibit aggregate quality/full unit runs and merging in this worktree.
Use focused owning tests and the required static gates/build, with hooks on;
full quality, coverage, cross-platform and hosted checks remain the lead's
integration gate. No gate configuration changes.
**M96CINT round-2 merged-source proof (2026-10-05).** Reviewed C
(`52d04b69`) and O (`19bb0703`) are merged, in order, with normal hooked
`--no-ff` commits. Real C predictions now retain both attempt identities
through the shared strict event schema, S's event boundary and T2's live
answers/notes. The pre-fix regression and two guard mutations fail, then
restore SHA-256-exactly and pass. Macmini passes 384 tests in 32 complete
files; only O's two unchanged native PowerShell/Windows guards skip. All
five compiler projects, harness typecheck, full lint/Prettier, plain knip,
duplication (0 clones), localization (0 problems), production and merged-team
cycles, regenerated host API, build, all 17 unchanged caps and regenerated
notices pass. The prior inventory mismatch is resolved. S's 261-line
`teamPool.ts` remains byte-identical; the lane-A reconciliation note records
C/O's concrete ports and unchanged scheduler region. See
`docs/certification/m96c-int.md`, `m96c-int-round2-drills.json` and
`m96c-int-round2-gates.json`. Full quality, native Windows/editor/live checks
and X2 runtime wiring/public docs/package remain assigned to the M96
integration under the rig brief; no source/gate is weakened.

<!-- plan-archive:end id="7-0106" -->

<!-- plan-archive:begin id="7-0107" lines="43575-43582" bytes="600" sha256="00ee7bdb376058f84655569dc1401ff2be7ef0cd3c1c73ecba1422271a064a6f" -->

**M97FIN SAST resource correction (2026-10-05, before implementation).**
The default full run reports five rule timeouts on the existing large host,
controller and webview files. A full-scope `--jobs 2` probe runs the same 529
rules on the same 766 targets with zero findings and zero timeouts. Bound the
SAST worker count at two for shared rigs. Keep every rule, file selection,
per-rule timeout and timeout threshold unchanged; this limits contention
rather than suppressing analysis. Restore the old dynamic TOML constructor
once to prove the configured gate still fails, then rerun full quality.

<!-- plan-archive:end id="7-0107" -->

<!-- plan-archive:begin id="7-0108" lines="43584-43602" bytes="1365" sha256="c11523577d3f2d10f9a7a9bc546e10c60732988ddcc69d9c2d4ad46ac517d601" -->

**M97FIN package follow-up (2026-10-05, before implementation).** The new
verified fixes/export/translation controls measure 2,256,312 bytes, 3,512 over
the unchanged VSIX cap. Higher DEFLATE-memory/strategy probes do not fit.
Whitespace-only compaction of packaged UI/nls JSON measures 2,247,264 bytes;
all parsed values are identical. Compact only those archive entries, leaving
source tables and every runtime/scanner/attribution asset byte-exact. Retain
entry order/comments/metadata and atomic replacement; malformed JSON refuses
rather than publishing. Tests must prove values, ordinary bytes and refusal.

**M97 package compression (lane I, before changing the package script).**
The universal VSIX initially measures 2,260,558 bytes, 7,758 bytes above the
unchanged 2,252,800-byte cap. A maximum-DEFLATE probe preserves every archive
entry's uncompressed bytes and measures 2,249,578 bytes. The package command
will recompress its own VSIX through Python's standard-library `zipfile`
(maximum level), preserving paths, metadata and content; no npm dependency is
added and no cap changes. Red/green archive-content tests certify the step.
Python is already required for this repository's semgrep tooling. Duplicate
raw SPDX arrays need not ship separately: the lazy bundle contains all pinned
identifier data, and each package retains its notice/provenance.

<!-- plan-archive:end id="7-0108" -->

<!-- plan-archive:begin id="7-0109" lines="43604-43609" bytes="467" sha256="fc8e4fb1a4b5be31495d4fbda664108b732223173bb2d5276449fc6237be44ae" -->

**M97 integration deferral (2026-10-04).** Lane S's current English scanner
prose is a named delivery blocker under AGENTS rule 5; a passing localization
inventory does not prove that prose was translated. No rule, threshold or
ignore is changed. Other M97 acceptance gaps are named in §9 and the aggregate
certification record. Full quality and package receipts are recorded there on
the integrated tree; an open checklist item stays open until its receipt exists.

<!-- plan-archive:end id="7-0109" -->

<!-- plan-archive:begin id="7-0110" lines="43611-43616" bytes="446" sha256="d482c95ef0a18cf4fed43bdb9baf0685dc043eca4b7537bdb7770390697b09f0" -->

**M97 planning lane (2026-10-04).** Documentation only; its brief forbids this
lane's aggregate quality run and delegates it to the lead. Changed Markdown,
commit hooks and rig static/build results are recorded in
`docs/certification/m97-research.md`. No executable file or new test/guard is
delivered; no runtime acceptance or gate-fire certification is claimed. M97's
implementation checklist above remains open, with existing gates unchanged.

<!-- plan-archive:end id="7-0110" -->

<!-- plan-archive:begin id="7-0111" lines="43618-43624" bytes="510" sha256="dcba6a301bc2e975ec02dc79de5a157480c1a2966e21fc97fac64676791860fd" -->

**MG69 merged-source proof (2026-10-02).** Kubuntu passes 49 owning/merged
files (2,056 tests; two existing Windows-only cases platform-skipped), all
five compiler projects and every required static gate. Both review and import
bundles remain lazy and within unchanged caps; host API and notices are
regenerated there. Released changelog bytes match main. Full quality remains
the lead's gate under the lane brief. See `docs/certification/mg69.md` and
`mg69-gates.json` for snapshots and conflict resolutions.

<!-- plan-archive:end id="7-0111" -->

<!-- plan-archive:begin id="7-0112" lines="43626-43632" bytes="500" sha256="eab6303345698a7b17d90ec7dde94f61a335e860e95e2b1ee1784ef63ecfa168" -->

**M70m2 merged-source proof (2026-10-02).** Kubuntu passed 1,989 tests in
45 owning/merged files, every required static gate and the production
build under unchanged caps. Both new integration guards fail when removed;
after SHA-256-exact restoration, their two complete files pass 28 tests.
The host API record is generated from the merged source on the rig.
Full quality and installed-editor/browser acceptance remain the lead's
work, as the lane brief requires. See `docs/certification/m70m2.md`.

<!-- plan-archive:end id="7-0112" -->

<!-- plan-archive:begin id="7-0113" lines="43634-43647" bytes="1110" sha256="0ca4e2e2ef3cec7bebb9e55082453a32992a4a51a5a678bacd579bf0496f4cb6" -->

**M70m merged-source proof (2026-10-02).** The lane brief requires focused
rig checks and forbids this lane from running full quality. Kubuntu passed
1,407 focused tests and the required static gates/build; Windows 11 passed
425 Revert, atomic-file and controller tests. Real Chrome execution of the
harness's axe checks passed 20 pages. The separate standard CLI accessibility
attempt returned no DOM on all 20 pages (a one-page reproduction exited 0
with empty stdout), so that invocation cannot certify accessibility. At an actual 320px viewport, review passes and neither dialog overflows once
the harness's fixed 690px html/body widths are overridden in the driver;
share has a `scrollable-region-focusable` violation in main's unchanged
CodeBlock tool-output pre. Preserve that inherited behavior in this merge
lane and hand it to the lead. No gate, rule or deadline is weakened; the
standard capture, the narrow share keyboard-access fix and full four-machine,
installed-editor and hosted acceptance remain the lead's work. See
`docs/certification/m70m.md` for exact snapshots and conflict resolutions.

<!-- plan-archive:end id="7-0113" -->

<!-- plan-archive:begin id="7-0114" lines="43649-43670" bytes="1535" sha256="e975c5d1c15172a64553dcbacee55d46f54c6344c82057e123b861dc1f05124d" -->

**M80Bw Windows force-exit resolution (2026-10-02).** The lead's new
self-termination path passes D29 and three consecutive complete A+B runs on
both Win11 and Kubuntu (439/439 each). Windows forced process exit is 1;
buffered output may be lost, while any delivered result preserves first-stop
status and its logical exit code. Drained exits retain their original codes.
The two-second test bound, all gates and existing synchronous key cleanup
remain intact. Two Win11 guard drills failed as intended and restored exact
SHA-256 bytes. See `docs/certification/m80.md`; full quality/C/D/L/LA/LR remain
open for the lead.

**M80B Windows force-exit blocker (historical, superseded by M80Bw).** The implementation and
76 guard drills are present; Kubuntu A+B passed 437/437. Win11 passed
436/437, failing D29's unread-stderr force-exit fixture. Test-owned timestamps
show SIGINT at 624 ms, SIGTERM at 639 ms and exit 130 requested at 945 ms;
Node then waits on its blocked asynchronous filesystem pipe worker. Closing
fd 2 returned at 966 ms but did not unblock exit; using the native pipe stream
blocked signal timers instead. Both probes were reverted. common.md's explicit
two-failed-fixes rule stops this path. Keep the failing test, original limits,
and Windows gate open. The lead must resolve the Windows native I/O/termination
contract or obtain an explicit scope ruling before B/M80 can be certified.
The remaining hosted/full-quality/C/D/L/LA/LR gates are also lead-owned, not
closed by this lane. No gate or hook was changed.

<!-- plan-archive:end id="7-0114" -->

<!-- plan-archive:begin id="7-0115" lines="43672-43682" bytes="794" sha256="4e460b451d9cb3a32bfb283498ea0777fbcae141830018043d0e6b448226fd3e" -->

**MGCOH merge receipt (2026-10-02).** The merged cohort and main's M83
build on Kubuntu at 591.8/403.0/61.0/55.4 KiB for activation, Model API,
board and reviewer, under the existing 600/475/75/75 KiB caps. The M78m
budget failures below describe the earlier tree and its earlier 400 KiB
Model API cap; M78b's extraction and the approved 475 KiB decision have
resolved those failures. The focused MGCOH suite passes 1,727 tests in
32 files, including the compiled bundles and split-guard red/restored
drills. All five compilers and the required scoped static gates pass;
PLAN formatting from the conflict union is repaired on the rig. This lane
does not run full quality, installed-host or release certification: those
remain with the lead. See the MGCOH record in `docs/certification/m78.md`.

<!-- plan-archive:end id="7-0115" -->

<!-- plan-archive:begin id="7-0116" lines="43684-43701" bytes="1220" sha256="8456972c7defd7a3c1ae8576b56076cde4da78a0bd20bf416c94828e3471d559" -->

**M78m production-budget blocker (2026-10-02).** The merge's required
Kubuntu checks pass, but the additional production build fails the unchanged
600 KiB activation and 400 KiB Model API caps. The clean pre-merge branch
`1372f047` also fails: 603.5 KiB and 404.4 KiB. With main `e66263f1`
merged they measure 613.0 KiB and 406.0 KiB. This lane preserves all features
and the M77 resume decision against a controller split; it defers the
broader bundle-size repair to the lead rather than introducing a new loader
or changing a cap. The budget gate still fails, so aggregate quality and
release readiness remain blocked until that repair passes. This is a
recorded remediation deferral, not a passing build or a gate waiver. Exact
rig snapshots, results and logs are in `docs/certification/m78.md`.

The additional focused accessibility run also exits 1: all 32 pages
(eight cohort/M74/M84 scenarios in four themes) return no axe result. The
same symptom is recorded on main's M74 branch; its cause remains
unisolated. No browser-accessibility pass is claimed, and no machine
setting or gate is changed to force one. The lead must resolve this
browser/harness blocker before claiming aggregate quality or accessibility.

<!-- plan-archive:end id="7-0116" -->

<!-- plan-archive:begin id="7-0117" lines="43703-43709" bytes="517" sha256="a5fa62f8fb91f0cc7b37d54a81cb759435a398923b26d3f1e8b4adf5fb075c37" -->

**M76b lane boundary (2026-10-01):** the owner's `common.md` explicitly
forbids a full `npm run quality` or full unit run in this shared lane and
assigns aggregate quality, coverage, accessibility, editor/platform and
release gates to the lead. `M76b.md` also excludes the candidate merge this
round. Finding commits use normal lint/format/secret hooks; the required
focused tests and eight local lane checks pass. These results do not close
the lead's remaining certification gates or change any gate configuration.

<!-- plan-archive:end id="7-0117" -->

<!-- plan-archive:begin id="7-0118" lines="43711-43729" bytes="1377" sha256="03b33df39a18bbccdc0d6542b060f3294792a428e8e1122a92e8be3ad525deb3" -->

**PR #61 compatible dependency update (2026-09-30, planned before pins):**
preserve Dependabot head `6155ada0` and integrate its SDK 1.5.0, jsdom 30.1.1
and Prettier 3.9.9 updates in an isolated worktree on main `32709441`.
Keep TypeScript 6.0.3: the rechecked `typescript-eslint@8.70.1` peer range is
`>=4.8.4 <6.1.0`, so the grouped TypeScript 7.0.2 update is incompatible:
`.github/dependabot.yml` ignores TypeScript major updates (an entry to remove
when typescript-eslint admits 7) and `test/unit/manifest.test.ts` holds it.
SDK 1.5.0 accepts the pinned zod 4.6.5 and adds optional notice schemas;
the existing ACP v1 connection implementation is unchanged. This change
does not emit, advertise or implement those new notices or the v2 alpha
protocol. No new wire shape is inferred from this upgrade. jsdom keeps
its existing Node `^22.22.2 || ^24.15.0 || >=26.0.0` development floor;
Prettier requires Node >=14. Inspect the exact resulting lock delta and
audit before testing. Acceptance remains open until all five types,
ACP/runtime and webview tests, formatting, independent review, exact-tree
full quality on all four local environments and hosted CI pass. The
primary 0.10 release retains rig priority. `docs/certification/pr61-dependencies.md`
records primary release sources and actual evidence; no paid or live model
call is authorized for this dependency work.

<!-- plan-archive:end id="7-0118" -->

<!-- plan-archive:begin id="7-0119" lines="43731-43758" bytes="2118" sha256="4897bb2173e9e193ef6d2dc328b85bc1717cf595a11ffe681a6ccc57dde4f307" -->

**PR #60 compatibility repair (2026-09-30; proven on the floor, release remains first).**
The owner explicitly included the Dependabot branches in the merge goal.
Prepare the exact `html-encoding-sniffer` 7.0.0 delta from original bot head
`f829f28f8ef81265722a9c862f8150e134fa3423` on main `32709441`; root retains
commit, push and normal-merge ownership. Preserve the original bot head.
Reuse `bomEncodingOf` and the sniffer's header-label normalization in the canonical HTML charset adapter:
only a BOM or valid transport header may make HTML decoding certain. The v7
XML-declaration/signature paths must not freeze an HTML page before its meta
declaration can take effect. Keep the bounded prescan and existing later-meta
reparse; write real byte-to-Markdown golden controls before accepting the delta.

Acceptance PR60-A covers BOM/header priority, invalid labels, XML prologues,
HTML meta priority and later tentative reparse. PR60-B covers UTF-16 signatures
and malformed/truncated meta through the real sniffer and converter. PR60-C
requires original-bot/source preservation, fresh peer/audit metadata, scoped
types/lint/format and assertion red/restored proofs, then the actual packaged
page worker on Node 20.18.3. Reuse existing worker-floor transport; no model,
paid call, dependency engine waiver, threshold change or full quality in this
source lane. Kubuntu bounded work yields to final M72/release gates. Merged
with main 2a30b1a0 (0.10.0, #66, #67) on 2026-10-02; the full quality gate
passed on the Mac mini at that head, and hosted CI is the merge gate. Result: sniffer 7 declares Node
22.13, but bundled into `dist/pageWorker.js` it loads and converts in VS Code
1.99.0's Node 20.18.3 (the floor), and the integration run's `minimum` label
now carries the goldens through the shipped bundle. The proof also found one
defect older than this PR: Node 20.18's `TextDecoder` reads windows-1252 as
ISO-8859-1 (the euro sign and curly quotes come out as controls), so
`textDecoding.ts` decodes that table itself on every Node. Receipts, red
drills and sizes are in `docs/certification/pr60-sniffer7.md`.

<!-- plan-archive:end id="7-0119" -->

<!-- plan-archive:begin id="7-0120" lines="43760-43784" bytes="1738" sha256="0210e97d06e343b78fe6ccdc58a70cc056cf24b465ffa966deb751f3ebc4eb7e" -->

**M80 lane D gate boundary (2026-10-02).** The M80D brief overrides the
full-suite instruction for implementing lanes: rigs only, serial focused tests,
no `npm run quality`, no live/model calls and no push. The lead owns unchanged
full quality and build/hosts/action-check matrices on the exact integrated tree.
No threshold, timeout, ignore, hook or rule is weakened.

B's real exec/scanner CLI and C's test launcher/Action are absent from this frozen
lane-A-based worktree. E1–E7/H1–H4 built/installed acceptance, actual fake test
package, recipe operational paths, reviewed immutable Action SHA and L/LA/LR
remain pending those integrations and lead receipts. The e2e file runs package
and host-harness guards now; explicit B skips are not success. Supplying an
installed package activates all built rows, so hosted jobs cannot silently
certify an old package. Standalone POSIX signal rows still skip on Windows.

Kubuntu has shellcheck at /usr/bin/shellcheck; actionlint remains absent from
PATH and searched installed locations. The supplied common.md bans network calls
except npm ci; scoped actionlint install permission was requested asynchronously.
Until an approved tool is available, actionlint remains open, never substituted
by Windows-only lint or syntax checks. Lane D's certification records each actual rig result and drill.

The generic feature-delivery validator expects a `quality-ledger` fence and
reported `input-error` against this established PLAN. Its structural gate is
deferred; the lane brief's canonical section/ID plan is preserved rather than
adding a competing ledger or rewriting the roadmap. Inventory succeeded and
manual readiness review covered v4/F1/F2, ownership, dependencies and claim limits.

<!-- plan-archive:end id="7-0120" -->

<!-- plan-archive:begin id="7-0121" lines="43786-43805" bytes="1496" sha256="f9b594901b93a3f95370d3b320a286edd05a0a130efd422825327fd17b44cfba" -->

**M75 current-main ToolIO integration repair (2026-09-30).** Exact tree
`7d1ed818` passed host, webview and integration types plus scoped lint,
format and localization, but unit/e2e types rejected the removed
`ToolIoDeps.hasUnsavedChanges` port. Seven real-disk runner assertions failed
because the same stale fixture could not inspect unsaved editor files during
conditional writes. Replace both eval adapters with the current
`unsavedFiles: () => []` port: these isolated workspaces have no open editor.
Preserve the current M68 ToolIO implementation and all assertions, then rerun
the five types, all 91 eval controls and six isolated semantic red/restored
cycles. The first duplication invocation failed to locate jscpd's current
entry point; retain that runner failure and invoke the package's declared bin.
No model call, full quality or platform certification is implied.
Repaired tree `99d45301` passed all five type projects, 91/91 eval controls,
scoped lint/format, localization and duplication (zero clones). Six disposable
semantic mutations reached their exact named assertion failures and restored
to 91/91; all archive bytes and candidate source remained unchanged. External
`m75-host-99d4-20260930/receipt.json` and `red-receipt.json` bind the proof.
Installed M68 tools were reused only after lock/npmrc and installed package
metadata equality checks; fresh `npm ci`, full quality and rig gates remain
required. See `docs/certification/m75.md`. No packing or model run occurred.

<!-- plan-archive:end id="7-0121" -->

<!-- plan-archive:begin id="7-0122" lines="43807-43813" bytes="499" sha256="1261b2c9eb0fa477607368eff5ce84d6e1174e169307f9e7b9ac6c6b203f3300" -->

**FIXM93R gate boundary (2026-10-04).** The rig brief and shared lane rules
forbid `npm run quality` and full-suite tests, reserve aggregate certification
for the lead, and prohibit merging/rebasing/pushing in this worktree. Run the
named suites and all requested static/build gates directly on Kubuntu, serially;
commit with hooks enabled. Record pending integration gates without weakening
any rule, threshold or ignore. The correction and red-drill receipts are in
`docs/certification/m93-r.md`.

<!-- plan-archive:end id="7-0122" -->

<!-- plan-archive:begin id="7-0123" lines="43815-43824" bytes="689" sha256="65e1c695b234a753f82898355cb014f694c94cd0c6405f006951932547eaf305" -->

**WINM93 gate boundary (2026-10-05).** Its rig brief and shared rules reserve
full quality/coverage for the lead and forbid merges, rebases and pushes. Run
M93 owning files (at most three per vitest invocation, three workers), the
requested static/build checks and report accessibility directly on Windows 11;
commit locally with hooks enabled. The Windows receipts are in `m93.md`.

- **FIXM93R-G-L10N (resolved by lane I, 2026-10-05):** `museSpark.reportProblem`
  is contributed; `check:l10n` reports 0 problems on the integrated tree.
- **FIXM93R-G-HOSTAPI (resolved by lane I, 2026-10-05):** the record is
  regenerated and reviewed on the integrated source; `check:host-api` passes.

<!-- plan-archive:end id="7-0123" -->

<!-- plan-archive:begin id="7-0124" lines="43826-43831" bytes="413" sha256="7893342dca37ab49bed73c2f886ba3ea0b2dcf9ef12a0e7b20139aee93417661" -->

**M93 planning lane (2026-10-04).** Documentation only. Its task-specific
`common.md` forbids a local aggregate quality run and delegates it to the lead;
the lane verifies changed Markdown and commits with hooks enabled. Product
tests, drills, build sizes and runtime certification remain M93 implementation
gates, unchecked above. Integration state and lane receipts are in
`docs/certification/m93-research.md`.

<!-- plan-archive:end id="7-0124" -->

<!-- plan-archive:begin id="7-0125" lines="43833-43841" bytes="668" sha256="bcf72591901d1bfe48b5b8f1cd6ea73b84edb4d5f8ed612a0bd17153a97a2c83" -->

**Merge goal progress (2026-09-29, America/Los_Angeles):** PR #32 merged at
17:31 (`fefb6068`), PR #57/M67 at 18:20 (`4c35e73e`), and PR #52/M69 at
19:46 (`c323dcc0`). Each passed independent review, four local full-quality
environments and exact-head hosted checks before merge. M69's tested tree
`42a65c7b` passed all four full gates, installed ACP stdio 9/9 on each rig,
actual installed page conversion and the same worker under Node 20.18.3;
all 19 triggered hosted checks passed. Its dated certification entries
describe their recording phase; the final PR body links completed CI and
Hosts runs. Other PRs and WIP branches remain under review and verification.

<!-- plan-archive:end id="7-0125" -->

<!-- plan-archive:begin id="7-0126" lines="43843-43848" bytes="466" sha256="011262219dd8d8a92b6ecb80e84a2d0a7c1eb480dca6e6605621fc509a5e9be1" -->

**PR #51 integration review (2026-09-29):** preserve the contributor's four
Android/Termux unit cases for launcher discovery, credential-path selection
and unavailable voice helpers. Integrate the two test files into current main;
prove these checks fail under deliberate behavior changes, then run exact-tree
quality and the local rig gates. No production change or physical Android
certification is implied. `docs/certification/pr51-termux-tests.md` tracks proof.

<!-- plan-archive:end id="7-0126" -->

<!-- plan-archive:begin id="7-0127" lines="43850-43864" bytes="1160" sha256="2138d52f767a76d935b648dfa1506c4694053dc777ae3fcd0d33af903dd20837" -->

**PR #32 final review reopened (2026-09-29, head `46ba5406`):** independent
reviews found a pending-release/reload ownership race in the ACP session state,
cross-process whole-file paid-grant updates that can resurrect a revoked grant,
and an unquoted absolute staging argument in Windows npm packaging. Repair
session ownership across awaited release, replace shared grant read/modify/write
with authoritative independent records and revocation, and run npm packaging
from its staging working directory with fixed relative arguments. Add realistic
regressions and red/restored proofs; correct VSCodium/fork evidence wording to
distinguish development-extension integration from packaged installation.
`docs/certification/pr32-integration.md` records findings, fixes and fresh gates.
The same review also found an unobserved prompt-completion rejection when the
backend exits while a turn starts, and a late paid-use answer that can install
an always grant after its prompt was cancelled. Observe completion failures from
creation and bind permission answers to the owning active prompt, with SDK and
real MSP/session regressions for these lifecycle siblings.

<!-- plan-archive:end id="7-0127" -->

<!-- plan-archive:begin id="7-0128" lines="43866-43875" bytes="790" sha256="384dac1555c19f9cb8e6744559a844aafe397cdbc927b17bf8006c8888b8eb54" -->

**Merge-completion goal (owner authorization, 2026-09-29):** complete and
properly merge the existing cloud-work branches and open PRs into main by the
end of the owner's day (America/Los_Angeles). Start with PR #32's final review;
then choose integration order from dependencies and verified readiness. Parallel
agents may review and fix separate worktrees; one integrator owns merges and
aggregate gates. Preserve existing work and the D49 acceptance contracts. Fix
findings, perform the required red proofs, review and gate each final candidate,
and inspect hosted checks on its exact SHA before merging. The date target does
not waive a gate or make an unverified draft complete. Record remaining external
or implementation blockers with their next safe action if the target is missed.

<!-- plan-archive:end id="7-0128" -->

<!-- plan-archive:begin id="7-0129" lines="43877-43888" bytes="934" sha256="d98fbd459d76f5b05565c05addec98dcda13ec0748c8ea75e53e00fa0f42368f" -->

**Local platform proof restored (owner correction, 2026-09-29):** use the
available Mac mini, Kubuntu VM and Windows 11 VM before pushing a candidate,
alongside the Windows host. Recover the existing rig workflow from the project's
Claude memories and verify its current access and toolchain. Bind every result
to the candidate tree and record process exits; hosted CI confirms that proof.
PR #32 candidate `22f62ed1` passed the full Windows-host gate, Hosts and Forks,
but hosted macOS and Windows both timed out in one new paid-grant race test.
An owned temporary-directory junction reproduced that same failure locally:
the fixture compared its lexical path with an atomic writer's canonical path.
Canonicalizing the fixture makes all 22 paid tests pass under that alias.
Timeouts, production behavior and quality thresholds are unchanged. Fresh full
gates, independent review and local rig proof remain required before repushing.

<!-- plan-archive:end id="7-0129" -->

<!-- plan-archive:begin id="7-0130" lines="43890-43899" bytes="750" sha256="82399927a32b360c36bce6fef52217f8b285f3e1216b7359b1dce8d7f1bc20c9" -->

**Windows 8.3 follow-up (2026-09-29):** `74f3c2cf` passed all four local
full gates and hosted Linux/macOS, but hosted Windows still timed out in that
same fixture. The local junction proof did not cover actual short names.
`GetShortPathNameW` reproduced the runner's path form locally: JavaScript
`realpathSync` keeps 8.3 names, while `realpathSync.native` expands them as
the atomic writer's `fs.promises.realpath` does. The fixture now uses the native
method. The original short-path case exited 1 at 5,000 ms; all 22 paid tests
passed afterward under the same short path. Fresh Windows host/VM full gates
must run with actual short-name temporary paths before the next push; the Mac
and Kubuntu gates also rerun. No production or timeout change.

<!-- plan-archive:end id="7-0130" -->

<!-- plan-archive:begin id="7-0131" lines="43901-43914" bytes="952" sha256="c255e0b2fb804abe19729692f1d968994cdfccfd330e2f766ff6c72719f65579" -->

**Pre-PR delivery, historical (2026-09-26: trigger merged at `10522223`; first manual
branch dispatch run `36276240077` succeeded on head `ac9df5a` in all seven
jobs).** The owner
wants platform failures found and fixed before a pull request is opened.
`ci.yml` gained `workflow_dispatch`, calling the same `build.yml` as pushes and
pull requests. `CONTRIBUTING.md` gives the order: integrate milestones, run
local quality on the exact tree, collect platform evidence, get an independent
review, push, dispatch hosted CI and inspect its SHA and every job before
opening a pull request. No build job or threshold changed. GitHub requires a
manually dispatched workflow on the default branch, so the first pre-PR branch
run could happen only after this trigger landed on `main`. Its recorded
run and job evidence proved that process. The manual pre-PR dispatch policy
was superseded by the M52 cleanup below; pull-request CI and review still
gate merge.

<!-- plan-archive:end id="7-0131" -->

<!-- plan-archive:begin id="7-0132" lines="43916-43926" bytes="831" sha256="101dacf5e66b02acde831082ade5070196c86c88f35039e7b4046390dc0713cc" -->

**M52 CI trigger cleanup (done 2026-09-26, PR #40 `93ea81c`).** The owner
uses exact-tree local and VM gates as the pre-PR filter, then opens one pull
request whose event runs the seven hosted jobs. A separate routine manual
branch dispatch duplicated that run, and a protected merge of a reviewed PR
already has the same code tree, so the automatic `push` to `main` duplicated
the seven jobs too. The `ci.yml` main-push trigger was removed; `pull_request`
and optional `workflow_dispatch` remain for a deliberate branch check without
a PR. The release workflow is still tag-triggered and calls the shared
`build.yml`; no build jobs or thresholds changed. Contributor instructions, PR
proof fields, the README and workflow comments were updated to match, and the
trigger was verified locally with a red drill before the M52 merge.

<!-- plan-archive:end id="7-0132" -->

<!-- plan-archive:begin id="7-0133" lines="43928-43968" bytes="15839" sha256="94e49fda8941a4975e0b8b5d7eb49f3346a48cf75b2999e2c4673854bb78afa4" -->

**M75 platform fixture correction (2026-09-29, preliminary Mac proof).**
The verifier still starts with `env: {}`. MacOS/CoreFoundation nevertheless
generates `__CF_USER_TEXT_ENCODING`: an independent child with its parent
variable removed and an explicit empty environment observed only that key.
The environment-isolation test permits exactly this name only on Darwin,
keeps all other unexpected names forbidden, and checks an unusable credential
canary is absent. This corrects an observed OS assumption; no production
environment policy, gate level or threshold changed. The old assumption's
80/81 result and the earlier Request-unaware fake's 63/81 result are retained
as fixture findings, not successful red proofs or current-main certification.
The refreshed old-base Mac snapshot `85897211`/tree `d88477db` passed all
81 eval tests before and after five intended production mutation failures,
host/unit types, scoped lint/format, and the normal duplication gate. Its
receipt is `m75-mac-preliminary-final-scope/receipt.json` under the owned
external evidence directory. Exact source restoration was verified; model
attempts and paid calls were zero. This is preliminary proof only:
independent review, current-main integration and full rig gates remain open.

| Gate                  | Command                                                                                                                                                                                                                                                | Status                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format                | `prettier --check .`                                                                                                                                                                                                                                   | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Lint (type-aware)     | `eslint . --max-warnings=0`                                                                                                                                                                                                                            | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| CSS lint              | `stylelint "src/**/*.css" --max-warnings=0`                                                                                                                                                                                                            | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Types                 | `tsc --noEmit` over five projects: host, webview, unit, e2e, integration (`npm run typecheck`)                                                                                                                                                         | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Dead code             | `knip` (not `--strict`; see knip.jsonc)                                                                                                                                                                                                                | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Cycles                | `node scripts/cycles.mjs`: dpdm `--no-warning --no-tree --exit-code circular:1 -T` over the roots in `scripts/cycles.json`                                                                                                                             | M0 ✓; M57: the Model API bundle's entry added, without which its files left the check (227 files analysed instead of 203); PR #32: the ACP agent's entry; CIFIX017W2: the roots left the command line, which outgrew cmd.exe's 8,191 characters on Windows                                                                                                        |
| Duplication           | `jscpd` (config `.jscpd.json`: threshold 0 over `src` and `test`)                                                                                                                                                                                      | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Unit tests + coverage | `vitest run --coverage`; thresholds 90 % statements, 85 % branches, 90 % functions and lines (D5); Windows runs test files serially (M50)                                                                                                              | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Integration tests     | `vscode-test` (two configurations: `stable` and `minimum`, the `engines.vscode` floor)                                                                                                                                                                 | M0 ✓ (9 passing locally since M18; CI: ubuntu xvfb + windows); M26 ✓ on 1.139.0 and 1.125.0, downloads cached in CI                                                                                                                                                                                                                                               |
| Build + bundle budget | `node scripts/build.mjs --production && node scripts/check-bundle-size.mjs`                                                                                                                                                                            | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Bundle split          | `node scripts/check-bundle-split.mjs` (part of `npm run build`): the Model API backend's lazy files stay out of `dist/extension.js` and in `dist/modelApi.js`, and every file of `src/core/backends/modelapi/` is on the lazy or the allowed list (D6) | M57 ✓ (drills in `docs/certification/m57.md`)                                                                                                                                                                                                                                                                                                                     |
| Host globals          | `node scripts/check-host-globals.mjs` (part of `npm run build`): no `navigator` in the host bundles (`extension.js`, `modelApi.js`, `searchWorker.js`)                                                                                                 | M26 ✓ (proof R); M57 ✓ for `modelApi.js` (drill in `docs/certification/m57.md`)                                                                                                                                                                                                                                                                                   |
| Third-party notices   | `node scripts/third-party-notices.mjs` (part of `npm run build`; `npm run notices` regenerates)                                                                                                                                                        | M26 ✓ (proofs P, Q; CI's package job requires the file in the .vsix)                                                                                                                                                                                                                                                                                              |
| Dependency audit      | `node scripts/audit.mjs` (`npm audit --json`, high and critical block; reviewed exceptions in `.github/audit-exceptions.json`, 90 days at most)                                                                                                        | M0 ✓; M26 ✓ (proofs S–W)                                                                                                                                                                                                                                                                                                                                          |
| Secrets               | `gitleaks git --redact` (history, `security:secrets`, also a CI job) and `gitleaks git --pre-commit --staged` (hook)                                                                                                                                   | M0 ✓ (staged-scan proof; the history scan runs locally and in CI)                                                                                                                                                                                                                                                                                                 |
| SAST                  | `node scripts/sast.mjs` (`npm run security:sast`): `semgrep scan --config auto --error`, with semgrep found on PATH or, failing that, in a Python's user Scripts folder                                                                                | M2 ✓ locally (pip-installed on Windows 2026-09-22, its Scripts folder added to the user PATH) and in the CI `sast` job. M26: CI pins semgrep 1.177.0 (`.github/semgrep/requirements.txt`, Dependabot pip).                                                                                                                                                        |
| PowerShell lint       | `node scripts/lint-ps.mjs` (PSScriptAnalyzer over `native/windows`, `npm run lint:ps`)                                                                                                                                                                 | M9 ✓ on Windows (exit = finding count; a reported skip on other platforms; installed on the CI Windows runner). M26: pinned to 1.25.0 (`-RequiredVersion`), the version CI installs. CI falls back to the Gallery's package endpoint, checked against the pinned SHA-512, when its search answers "No match" (2026-09-27; drill: a wrong hash stops the install). |
| Accessibility         | `node scripts/a11y.mjs` (`npm run test:a11y`, in `quality` after the build; in CI on Linux and Windows): axe-core over every harness scenario in the four default themes, WCAG 2.2 AA                                                                  | M37 ✓ (proofs A–G, J–M); Lighthouse itself is not run (D32)                                                                                                                                                                                                                                                                                                       |
| Localization          | `node scripts/check-l10n.mjs` (`npm run check:l10n`, in `quality:gates`): every table in `l10n/` against the English table, strictly; the manifest against `package.nls.json`; no `UI_TEXT` read at module load                                        | M40 ✓ (drills in `docs/certification/m40.md`)                                                                                                                                                                                                                                                                                                                     |
| Host API record       | `node scripts/check-host-api.mjs` (`npm run check:host-api`, in `quality:gates`; `--write` regenerates): `docs/ide-compatibility/host-api.md` against the source, and the portable code never reaching `vscode`                                        | M60 ✓ (drills in `docs/certification/m60.md`)                                                                                                                                                                                                                                                                                                                     |
| Hosts                 | `hosts.yml` (VSCodium, code-server, Theia, the agent package and key store, Jupyter, Emacs, Neovim) and `forks.yml` (Cursor, Devin Desktop, Kiro, Positron), CI only: each job runs one `test/hosts` script                                            | M62/M63 ✓ locally (drills H1–H5 in `m63.md`, F1–F2 in `m62.md`); the forks only on GitHub's runners                                                                                                                                                                                                                                                               |

<!-- plan-archive:end id="7-0133" -->

<!-- plan-archive:begin id="7-0134" lines="44017-44035" bytes="1334" sha256="0ef6a8ccce30be97f5a4eee75e07e37825b4aa5a3d367875475dcc411c766491" -->

**M101 C2 imported-suite baseline deferral (2026-10-05, kubuntu).**
The 373-file importing inventory (plus two related document/build suites)
passes 7,654 tests after updating ACP's exact awaiting-evaluation notice
and CLI default-option expectations. Five unchanged files retain 27 failed
assertions and one beforeAll packaging failure: execStdio's 22 missing
validation-bundle fixture assertions, execTestLauncher's missing validation
fixture setup, ChatViewProvider/chatPanel's four stale module-script
assertions, and handoffDialog's deferred Account & usage assertion. They
reproduce on merged base `68ca19f5` with all 14 changed tracked source/test
inputs restored to that base, then restored byte-exact to the final lane.
The six launcher scenarios never start because their fixture setup fails;
existing platform skips remain. The initial scan also encounters the generic
live file, whose two existing opt-in tests stay skipped; it is excluded from
the corrected authorized inventory. Zero live/paid attempts. No skips,
filters, timeout/threshold changes or assertion weakening are introduced.
The integrator owns these unrelated repairs and the full/platform quality
wrapper, which the rig common brief expressly prohibits this lane from
running. Receipts and activation prerequisites are in
`docs/certification/m101-c2.md`.

<!-- plan-archive:end id="7-0134" -->

<!-- plan-archive:begin id="7-0135" lines="44037-44060" bytes="1737" sha256="f4c84396b2e973a9aa8c6dfa221bbd559f70d501abb71fbe2a1203b945532e5c" -->

**M101 C1 imported-suite baseline deferral (2026-10-05, kubuntu).**
The scoped static gates and owning suites pass. The required imported sweep
finds two pre-existing `chatPanel.test.ts` assertions expecting
`<script nonce=` while the unchanged `src/host/html.ts` emits
`<script type="module" nonce=...>`. Both failures reproduce with the base
`60bf96aa` host, constants and English table; each source file is restored
byte-exact. The other two files in that batch pass. The handoff dialog test
“keeps a brief that arrives while /usage is open waiting until it closes”
also fails on both base and final trees: it asks for the Account & usage
dialog during the deferred surface's loading state. This lane does not own
those UI surfaces or tests, so the integrator must repair the two files and
rerun them. No assertion, test filter, threshold, timeout
or gate setting is changed here; the imported sweep retains the failing
receipt. See `docs/certification/m101-c1.md` for final results.
**M101-O composed-read validation residual (2026-10-05, win11).** A newly
drafted host/transcript assertion failed after a fixture-path repair and a
transcript assertion repair. Stop that assertion path under the common
brief's two-fix rule; the abandoned draft added no skip or change to an
established test. The budget function and its real `executeTool('read_file')`
call pass and fire red when either guard is removed. The host's model-to-tool
budget injection is present and reviewed; its additional composed transcript
assertion remains for integration. M95 registry/client wiring, E's actual
overflow captures and C2's recovery remain prerequisites outside this lane.
Full quality and release certification remain the integrator's checks.

<!-- plan-archive:end id="7-0135" -->

<!-- plan-archive:begin id="7-0136" lines="44062-44067" bytes="420" sha256="644d560db07e67457cd8aaacc6fbb07f6198e17622d61ee1a6a0b37a46149f37" -->

**FIXM95P host API record deferral — closed by M95INT (2026-10-05).**
Integration regenerated the complete record (276 APIs, 22 adapters, 23
Node built-ins, 59 theme variables) and the unchanged check passes. The
combined-tree diff includes crypto 33→35, fs/promises 34→35, net 3→4,
path 65→66 and the Models panel stylesheet in the theme source list.
The original isolated-lane report follows for provenance.

<!-- plan-archive:end id="7-0136" -->

<!-- plan-archive:begin id="7-0137" lines="44069-44110" bytes="3327" sha256="47d8cdd57977f8357c3543cc1f30df2df45064b9fc334a9421c865f58280dbf3" -->

**FIXM95G build deferral (2026-10-05).** The correction lane fixes all six
assigned Gemini review findings and runs the required focused gates on
Kubuntu. `npm run build` generates all production bundles within their
unchanged caps, then exits 1 at the existing bundle-split gate because
`src/core/backends/modelapi/codecs/gemini.ts` is on neither classification
list in `scripts/check-bundle-split.mjs`. This unwired codec and missing
registration predate the fixes. Gate-script/provider integration ownership
is outside lane G; the brief prohibits widening this lane's files or any
guard. No ignore or rule is changed. Follow-up: the lead's integration lane
classifies/wires the provider codec under D74's lazy-bundle contract, reruns
the build and combined full quality, and records certification before
release. `docs/certification/m95-g.md` records the failed build and the
separately run later build checks; no successful full-build claim is made.
**FIXM95A gate delegation (2026-10-05).** The owner's rig brief expressly
forbids a full `quality` / full-test run and integration merges in this
lane. Local focused suites, five-project typecheck, scoped lint/format,
localization, host API, knip, duplication, cycles and production build run
here; the lead must run full quality on the integrated tree. No threshold,
ignore or rule is weakened. `docs/certification/m95-a.md` records results.
M95 K repair: FIXM95K/common.md delegates full quality to the lead. The new
activation-growth test passes at 2,901 bytes versus 3,072; no threshold
or test was weakened. Final M/U integration remains a certification gate.
**FIXM95H gate boundary (2026-10-05).** The rig brief requires scoped
tests and static/build checks here; full `npm run quality` is the lead's
integrated gate. Chat's existing bundle-split registration failure belongs
to lane W, which the brief explicitly forbids this lane from editing. Keep
the gate unchanged and record its exact failure and passed size budgets in
`docs/certification/m95-h.md` before integration.
**FIXM95SC gate deferral: RVM95SC-R-host-api-record (2026-10-05).** After
required merges, `npm run check:host-api` exits 1 solely because generated
`docs/ide-compatibility/host-api.md` has stale Node import counts:
`node:crypto` 32→33, `node:fs/promises` 34→35, `node:net` 3→4,
`node:os` 6→7, `node:path` 65→66. Membership and API rows have no reported
difference; the fresh receipt reports 279 VS Code APIs, 19 importing files,
23 Node built-ins and 57 theme variables. FIXM95SC's redactor import is
unchanged; its new imports are test-only. The generated record is outside
the lane brief's allowed files, so lane W/lead must run
`npm run check:host-api -- --write`, review these five counts and rerun the
unchanged gate on the integrated tree. No gate is disabled or weakened, and
this lane does not claim all gates or full quality green. See §9 and the
S/C certification records.
| SAST | `node scripts/sast.mjs` (`npm run security:sast`): `semgrep scan --config auto --error --jobs 1`, with semgrep found on PATH or, failing that, in a Python's user Scripts folder | M2 ✓ locally (pip-installed on Windows 2026-09-22, its Scripts folder added to the user PATH) and in the CI `sast` job. M26: CI pins semgrep 1.177.0 (`.github/semgrep/requirements.txt`, Dependabot pip). |

<!-- plan-archive:end id="7-0137" -->

<!-- plan-archive:begin id="7-0138" lines="44112-44116" bytes="393" sha256="30af7a5edc3e1db8a709c5549d1399754ac52f61f7915a8d7e17eb3fa157ed87" -->

**M101-A gate boundary (2026-10-05).** The rig brief requires owning and
importing suites in batches of at most three, all static gates and production
caps directly on Kubuntu. It prohibits a full `npm run quality` and integration
merges here. The integrator owns full quality on the combined tree; no gate,
threshold, exemption or ignore is changed. Receipts: `docs/certification/m101-a.md`.

<!-- plan-archive:end id="7-0138" -->

<!-- plan-archive:begin id="7-0139" lines="44118-44129" bytes="891" sha256="322bd3fb1887a799af6466809d0c9b650af952b12630455069f5e0e9adb52b61" -->

**M101-A untouched UI-test deferral (2026-10-05).** The complete scoped
282-file sweep reports 6,367 passed, five failed and 29 existing platform
skips. Four `ChatViewProvider.test.ts` / `chatPanel.test.ts` assertions expect
`<script nonce=`, while the base's `src/host/html.ts` emits `<script
type="module" nonce=`. One `handoffDialog.test.tsx` case expects the base's
lazy Account & usage dialog synchronously. All four files match `60bf96aa`
byte-exact; a three-file rerun with the base English table reproduces all
five failures, followed by exact SHA-256 restoration of Lane A's English
source. These UI-owned files are outside the lane's edit authorization.
Keep the gate failing and assigned to integration; no assertion, ignore,
timeout or threshold is weakened. Owning suites, five-project typecheck,
static gates and production caps pass. Receipts: `docs/certification/m101-a.md`.

<!-- plan-archive:end id="7-0139" -->

<!-- plan-archive:begin id="7-0140" lines="44131-44143" bytes="889" sha256="2585e9b6cbdd10b1a173de056f973dda57d9b60e1781ccd22e2757c49834cee3" -->

**M101-A untouched package-fixture deferral (2026-10-05).** The fake-only
exec/ACP/launcher run reports 23 passed, 22 failed and six launcher rows not
reached after its package hook fails. Base packaging scripts already require
`validation.js`; both base package fixtures omit it. The scripts and tests
match `60bf96aa` byte-exact. ACP and built exec conversations pass; the
separate fake CLI/account/README batch passes all 41 tests. The fixture repair
belongs to integration, outside Lane A. No test is filtered or weakened, and
no failed package rows are claimed green. Receipts: `docs/certification/m101-a.md`.

**FIXM101T lane receipt:** the rig/common brief forbids a full quality run
and main merges here; the lead must run full `npm run quality` before
integration. Direct lane checks, build caps and red drills are recorded in
`docs/certification/m101-t.md`; no gate is weakened.

<!-- plan-archive:end id="7-0140" -->

## Closed release gate records (2026-09-27 and 2026-10-04)

<!-- plan-archive:begin id="gates-715277eb2-36361" lines="36361-36374" at="715277eb2" bytes="991" sha256="e792ad52ded3692e20c47c47a461da97bb844303eabed3c9c824b0837acea201" -->

**MRG78 browser size blocker (2026-10-04; resolved by FIX78W).** The merged production
build emits `dist/webview/main.js` at 935,470 bytes (913.5 KiB), over its
unchanged 900 KiB cap. A build of `main-sync` `244d5905` using the same
browser options emits 910,023 bytes (888.7 KiB). Every Node bundle fits;
the M71 model text block is registered with main's split gate and its
positive/negative controls pass. The rig brief permits merge repairs only;
an unrelated browser refactor or a new loading architecture is deferred
to the lead. No cap, threshold, hook or feature has been weakened. This
merge is not aggregate-green or ready to release while that gate fails.
Bounded receipts: `docs/certification/mrg78.md`. FIX78W closes the size
blocker with the unchanged 900 KiB cap applied to the entry and all static
imports (898.4 KiB); its production build and bundle checks pass on Kubuntu.
Full quality and native/hosted certification remain lead-owned. See
`docs/certification/fix78w.md`.

<!-- plan-archive:end id="gates-715277eb2-36361" -->

<!-- plan-archive:begin id="gates-715277eb2-36672" lines="36672-36678" at="715277eb2" bytes="491" sha256="32a89487fe43044333171946056bae7ce0906aac645d78f13d06786103606e1a" -->

**Resolved 2026-09-27: the bundle budget after M48–M56 joined M60–M63.**
The joined tree's build failed its size check (`dist/extension.js` 600.5
KiB against 600, `dist/acp.js` 874.1 KiB against 800) and no budget was
raised. Main's M57 took the Model API backend out of both: the extension is
432.5 KiB under its unchanged 600 KiB, and the agent, which loads the same
`dist/modelApi.js`, 713.2 KiB, whose budget is now 850 KiB (D6 amendments;
`docs/certification/pr32-integration.md`).

<!-- plan-archive:end id="gates-715277eb2-36672" -->

## 0.16.0 release repair and 0.17.0 integration lanes (2026-10-07 – 2026-10-08)

<!-- plan-archive:begin id="gates-c54550e6d-34023" lines="34023-34062" at="c54550e6d" bytes="3511" sha256="a880a6e94c142343edead2557013e841fe1a99db5a33c702c4d98febcd2233d9" -->

**FIX0160X scoped release repair (2026-10-07).** The shared lane brief
prohibits aggregate quality and reserves it for the lead. This lane runs
every named owning file at repository deadlines and all prescribed individual
compiler/static/build/package checks. No threshold, deadline, assertion or
package refusal is waived. Hosted cross-platform qualification remains with
the joined release; receipts are in `docs/certification/fix0160x.md`.

**DEP138 rig verification.** The lane's rig note limits each test invocation
to three files. Certify every configured unit/process-e2e file in batches of
at most three, with `CI=true`, V8 coverage and repository deadlines. Partial
blob reports use the repository's existing shard handling; merge every report
with the original global thresholds enabled. Run every other locally runnable
quality gate separately in the same fresh `npm ci` clone. The monolithic
`npm run quality` is deferred only because its test command exceeds the rig's
explicit file cap; no gate, assertion, file, threshold or timeout is removed.
The certification record must name every actual exit and any unavailable
platform/hosted checks rather than claim an aggregate-command pass.
Amended 2026-10-07 (lead): the rig's batched coverage run was not completed.
Hosted CI on the pull request is the full gate for coverage and the
accessibility harness (merged coverage on three OSes with the original
thresholds and deadlines, accessibility on Ubuntu, static gates with lint at
the unchanged 6144 MiB heap on three OSes; pull requests run the full tier
while `CI_MERGE_QUEUE` is not `on`). None of the bumped packages takes part in
the harness, and main's PR #139, merged into this branch, fixed harness
readiness.
The rig's failed first full accessibility run stays in the record.

**MACSLOW bounded certification (2026-10-07, macmini).** The lane's shared
rules prohibit aggregate quality and delegate it to the lead. Run complete
owned files directly, at default timeouts, three times after the explicitly
authorized clean; run each requested compiler/static/build gate separately.
The unit gate retains all 1,864 configured roots and strict options across five
sequential programs, sharing ambient declarations and matcher setup. Measured
peak RSS falls from 2,767,564,800 to 1,688,055,808 bytes (39%); no heap override,
timeout, retry, skip or other gate changes. Initial compiler probes exposed
ambient-type resolution and cross-file matcher/declaration scope; preserve
both through repository-local temporary configs and the shared support roots.
Final evidence is recorded in `docs/certification/macslow.md`.

**INT0170B final Linux certification (2026-10-08).** Source `2617dc15988655edb43f289db90d8e3d99f1ff68` completes 80 serial command receipts, including every requested Linux workflow phase. Static, accessibility, SAST and both secret scans pass. Coverage thresholds pass at 92.38/87.43/93.39/93.21; 15 failed tests and two hook-failed files remain, 80 reported skips/unrun, and all six visual jobs fail missing reviewed component coverage. Both actual VS Code versions pass 39 cases and fail only command registration; schedule defaults now pass. The three usage cases and all 49 plan-reader cases pass in full coverage at unchanged deadlines. Required checks remain red. The independently executed ACP registry command, unreachable after the package shell's prior assertion failure, passes against the actual installed final package; it does not change the failed package job.

<!-- plan-archive:end id="gates-c54550e6d-34023" -->

## DIET1 webview startup headroom (2026-10-06)

<!-- plan-archive:begin id="gates-c54550e6d-34076" lines="34076-34099" at="c54550e6d" bytes="1837" sha256="c983b70a0557bd899f42cb81f3995b816509c87d631c53f5565f690e86d1a050" -->

**DIET1 bounded rig certification (2026-10-06).** The user-provided lane brief
and shared rules prohibit aggregate quality and public network, merges and
pushes. The local commit uses scoped typecheck, lint/format, Knip, duplication,
localization, reference, host API, webview suites, production/split/size,
accessibility matrix, real-browser fake-host smoke and VSIX packaging. Local
packaging uses the existing named badge-network skip; CI rejects it. The lead
must run integrated `npm run quality` and hosted checks before integration.
See `docs/certification/diet1.md` for measurements and byte-exact red drills.
The initial second accessibility scan reported zero violations/undecided rules
across 628 pages but exited 1 when light/usage-install missed the unchanged
10-second readiness deadline. FIXDIET1's final complete matrix supersedes that
outstanding receipt: 628 pages (157 scenarios × four themes), exit 0, zero
violations, zero undecided rules, zero exemptions and zero missing results.
No timeout, exemption, worker policy or accessibility rule changed. The lead
still owns integrated aggregate quality and actual host/release certification.
**RVM116P lane certification (2026-10-06).** The rig brief prohibits full
quality and all merges/pushes/rebases in P; the lead runs integrated quality.
P runs default-timeout owning tests, typecheck, scoped lint/format, deadcode,
duplication, localization, host API and production budgets. The generated host API
inventory was refreshed for the new Node imports; editor bindings remain an
integration handoff. REDM116P removes the
shell-quote imports and the dependency-declaration handoff: the small advisory
warning needs no shell interpreter. The help catalog and generated reference
are checked by `check:reference`, included in `quality:gates`. Results are in `m116-p.md`.

<!-- plan-archive:end id="gates-c54550e6d-34076" -->

## Generated Help and reference lanes (2026-10-05 – 2026-10-06)

<!-- plan-archive:begin id="gates-c54550e6d-34120" lines="34120-34167" at="c54550e6d" bytes="3422" sha256="95d21ca6d4b781408bcfd5a62554fa96c5a8141a39b280ebe31c66670d34b0ad" -->

**FIXHELPREF4 bounded certification (2026-10-06).** The explicit rig brief
prohibits aggregate quality and reserves release integration for the lead.
Run all owning reference/budget tests, exact-restoration red drills and the
existing scoped static/build checks directly on Kubuntu before the local
hook-on commit. The original predicates, schemas and bundle caps remain gates;
no threshold, ignore, rule level, timeout or dependency is relaxed.

**FIXHELPREF bounded truth certification (2026-10-05).** Kubuntu runs the
owning reference/ACP regressions, source and guard failure drills with exact
SHA-256 restoration, five-project typecheck and the existing static/build
gates. The lane brief forbids aggregate quality, merge, push and rebase;
full integrated quality and the second truth audit remain with the lead.
No threshold or size cap changes. Evidence: `docs/certification/help-reference.md`.

**HELPREF bounded rig certification.** The explicit rig/shared rules prohibit
aggregate `npm run quality`, merge, rebase and push in this lane. Hook-on local
commits use scoped owning tests, deliberate red drills and available static/build
checks. The lead retains the integrated quality/coverage/release gate. No gate
or budget is weakened; the exact evidence is recorded in
`docs/certification/help-reference.md`.
**REDM106H bounded rig certification (2026-10-06).** The explicit rig brief
prohibits aggregate quality, full-suite runs and branch integration here. Run
touched/owned whole files with default timeouts, scoped lint/format, all five
typechecks, deadcode, duplication, localization, host API, cycles and production
build. The lead retains integrated quality and the multi-OS matrix. No gate is
weakened. The v2 headless money contract remains private/unsupported pending
M80’s hosted/live receipts; this lane uses fake transports only.
**C-M106-1 bounded capture certification (2026-10-10).** The explicit rig
brief forbids aggregate quality, full-suite runs and branch integration.
Run whole owning files at repository timeouts, all five typechecks and the
existing scoped lint, format, deadcode, duplication, localization, reference,
host API, roadmap and production build gates. The lead retains integrated
quality, Windows/Linux execution and live Meta/provider receipts because no
key is supplied here. The CLI probes use ephemeral empty workspaces and no
model turn; only the explicitly scoped synthetic note is uploaded, with
both disclosures off. No guard, hook, timeout, cap or dependency is changed.
Evidence: `docs/certification/m106-completion-captures.md`.
**C-M106-2 R10 bounded dependent certification (2026-10-11).** The rig
brief explicitly adds every dependent suite for the whole branch's source
diff against 82d50d5e4, including all shared host/runtime and English-table
consumers. Discover the full graph with Vitest's related selector, then run
`npx vitest related --run` in complete three-file batches preserving the
repository's configuration and deadlines. Keep Vitest's public runner open
between batches if repeated cold setup threatens the time box; use the same
related selector, three-file bound, ordinary project setup and deadlines. Aggregate quality, independent
review and the multi-OS release matrix remain lead-owned. No gate or cap is
weakened; record every outcome and compare any red with the clean base.
Evidence: `docs/certification/m106-capability-binding.md`.

<!-- plan-archive:end id="gates-c54550e6d-34120" -->

## CIFIX14C ACP packaging certification (2026-10-05)

<!-- plan-archive:begin id="gates-c54550e6d-34383" lines="34383-34393" at="c54550e6d" bytes="810" sha256="45ed20fa9c16e147544cdf44ab4dbbb2daedd80b50ed21054623aedee18522eb" -->

**CIFIX14C bounded ACP packaging certification (2026-10-05).** The installed
tarball passes the unchanged strict English fallback check and 382 distinct
scoped tests. Typecheck, changed-file lint/format, localization (source and staged),
deadcode, duplication, host API and production build gates pass. Shared rules
prohibit aggregate `npm run quality` and replacing the existing dependency tree;
fresh tarball installs use an offline scratch prefix. Kubuntu runs Node 24.18.0,
not CI's requested Node 22, and lacks CI's downloaded compiled macOS helper.
The exact universal VSIX listing therefore fails only that helper entry; hosted
artifact operations and full integrated quality remain with the lead. No check
is weakened. Receipts and deliberate failures are in
`docs/certification/cifix14-acp-usage.md`.

<!-- plan-archive:end id="gates-c54550e6d-34383" -->

## 0.14.x packaging and train lanes (2026-10-05)

<!-- plan-archive:begin id="gates-c54550e6d-34665" lines="34665-34705" at="c54550e6d" bytes="2757" sha256="014f3cc0140fad209cb2f3841ae4ff81f2e06d0216f2f82645bfd9c09e07a41b" -->

**CIFIX14C bounded ACP packaging certification (2026-10-05).** The installed
tarball passes the unchanged strict English fallback check and 382 distinct
scoped tests. Typecheck, changed-file lint/format, localization (source and staged),
deadcode, duplication, host API and production build gates pass. Shared rules
prohibit aggregate `npm run quality` and replacing the existing dependency tree;
fresh tarball installs use an offline scratch prefix. Kubuntu runs Node 24.18.0,
not CI's requested Node 22, and lacks CI's downloaded compiled macOS helper.
The exact universal VSIX listing therefore fails only that helper entry; hosted
artifact operations and full integrated quality remain with the lead. No check
is weakened. Receipts and deliberate failures are in
`docs/certification/cifix14-acp-usage.md`.

**CIFIX14W2 short-path certification (2026-10-05).** The explicit rig brief
requires complete directory-tracking and shell files with default CLI timeouts,
three workers and a real 8.3 fixture. Shared lane rules prohibit aggregate
`npm run quality`; focused regressions, static checks and the production build
run locally with hooks on. The lead retains the integrated full quality gate.
No threshold, timeout, retry, skip policy or gate is changed; evidence is in
`docs/certification/cifix14-shortpath.md`.

**FIXVSIX2 scoped certification (2026-10-05).** RVMVSIX2 P1 and P2 are
fixed. All 78 owning unit tests and 49 native packaged-module tests pass,
with declared-export, private-reader and absent-dist red drills restored
byte-exact. Typecheck, scoped lint/format, Knip, duplication, localization,
host API, cycles, production caps and both package commands exit 0.
Universal VSIX is 2,033,170 bytes, with 219,630 bytes headroom; activation
is byte-identical. The rig brief reserves aggregate quality/coverage and
installed-editor/platform certification for the lead. No gate is weakened.
Receipts: `docs/certification/vsix-diet-2.md`.

**TRAIN14B Judge activation fixture stop (2026-10-05).** Full quality is
explicitly authorized by this rig brief. Its aggregate unit run exposes a
legacy Judge activation fixture that omits D78’s default callback. The field
extraction fix resolves the undefined-variable error; a backend-availability
fixture fix still leaves three subscription-default assertions failing.
Common.md requires stopping after two different fixes to the same test, so
this path is paused pending the requested explicit override for one targeted
`isDefaultOn` fixture correction. No gate, test, timeout or paid policy is
weakened. Until the unchanged full gate exits zero, this train is not ready
for merge/release; all other authorized checks continue and their exact
receipts are in `docs/certification/train-0.14.0.md`.

<!-- plan-archive:end id="gates-c54550e6d-34665" -->

## Test-flake lanes DEFLAKE2/3 (2026-10-04)

<!-- plan-archive:begin id="gates-c54550e6d-35061" lines="35061-35088" at="c54550e6d" bytes="1885" sha256="25f66ae5a904cbfc91841cfb63a7c8e15391cb3300f526a89a2487f842ca3ba0" -->

**DEFLAKE3 test-only lane scope (2026-10-04).** The rig brief requires a
complete Windows unit inventory in batches of at most three files and
300 consecutive checkpoint-copy file passes. It explicitly requires full
`npm run quality` only for a product change; this lane changes tests and
documentation only. Shared static/build checks still apply. Aggregate
coverage/full quality and hosted confirmation remain the lead's gates; no
rule, timeout or coverage threshold is weakened. The exact original hosted
failure is not supplied and has not reproduced in 200 original-file runs.
Evidence: `docs/certification/deflake3.md`.

**DEFLAKE2 bounded-lane result (2026-10-04).** Direct Win11 owning tests
and the required static/build gates passed; two deliberate regressions
failed and were restored byte-exact. The rig brief prohibits integration
merges/pushes, and `common.md` forbids aggregate quality/full-unit runs in
this shared lane. Full quality, aggregate coverage, accessibility and the
hosted Windows recheck remain the lead's gates. No gate or deadline was
weakened. Evidence: `docs/certification/mcp-job-flake.md`.
**M94W size boundary (2026-10-05).** The Windows production build passes
activation at 578.0/600 KiB and Tab at 62.4/75 KiB. W adds 3,378 bytes
(3.299 KiB) against the integrated pre-W source control, within the brief's
added-startup allowance. The whole Tab shim is 7.393 KiB, inherited from a
4.431 KiB H shim: D73's stricter whole-shim 4 KiB target and acceptance 19
are not certified. Reducing the whole shim needs the existing service/provider
orchestration moved into the lazy entry while preserving loader retry,
cleanup and startup status; that broader follow-up is deferred to the lead
under W's bounded scope. The hard 600 KiB cap and every existing gate remain
unchanged. The exact control and bundle measurements are in
`docs/certification/m94.md`.

<!-- plan-archive:end id="gates-c54550e6d-35061" -->

## DEFLAKE5 unit and coverage acceptance (2026-10-05)

<!-- plan-archive:begin id="gates-c54550e6d-35322" lines="35322-35338" at="c54550e6d" bytes="1163" sha256="033e021f48b2388017a13ee70f1104b1755b1c1456e061cde6f8a63bbd519796" -->

**DEFLAKE5 unit/coverage acceptance (2026-10-05, kubuntu).** On committed
code `8d31e73a`, three consecutive complete three-worker V8 runs return 0:
404 files and 8,093 tests pass each, with four files / 57 existing skips.
A complete ten-worker run plus four owned CPU-load processes also returns
0 on that exact code. Every coverage threshold passes: 93.75% statements,
89.01% branches, 94.70% functions and 93.89% lines in all four final runs.
Typecheck (five projects), full lint, format, plain knip and duplication
return 0. The scoped rig brief authorizes this unit-only acceptance instead
of a whole quality wrapper. It closes the unit/coverage deferral below;
the historical failed wrapper and unrelated release/helper prerequisites
remain recorded. Two actual causes are fixed: shared build artifacts and
repeated expensive checks of identical restored bytes. Red drills reproduce
all five historical files' defects and the new shared-metafile regression,
with byte-exact restoration. See `docs/certification/deflake5.md` for commands,
errors, hashes, worker/load settings and all successful and failed receipts.

Never drill against a user's repository.

<!-- plan-archive:end id="gates-c54550e6d-35322" -->

## QPIN lane verification body (2026-10-07)

<!-- plan-archive:begin id="gates-c54550e6d-35420" lines="35420-35427" at="c54550e6d" bytes="566" sha256="5bc06be25b5540fb088d5f909bb7c99d7ebcd9821412eeef15240c4c36334891" -->

The rig brief scopes this repair to fresh-clone owning suites three times at
default deadlines, five typechecks, lint, formatting, plain knip, duplication,
unchanged build caps, reference and localization, plus question screenshots
and four-theme accessibility. All passed; receipts are in
`docs/certification/question-pinned.md`. Full `npm run quality`, unrelated
repository coverage and native/installed-editor/live certification remain
with release integration. This is a scoped run, not a gate relaxation: no
rule, ignore, threshold, budget or deadline changed.

<!-- plan-archive:end id="gates-c54550e6d-35420" -->

## 0.15.0 CI repair and train lanes (2026-10-05 – 2026-10-07)

<!-- plan-archive:begin id="gates-c54550e6d-35429" lines="35429-35512" at="c54550e6d" bytes="5822" sha256="712bdcad27c38623ef2220bfb2bc084199e810e789b3e0081ff95ddede4253e9" -->

**CI0150M round 3 aggregate status (2026-10-07).** The attempted unmodified
`npm run quality` passes static gates, then fails whole-repository tests in
unowned clean-artifact/localization suites and load-sensitive cases. The common
OS brief assigns cross-platform failures to the Linux lane. Certify this lane
with every exact macOS workflow command in fresh committed clones; record all
remaining failures rather than weaken gates or edit another lane's suites.
Aggregate release quality remains deferred to joined integration. Standalone
secret scanning passes; the inherited SAST wrapper supplies duplicate `--jobs`
options and is a shared failure, also deferred without changing its invocation.
See this lane's round 3 section in `docs/certification/train-0.15.0.md`.

**CI0150W round 3 certification.** Whole-shard and whole-job reproductions
are explicitly required by `CI0150-os-common.md`; they run with unchanged
default deadlines in fresh clones of local hooked commits. Targeted runs
retain the three-file cap. Early scoped commits can precede aggregate
`npm run quality` while the cross-platform failures assigned to the Linux
lane remain; every failure and final Windows job result is recorded without
weakening gates, assertions or deadlines. A complete quality claim requires
the actual aggregate to exit zero.

The final implementation run at `2548f459` passes the static CI job and all
scoped test files in four complete shards. Aggregate quality stays deferred:
clean/package fixtures remain red, integration has an external release-lookup
timeout, and dedicated browser/credential-store checks have the exact residuals
listed in §3 and the train record. Original coverage thresholds are exceeded;
the merge command still fails because it replays failed package suite setup.
No gate, refusal, assertion, timeout, retry or skip is weakened to claim green.

**CI0150L rolling verification.** The round-3 rig brief explicitly requires
committing finished pieces after owning tests pass, then verifying committed
work in fresh clones. Full quality and Linux CI jobs remain pending until that
fresh-clone run and are not claimed green by an intermediate commit. Record
any external hosted dependency that cannot run on this rig in the Linux round-3
certification section; no threshold, ignore, timeout or assertion changes.

**FIX0150R scoped certification.** The rig brief requires complete owning test
files in batches of at most three, with three clean `CI=true` repetitions and
individual static/build gates. Shared lane rules reserve aggregate
`npm run quality` for the lead; its whole-repository coverage invocation exceeds
this lane's test-file limit. Defer that aggregate to release integration without
changing any threshold or gate. Receipts are in `docs/certification/fix0150r.md`.

**FIX0150P scoped release-review verification (2026-10-07, linuxlt).**
The rig/common briefs prohibit a full quality run in this lane. Full quality
and cross-platform release certification remain with the lead; this lane
runs the prescribed complete owning suites and scoped static/build gates
without weakening thresholds, timeouts, isolation or hooks. Detailed red/base
and restored-green receipts belong in `docs/certification/fix0150p.md`.

**CI0150A scoped certification.** CI0150-common.md requires three clean
repetitions of complete owning files and individual static gates; the rig note
caps each test run at three files. Aggregate `npm run quality` includes an
unbounded whole-repository test/coverage run, so it is deferred to integration
under this scoped repair. Hosted OS/release checks also include CI0150B/C work
and are not certified here. This justified deferral changes no gate or threshold.

**TRAIN15B raw-cap deferral (2026-10-05).** The resumed integration recovers
the VSIX, with universal 2,213,704 and helperless 2,132,213 bytes, both under
the unchanged 2,252,800 cap. The shared graph's original deferred cohort starts
at 51,452 bytes; the first usage reduction still prints 50.1 KiB over 50 KiB,
and the second leaves an exact 51,226 bytes (26 over). common.md requires
stopping a path after two failed fixes, and the integration brief requires
all caps to hold. Record the candidate with hooks and defer `m96/int3d`,
`m96/ifix-win4` and `m97/sr`; no further raw-cap optimization or merge is tried.
The source build completes and all other caps pass, but `npm run package`
exits 1 before its packager. Running the actual packager separately measures
exact archives and exercises strict staging, badges and native exports; that
successful measurement does not certify the failing package command. All
scoped checks and eight restored red drills are recorded in the train receipt.
No full quality, cap increase, ignore, skip, feature removal or dependency change.
This supersedes the first run's VSIX blocker below, preserving its history.

**TRAIN15A budget stop (2026-10-05).** The integration brief explicitly
forbids full quality and requires stopping after M101 if its unchanged universal
VSIX cap cannot be met without a product decision. The first M101 candidate is
2,368,627 bytes, 115,827 over. An existing-ESM shared-entry experiment preserves
startup and model-text readership but leaves the original deferred cohort over
its hard cap after two bounded fixes (57 bytes, then 10); common.md requires
stopping that path. Restore the separate Models graph and retain every shipped
feature and cap. Finish scoped checks, record the fresh artifact and exact largest
twenty base deltas in `docs/certification/train-0.15.0.md`, commit the blocked
integration locally with hooks, and do not merge steps 3–5. This is a justified
review-candidate deferral under rule 2, never a green release claim. The lead
owns a further size-recovery decision and the later continuation/full gate.

<!-- plan-archive:end id="gates-c54550e6d-35429" -->

## CIFIX14T macOS lanes (2026-10-05)

<!-- plan-archive:begin id="gates-c54550e6d-35781" lines="35781-35796" at="c54550e6d" bytes="1122" sha256="f8ecc4dfa1f22c6db97b1725cfc5f8d7a7528045c117fdcd399057032df15bdd" -->

**CIFIX14T verified local result (2026-10-05).** The five owning suites
pass 113 tests (six existing Windows-only skips); the exact restored monitor
file passes 30/30 loaded runs, 210 tests. Removing the wait fails 3/3 loaded
drills; all seven drills restore SHA-256-exact source. All five compiler
projects, final unit compile, scoped ESLint/Prettier, plain knip, duplication,
localization, host API and production build pass. Extension 437.4 / 600 KiB,
Model API 446.6 / 475 KiB, ACP 817.5 / 850 KiB; every budget is unchanged.
Native Mac proof and complete receipts are in `docs/certification/cifix14-monitor.md`.
Hosted Node 22 and native Linux/Windows certification remain with the lead.

**CIFIX14T bounded-lane gate delegation (2026-10-05).** The requested Mac
mini reproduction and red drills run directly here with hooks enabled.
`common.md` prohibits aggregate quality/full unit runs; collect the owned
shell tests and required static/build checks, leaving full quality, merged
coverage and hosted cross-platform certification to the lead. No gate is
weakened and no integrated-green claim is made by this lane.

<!-- plan-archive:end id="gates-c54550e6d-35781" -->

## 0.13.0 train and merge lanes (2026-10-04 – 2026-10-05)

<!-- plan-archive:begin id="gates-c54550e6d-35846" lines="35846-35881" at="c54550e6d" bytes="3405" sha256="324ce8bfda9a0331aafb471630490774ed5d27bdbb90fef187221601466eff04" -->

**TRAIN13B (2026-10-05).** The owner authorizes recovering the two size
failures and running the complete quality gate directly on Kubuntu within
120 minutes. No cap, threshold, skip or user-facing feature may be weakened.
The earlier TRAIN13 budget stop is historical; current receipts go in the
same train certification record.

**TRAIN13 release train (2026-10-04, Kubuntu).** Merge the six reviewed
branches in the owner's order with two-parent commits, preserving all PR
heads. Resolve only integration breakage; retain D78, D79 and D71 with all
existing decisions and milestones. Consolidate Unreleased into one Highlights
list of at most five bullets and the Added/Changed/Fixed/Security sections;
released sections remain byte-identical to `main-sync`. Regenerate notices,
the host API inventory and exec schemas. Verify the shared M92 detection table
still feeds #116's host-to-webview diagnostics and confidential admission,
then run full `npm run quality` once and the unchanged 2200 KiB VSIX gate.
A size-budget failure stops this lane and is reported without changing a cap.
The first combined gate exposed the missing M99 palette tip and stale eager-recall/request-order assertions after D78. Add the tip in every language; bind the concurrency test to parent/child identity and assert recall is absent until packing. Match the monitor probe to the existing MCP Linux zombie check and retain proof that it recognizes a live process. The corrected full run passes static gates and 7,758 tests, but two unchanged checkpoint tests fail under the shared `/tmp` quota (`EDQUOT`); coverage and downstream gates are unverified. The separate build gate fails on webview main (928,507 bytes against 921,600); a private Linux VSIX measurement also fails (2,330,538 against 2,252,800 bytes), without the universal macOS helper. Stop implementation at those budget failures as the brief requires. No cap, timeout, test skip or gate is changed. Quota recovery, full certification and package reduction remain deferred to the lead. Hooks stay on; no push, rebase, live model or paid call. Current evidence and any outstanding gate are in `docs/certification/train-0.13.0.md`.

**MG87c merge (2026-10-04): main's activation diet into M81.** The browser
check's model text sits by reader under D6's 2026-10-03 rule: `MODEL_TEXT`
for what activation reads, `MODEL_API_MODEL_TEXT` for the three words only
the Model API backend says; the refusal table reads them by name. Activation
is 572.6 of 600 KiB. The shipped-bundle text test allows words a bundle's own
blocks share with `MODEL_TEXT`, with four red drills. See
`docs/certification/mg87c.md`.

**MG87b merge (2026-10-04), source proof and explicit deferrals.** Merge `origin/main`
into M81 while retaining all main bundles, budgets, translations and
permission behavior. Browser results join M78's live policy fence; best-of-N
attempts receive no window browser check. The lane runs targeted static
gates and Kubuntu tests, with hooks on and no origin push; full quality
remains the lead's gate. Kubuntu passes 7,105 tests; final integration and
fixture runs pass 672 and 19 tests. Activation is 610.2 KiB against 600: the
brief assigns its correction to the activation-diet lane. Focused accessibility
has two missing Chrome results, so no complete browser pass is claimed.
See `docs/certification/mg87b.md` for resolutions, drills and gate evidence.

<!-- plan-archive:end id="gates-c54550e6d-35846" -->

## Test-flake duplicate receipts (2026-10-04)

<!-- plan-archive:begin id="gates-c54550e6d-35921" lines="35921-35948" at="c54550e6d" bytes="1885" sha256="25f66ae5a904cbfc91841cfb63a7c8e15391cb3300f526a89a2487f842ca3ba0" -->

**DEFLAKE3 test-only lane scope (2026-10-04).** The rig brief requires a
complete Windows unit inventory in batches of at most three files and
300 consecutive checkpoint-copy file passes. It explicitly requires full
`npm run quality` only for a product change; this lane changes tests and
documentation only. Shared static/build checks still apply. Aggregate
coverage/full quality and hosted confirmation remain the lead's gates; no
rule, timeout or coverage threshold is weakened. The exact original hosted
failure is not supplied and has not reproduced in 200 original-file runs.
Evidence: `docs/certification/deflake3.md`.

**DEFLAKE2 bounded-lane result (2026-10-04).** Direct Win11 owning tests
and the required static/build gates passed; two deliberate regressions
failed and were restored byte-exact. The rig brief prohibits integration
merges/pushes, and `common.md` forbids aggregate quality/full-unit runs in
this shared lane. Full quality, aggregate coverage, accessibility and the
hosted Windows recheck remain the lead's gates. No gate or deadline was
weakened. Evidence: `docs/certification/mcp-job-flake.md`.
**M94W size boundary (2026-10-05).** The Windows production build passes
activation at 578.0/600 KiB and Tab at 62.4/75 KiB. W adds 3,378 bytes
(3.299 KiB) against the integrated pre-W source control, within the brief's
added-startup allowance. The whole Tab shim is 7.393 KiB, inherited from a
4.431 KiB H shim: D73's stricter whole-shim 4 KiB target and acceptance 19
are not certified. Reducing the whole shim needs the existing service/provider
orchestration moved into the lazy entry while preserving loader retry,
cleanup and startup status; that broader follow-up is deferred to the lead
under W's bounded scope. The hard 600 KiB cap and every existing gate remain
unchanged. The exact control and bundle measurements are in
`docs/certification/m94.md`.

<!-- plan-archive:end id="gates-c54550e6d-35921" -->

## TRAIN15E release preparation (2026-10-06)

<!-- plan-archive:begin id="gates-c54550e6d-36030" lines="36030-36066" at="c54550e6d" bytes="2628" sha256="e927eb6a3bf3499adf933a8affa365d4abee6c786e86ac389b50e2de6704f6f2" -->

**TRAIN15E release preparation gate scope (2026-10-06, win11).** The
continuation brief explicitly requires the entire Vitest suite in batches of
at most three files, at the repository's default deadline, the full accessibility
harness, reviewed README screenshots, live HTTPS badge verification, and the
listed compiler, lint, inventory, dependency, cycle, build and package gates.
These override common.md's scoped-test and network-only limits for those exact
commands. The shared rule still forbids the aggregate `npm run quality`
wrapper; merged coverage, integration hosts, audit/SAST and hosted cross-platform
quality remain with the lead. This lane records each requested gate separately
in docs/certification/train-0.15.0.md and its release receipt, without claiming
aggregate quality or new model-service certification. No gate is weakened.

**TRAIN15E final continuation (2026-10-06, win11; before repair).** The new
90-minute brief resumes the staged release and explicitly reopens the nine
Windows failures. First restructure the harness inventory as fixture state
and commit the authorized merge with hooks. Preserve D75's closed stdin,
remote slot and native retirement contract: the real PowerShell self-test
fails with DETACHED_PROCESS and succeeds with CREATE_NO_WINDOW, retaining
breakaway and the exact inherited-handle list. Export the fake SSH host's
metric functions into its helper shell and use its discovered Bash for marker
polling. Prepare the four ordinary landing cases' real Git staging in a
shared beforeEach rather than spending their unchanged five-second body
deadline on setup. Keep every assertion, timeout, cap and existing skip.
Run all test files in batches of at most three at the repository defaults;
finish lint, inventories, knip, duplication, cycles and both actual packages.
Reuse the 952-page accessibility receipt if browser sources remain unchanged.
Record root causes, red/restored drills, final totals and package bytes in the
train certification; no push or model call.

The final sweep exposes a separate fake SSH canary race: Git Bash can finish
the command's two-second sleep before its independently scheduled one-second
timer gets CPU, so an early write is mistaken for a post-retirement escape.
Bind the writer to the fixture's explicit release file, release it only after
the unchanged timeout result has returned, and retain the canary-absence
assertion and observation interval. This tests D75's retirement guarantee
without assuming relative scheduling of two real processes. Re-run the whole
SSH file at the default deadline and retain the original failing receipt.

<!-- plan-archive:end id="gates-c54550e6d-36030" -->

## TESTWARM deferred-surface warm-up (2026-10-06)

<!-- plan-archive:begin id="gates-c54550e6d-36068" lines="36068-36073" at="c54550e6d" bytes="439" sha256="55eacd065e4287f46faa5fa9a80475580e6511161ff5b8ebbfdb67a1c1700532" -->

**TESTWARM bounded-lane certification (2026-10-06).** The rig/shared brief
forbids aggregate quality and full-suite runs. Collect owning suites with default
timeouts, the drift drill, scoped lint/format, five compiler projects, plain
Knip, duplication, localization, host API and production build on this rig.
Integrated full quality, coverage and hosted cross-platform checks remain with
the lead; no gate, timeout or budget is weakened.

<!-- plan-archive:end id="gates-c54550e6d-36068" -->

## PROMPTMENU2 composer menu duplication (2026-10-06)

<!-- plan-archive:begin id="gates-c54550e6d-36075" lines="36075-36093" at="c54550e6d" bytes="1431" sha256="1d5808cc2e970ceeada784a02df09549c05a8b7a00775623b5dbb9bf4863826a" -->

**PROMPTMENU2 inherited duplication deferral (2026-10-06).** The unchanged
zero-clone `npm run duplication` gate exits 1 on three clones between
`test/e2e/acpRegistryAuth.e2e.test.ts` and `test/e2e/acpStdio.e2e.test.ts`
(8/18/8 lines, 50/94/52 tokens). Both files are byte-identical to the lane's
`4ca230efc` base; the prompt-menu changes introduce no clone. The shared lane
rules prohibit unrelated refactoring, so ACPREG's existing fixture duplication
remains a named release-integration repair for the lead. No threshold, ignore,
rule, timeout or test is changed. Full quality cannot be claimed green until
that repair passes the unchanged gate. Evidence and all other requested rig
receipts: `docs/certification/promptmenu-hosts.md`.
**M108W final rig certification (2026-10-07).** The W brief authorizes the
complete configured test suite in sequential batches of at most three files
and workers, using repository-default timeouts, all listed individual static/
build/package gates, full axe harness and README previews. Shared rules still
prohibit the aggregate `npm run quality` and public network; aggregate coverage,
network audit/SAST, hosted/native/editor/live receipts remain lead-owned.
Run local hook-on commits only after their scoped proofs, then certify the
final joined tree without loosening any gate. Every named integration handoff
and unavailable check is explicitly disposed in `docs/certification/m108.md`.

<!-- plan-archive:end id="gates-c54550e6d-36075" -->

## CIFIX14T gate delegation duplicate (2026-10-05)

<!-- plan-archive:begin id="gates-c54550e6d-36149" lines="36149-36161" at="c54550e6d" bytes="967" sha256="391166bfe0d7b51af2d10de0ce28b0db2f141ece435ab350a542e9313f8cb3cb" -->

**CIFIX14T bounded-lane gate delegation (2026-10-05).** The requested Mac
mini reproduction and red drills run directly here with hooks enabled.
`common.md` prohibits aggregate quality/full unit runs; collect the owned
shell tests and required static/build checks, leaving full quality, merged
coverage and hosted cross-platform certification to the lead. No gate is
weakened and no integrated-green claim is made by this lane.
**FIXM109PW3 bounded-lane verification (2026-10-06).** The rig brief reserves
full quality/coverage for the lead. Direct Win11 checks pass typecheck, changed
file ESLint/Prettier, deadcode, zero-clone duplication, localization, production
build and the 96 owned tests at repository default deadlines. The host-API
mismatch remains exactly W's five import-count changes recorded below; no
new VS Code API or generated snapshot change belongs to this repair. Sixteen
byte-exact red controls are in `docs/certification/m109-pw3-drills.json`.

<!-- plan-archive:end id="gates-c54550e6d-36149" -->

## Release-speed lanes RELFAST2/3 (2026-10-04)

<!-- plan-archive:begin id="gates-c54550e6d-36208" lines="36208-36230" at="c54550e6d" bytes="1681" sha256="2b309229bd15573f52f5a9064b3471e53d731c7b6dc3109cbf96dd7bd0753366" -->

**RELFAST3 bounded-lane result (2026-10-04).** Fresh Windows compilers,
dead-code, duplication, localization, host API, production build, actionlint
and scoped formatting pass; the fixture's two ESLint style findings are fixed
without suppression and its generated workflow shell is byte-identical.
Kubuntu passes all 128 owning tests and six added byte-exact guard drills;
RELFAST2's 36 controls remain historical receipts. A contended Windows Bash
fixture timed out at the unchanged five-second limit and is not green proof.
The live Model API size gate is 475 KiB, not common.md's 400 KiB figure: the
430.1 KiB bundle passes the existing gate without a cap change, but 400 KiB
compliance is not claimed. Full quality/hosted/CIFLOW/admin-tag verification
and the skill's unsupported ledger-format validator remain deferred to the
lead; no required gate was weakened. See `docs/certification/relfast.md`,
`relfast3-drills.json` and `relfast3-shell-equivalence.json` beside it.

**RELFAST2 bounded-lane deferral (2026-10-04).** The hard 60-minute brief
requires scoped eslint/Prettier, owning release tests, available actionlint and
hook-on commit. All 19 carried controls plus 17 new controls are proved locally.
Fresh common.md aggregate typecheck, dead-code, duplication, localization,
host-API and production-build runs are deferred to the lead: this change touches
release tooling/workflows and owning tests, with no production bundle changes.
This is a deferral, not current aggregate-green evidence; full quality, hosted
reuse/recovery/fallback and CIFLOW integration remain required. Evidence:
`docs/certification/relfast.md` and `docs/certification/relfast2-drills.json`.

<!-- plan-archive:end id="gates-c54550e6d-36208" -->

## M116 playbook review lanes (2026-10-06)

<!-- plan-archive:begin id="gates-a07e4a8e2-34039" lines="34039-34056" at="a07e4a8e2" bytes="1304" sha256="af5882550ef1e32adc420707e99cd7e32fa022c410be780011183dc948c6ed2f" -->

**REDM116P outcome redesign (2026-10-06).** The rig brief again prohibits
aggregate quality, pushes and unlisted merges. The lane runs all owning tests
at default timeout, scoped lint/format, all five typecheck projects, deadcode,
duplication, localization, host API, the new help-reference check and production
budgets directly on macmini. It removes the shell-quote dependency handoff,
refreshes the generated Node import inventory, and records deliberate
receipt/generation/merge and round-2 mutation failures with byte-exact restores
in `docs/certification/m116-p.md`. Full joined-tree quality and trusted
editor/planner bindings remain the lead/I/U/W integration work; no gate is
weakened and no round-2 finding is accepted as a residual.
**M116-U repair certification (RVM116U/RVM116U2).** The rig brief reserves the full
quality run for the lead and requires scoped local checks with default test
timeouts. U does not change the inherited failing bundle/knip registration
gates: W must register the three lazy playbook entries and the two harness
entrypoints before integration can go green. This is the existing named
integration deferral, not a cap, ignore or rule change. Repair regressions,
disk-mutated red drills and their byte-exact restores are recorded in
`docs/certification/m116-u.md`.

<!-- plan-archive:end id="gates-a07e4a8e2-34039" -->

## M105 multimodal review-fix lanes (2026-10-05 – 2026-10-07)

<!-- plan-archive:begin id="gates-a07e4a8e2-34107" lines="34107-34263" at="a07e4a8e2" bytes="10563" sha256="0db666a2bb62418d363f0e425eb7cbed5e0495c0a814a8ce6dcd9d4c36770d14" -->

**FIXM105E3 gate scope (Kubuntu, 2026-10-07).** The rig brief/common rules
forbid aggregate quality and full unit commands; run owning files in batches of
at most three, followed by the five typecheck projects, lint, changed-file
formatting, plain knip, duplication, unchanged-cap production build, reference
and localization. Run final verification from a fresh clone of the committed
repair with npm ci and CI=true. Hooks remain active; no external network except
npm ci.

**M105 W final gate scope (linuxlt, 2026-10-07).** The rig brief overrides
bounded lane test scope with all configured files in batches of at most three,
repository timeouts and three workers. Shared rules still forbid the aggregate
quality command and external network. Run requested static/build/test/browser
gates separately and serially. Local VSIX/ACP packaging uses the badge gate's
existing named network deferral, only in those commands (never in hooks):
`BADGE_CHECK_SKIP_NETWORK='M105W lane forbids external network; badge fetch
remains lead-owned' npm run package` (and `npm run package:acp`). Validate
staged text/version/l10n/listing and size; do not claim HTTP badge verification.
Fresh audit, Semgrep auto-registry, downloaded VS Code integration, native
OS, universal macOS-artifact packaging and hosted coverage remain lead-owned.
Browser gates are attempted unchanged, with exact failures recorded if this
rig cannot launch Chrome. No cap, threshold, hook or test is weakened.

**M105-M1 second follow-up gate scope (RVM105M12, 2026-10-06).** The
same rig override applies to these two P2 corrections: direct focused suites
at default timeouts, no full quality/full unit run or branch merge. The eight
resource/structure red drills restore source byte-exact. W's existing host
record, browser-size and split-classification failures remain enforced and
are reported in the lane certification; the lead owns the integrated gates.

**M105-E1 bounded-lane gate scope (2026-10-06).** The rig brief forbids a
full quality/full unit run and reserves manifest, generated reference/host
records and bundle registration for W. Run owning files at the repository's
default timeout, scoped lint/format, typecheck, dead-code, duplication,
localization and production build directly on linuxlt. Keep inherited size
and split gates enforced. Hook-on commits remain unmerged lane work; full
quality is required on the integrated tree. Record receipts and handoffs in
`docs/certification/m105-e1-vs-code-(a).md`. E1 also leaves a measured
59-byte browser-startup excess (900.1/900 KiB) for W's lazy build integration
after two failed local reductions, and the new preview's generated host-API
inventory update. These are failures, not gate exemptions; the integrated
quality gate must pass before proposing a product commit.

**M105-E2 gate scope (2026-10-06).** The rig brief forbids aggregate quality
and full-unit runs, merges and browser runs on this Chrome-free MacBook.
E2 runs complete focused files with the repository default timeout, plus
typecheck, scoped lint/format, localization, deadcode, duplication, host API
and production build checks. W retains the enforced inherited bundle/split
and generated importer-record failures and the full integrated gate. No cap,
ignore, timeout or rule is weakened. Receipts and required bindings are in
[E2 certification](<docs/certification/m105-e2-acp,-headless-and-`read_file`-(a).md>).
The broader IO batch on Node 26 additionally exposed the unchanged reservation
handle left open by the existing retargeted-fill test. Lead/IO-write owner
must close that path and rerun the complete file; E2 does not edit reservation
regions outside its media-read ownership. Production compilation succeeds:
ACP 844.8/850 KiB, Model API 454.9/475 KiB; deferred browser stays 51.1/50 KiB.

**M105-E3 gate scope (2026-10-06).** The rig brief forbids full quality
and full unit runs, and reserves integration for the lead. Run focused tests
with repository-default timeouts and all named lane checks directly on linuxlt.
Keep inherited W-owned bundle/split/host-record failures enforced; add no cap,
ignore or weakened rule. New lazy browser/runtime entries await W binding.
Scoped E3 and existing regressions pass (113 + 143 tests); 63 guards have
named red failures and byte-exact restoration. Production compilation passes,
but the deferred-browser gate remains 51.1/50 KiB, `files.ts` and
`codecs/responses.ts` still lack split classifications, and the generated host
importer/style inventory is stale. E3's standalone split media graph measures
194.5 KiB including shared dependencies; W must bind its own companion-page
budget and include R3, without raising a cap. Full quality and installed-editor,
Windows private-ACL and real browser-capture receipts remain lead handoffs.
Receipts and doc/reference handoffs:
`docs/certification/m105-e3-companion,-native-plugins,-muse-code-(a,-d).md`.

**M105-M2 follow-up gate scope (RVM105M2, 2026-10-06).** The rig brief
reserves full quality/full-unit and integrated cross-platform certification
for the lead. Scoped regression files, typecheck, lint/format, dead-code,
duplication, cycles, localization and production compilation run directly on
Kubuntu. The enforced W handoffs remain red: deferred browser JS 51.1/50 KiB;
`files.ts` and `codecs/responses.ts` missing from the backend split lists; and
the generated host importer inventory (buffer 39→45, crypto 46→49, plus the
inherited child_process/fs/fs-promises/os/path drift). W must repair them
before integration. No cap, ignore, timeout or rule is weakened. The Model
API bundle is 453.9/475 KiB. All three review findings are fixed; §9 records
the named integration handoffs and why the unbound ports remain safe.
Receipts: `docs/certification/m105-m2-wire,-gate-and-replay-(a).md`.

**M105-M1 follow-up gate scope (RVM105M1, 2026-10-06).** The rig brief
requires direct focused suites and forbids full quality/full unit runs and
merging another branch. Full quality and cross-platform gates remain the
lead's integrated-tree responsibility. Keep the existing W-owned host-record,
deferred-browser-size and `files.ts` split blockers enforced; this lane fixes
the three media-core findings with regressions and red drills, without
changing a gate or cap. Results and exact commands are in
`docs/certification/m105-m1-media-core-(a).md`.

**M105-F gate deferral (RVM105F corrections, 2026-10-05).** The lane brief
reserves full quality and integration for the lead. Required local checks are
recorded in `docs/certification/m105-f.md`; the unchanged lane W blockers
remain red: deferred browser JS 51.1/50 KiB, Files backend classification in
the bundle-split check, and the generated Node crypto importer count 46 → 48.
No gate, ignore or budget is changed. W must close these before integration;
§9 records the named residuals and why this unmerged lane remains safe.

**FIXM105C rig lane (2026-10-06).** The fix brief/common rules reserve the
full quality/coverage/accessibility run for the lead; this lane runs all
five typecheck projects, changed-file lint/format checks, owned whole-file
tests at default timeouts, localization/host-API/deadcode/duplication and a
production build. The pre-existing W-owned deferred-webview size and
unlisted lazy chip split failures remain explicit integration deferrals;
no cap, check, ignore or timeout is weakened. Exact money also introduces
the shared USD helper used by M106H/M108T. The final production build reports
903.1/900 KiB browser startup and 50.6/50 KiB deferred JS; the helper adds
about 3.8 KiB to startup on this pre-diet base. W's existing diet and lazy
surface registration are required before release. Final sizes, gate results and red
drills are in `docs/certification/m105-c-cost-(b).md`.

**FIXM105R1 gate ownership (2026-10-06).** The rig brief/common rules
reserve full `npm run quality`, coverage and integration/package certification
for the integrating lead and prohibit running that aggregate in this lane.
R1 runs the five typecheck projects, changed-file lint/format, its entire
owned unit file at the repository timeout, native permission-free suites,
localization, deadcode, duplication, host API and the production build.
The pre-existing generated host API record drift from R1's four Node imports
remains W-owned; refresh it at integration, without weakening the gate.
See `docs/certification/m105-r1-macos-recorder-(c).md` for exact receipts.

**M105 R2 review-fix gate delegation (2026-10-06).** The lane brief and
shared common rules prohibit aggregate `npm run quality` on this shared rig.
Run the complete owned test files at the repository timeout, changed-file
lint/format, typecheck, localization, deadcode, duplication, host API and
production build directly on Win11. The lead owes full quality/coverage and
the hosted matrix before integration; no gate or cap is weakened.
The unchanged W-owned host API record still fails its previously recorded
`node:path` importer count (84 → 85); portable-boundary checks pass. W must
regenerate/review that record with the integrated recorder factory.

**FIXM105R3 bounded repair certification (2026-10-06).** The rig brief and
shared lane rules prohibit aggregate `npm run quality` and the full test
suite. The repair runs all four owned test files with the default timeout,
the 11 byte-exact restored red drills, all-project typecheck, changed-file
lint/format, dead-code, duplication, localization and production build here.
The lead retains integrated full quality/coverage/native/editor gates.
No gate, threshold, test filter, timeout or hook is changed.

**FIXM105R3B final repair certification (2026-10-06).** The same bounded
gate scope applies. The remaining encoder-exit P2 has regressions for
spontaneous, Stop and duration-limit exits, including failed automatic Stop,
and two byte-exact restored red drills. Existing genuine cancellation
assertions now check the exact reason. The existing failure message is used
at runtime and retains its translations in all 14 tables. No review finding
is deferred; the two named integration/gate residuals below remain.

**M105-R3-host-api-count deferral.** `npm run check:host-api` exits 1 on
the same pre-existing generated count as the original R3 receipt:
`node:path` importers 84 → 85. The repair adds no imports or host API calls.
W owns `docs/ide-compatibility/host-api.md`, outside the repair's scope, and
must regenerate/review that row on the integrated source. The check is not
weakened or claimed green; see §9 and the R3 certification.

<!-- plan-archive:end id="gates-a07e4a8e2-34107" -->

## M106 review lanes (2026-10-05 – 2026-10-06)

<!-- plan-archive:begin id="gates-a07e4a8e2-34265" lines="34265-34272" at="a07e4a8e2" bytes="529" sha256="7670fa43086fa1ef084b396e723ec94ba7813fd65de4087ea71c7c8c46481486" -->

**FIXM106S scoped review certification (2026-10-06).** The rig repair
brief requires all three RVM106S P2 findings fixed, no residuals, default
test timeouts, and three-file/three-worker batches. The shared rules
explicitly prohibit aggregate `npm run quality`; the lead retains that
integrated gate. Local scoped regressions, byte-exact red drills, static
checks and a production build precede hook-on commits. No timeout,
threshold, rule, ignore, cap or hook is changed. Evidence is recorded in
`docs/certification/m106-s.md`.

<!-- plan-archive:end id="gates-a07e4a8e2-34265" -->

<!-- plan-archive:begin id="gates-a07e4a8e2-34276" lines="34276-34286" at="a07e4a8e2" bytes="784" sha256="3792416d1acb19d93907bf40baa9fcd53bd13e53237cd03e2268ba08c276d359" -->

**M106T-MODELAPI-BUDGET (2026-10-05, Kubuntu; lane W binding).** The
required merge baseline `33ef31aa2`, before T's changes, builds
`dist/modelApi.js` at 486,485 bytes, 85 bytes above the unchanged 475 KiB
(486,400-byte) cap. T's final bundle is 486,935 bytes: 450 bytes added and 535 bytes over the
cap. The failing gate is recorded in `docs/certification/m106-t.md`.
Baseline comparison restored all four owned source files byte-exact. No
threshold is raised and no full build/quality pass is claimed. W owns the
bundle layout and must reduce/split it before integration is certified.
The base also lacks the feature catalog/reference generator and the
`check:reference` script; **M106T-HELP-REFERENCE** records the integration
entry instead of claiming a nonexistent gate passed.

<!-- plan-archive:end id="gates-a07e4a8e2-34276" -->

## M108 account review lanes (2026-10-06)

<!-- plan-archive:begin id="gates-a07e4a8e2-34288" lines="34288-34355" at="a07e4a8e2" bytes="4636" sha256="53e2c49085edf712e00ce934c5e6cc2f4b1a8220181580dc81397723029047b7" -->

**FIXM108U bounded-lane certification (2026-10-06).** The explicit rig brief
and shared rules prohibit aggregate quality/full unit runs, merges and
network calls. Run complete owning files with repository timeouts and at
most three workers/files, scoped static/build checks and hook-on commits.
The lead retains integrated quality, coverage and installed editor/live
certification. No gate is weakened; receipts are in
`docs/certification/m108-u-panel-and-vs-code.md`.
The FIXM108U2 continuation's final scoped tests pass 690/690 (U 256, K 434),
including 32 browser axe scenes; direct static, localization and production
build gates pass. `check:host-api` still requires
W's generated record update: `node:crypto` imports 46 → 48 and Accounts CSS
in the theme-source list. The API/theme totals are unchanged. Keep that
named integration handoff rather than editing W's owned file in this lane.

**FIXM108H bounded-lane certification (2026-10-06).** The explicit rig
brief and shared lane rules prohibit the full quality run and merges here;
W/the lead runs the full gate before integration. H runs the named complete
owned test files with repository-default timeouts, typecheck, changed-file
lint/format, deadcode, duplication, l10n, host-API and build checks directly
on Kubuntu. Per-finding regressions and deliberate mutations are recorded in
`docs/certification/m108-h-runtime,-acp,-headless,-companion.md`.

**M108-X bounded-lane certification.** The rig brief prohibits aggregate
quality/full-unit runs, merges and network calls. Complete owning test files
run directly on Kubuntu with repository timeouts and at most three files and
workers. Scoped static/build checks and normal hooks certify local commits;
W retains full integrated quality, coverage, installed editor and packaging
checks. No threshold or gate is weakened.

**FIXM108P / FIXM108P2 bounded-lane certification (2026-10-06).** The rig brief and
shared rules prohibit aggregate quality/full unit runs, merges and network
calls. Run complete owning test files with repository timeouts and at most
three workers/files, scoped static/build checks and hook-on local commits.
The lead retains integrated quality, coverage and installed editor/live gates;
no gate is weakened. Receipts: `docs/certification/m108-p-pool-and-policy.md`.
Existing `P-W-HOST-API-RECORD` deferral: the generated Node crypto import
count is 46 rather than 47, from P's earlier confirmation digest; W owns
regenerating that record and rerunning the host API gate during integration.
FIXM108P2 adds no host API and leaves this generated file with its owner.

**FIXM108T bounded-lane certification (2026-10-06).** The rig brief and
shared rules prohibit full quality/full unit runs, merges and network calls.
Run complete owning test files with the default timeout, at most three files
and workers per run, plus scoped static/build gates and hook-on commits.
The lead retains integrated quality, coverage and editor/live certification.
No gate is weakened; receipts are in `docs/certification/m108-t-thresholds.md`.

**FIXM108K bounded-lane certification.** The explicit rig brief and shared
rules prohibit aggregate quality/full test runs, merges and network calls.
Hook-on local commits use complete owning test files, mutation/restoration
drills and scoped static/build checks. The lead retains integrated quality,
coverage and editor/live certification; no gate is weakened.
**FIXM109C2 review repair (2026-10-06, Mac mini).** The remaining RVM109C2
P2 is fixed: exact-anchor backups repair damaged/unreadable destination
documents without authenticating them, retaining owner-only diagnostic
ciphertext before atomic replacement. Backup authentication, complete-state
history admission, destination identity and single-advance pending recovery
remain enforced. All five owned suites pass 71 tests, including the existing
RFC/NIST KATs; focused coverage meets unchanged thresholds. Eight distinct
red mutations fail their named regressions and restore the source byte-exact.
All 79 prior drill receipts remain, with eight appended in the C record.
Test-only fixture consolidation fixes two new duplication-gate findings;
the zero-clone threshold stays unchanged. Records: `docs/certification/m109-c.md`
and `m109-c-drills.json`. Aggregate quality stays lead-owned under the rig
brief; the existing W-owned generated host-API count deferral is unchanged
(crypto 46 → 50, fs 33 → 34, fs/promises 47 → 48, path 84 → 85). The mandatory
native quarantine/diagnostic integration binding is named in §9. No review
finding, gate threshold or file-security guard is deferred or weakened.

<!-- plan-archive:end id="gates-a07e4a8e2-34288" -->

## M96 team review lanes (2026-10-05)

<!-- plan-archive:begin id="gates-a07e4a8e2-35501" lines="35501-35512" at="a07e4a8e2" bytes="821" sha256="b0a1888ccd70a1f7149dc59063aff54ee4a3a05d044e4aba7f641274cde67f53" -->

**FIXM96B (2026-10-05, macmini).** RVM96A findings 9–11 and 23–26 are
fixed with full-file regression runs and byte-exact red drills. All five
TypeScript projects, focused lint/format, localization (0 problems), knip,
duplication (0 clones), dpdm and the production build pass; 96 relevant
tests pass. The host API record gate fails identically on the starting
`006edd40` source and the fixed source: its recorded Node import counts
omit lane B's existing bridge/loopback imports. Justified scope deferral
`M96B-HOST-API-RECORD` (§9): the lead regenerates the shared record after
parallel integration. Full quality remains the lead's gate under the
explicit lane prohibition. No gate, ignore, threshold or deadline changes.
See `docs/certification/m96-b.md` for exact evidence and the late-answer
liveness residual.

<!-- plan-archive:end id="gates-a07e4a8e2-35501" -->

<!-- plan-archive:begin id="gates-a07e4a8e2-35770" lines="35770-35823" at="a07e4a8e2" bytes="3833" sha256="eca6baaacca0751284bea2812b495533771dae8614944467507895f21d1b624d" -->

**M96CINT round-1 partial merged-source proof (historical, 2026-10-05).** Macmini passes all
239 S/Q/T2/V tests plus 29 shared schema/text tests, in 21 complete files
and invocations of at most three files. All five compiler projects, the
harness compiler, full lint/Prettier, deadcode, duplication (0 clones),
localization (0 problems), production and merged-team cycle checks, build,
and all 17 unchanged bundle caps pass. A cumulative-admission mutation fails
three real-repository cases, including interaction; SHA-256-exact restoration
passes all four. The Mac fixture correction retains every assertion.
See `docs/certification/m96c-int.md` and `m96c-int-drills.json`.
The extra host API check fails on the X2-owned generated inventory's five
Node import counts and Traffic stylesheet source; its regeneration remains
with X2 under the brief's explicit docs/wiring exclusion. Full quality,
native/editor/live acceptance, C/O and X2 remain with the lead. These scoped
receipts certify this partial integration, not production team wiring.

**FIXM96CT2 scoped proof (2026-10-05).** Both `RVM96CT2` findings are
fixed within T2. Kubuntu passes all five compiler projects, 21 focused tests,
changed-file ESLint/Prettier, localization, host API, deadcode, duplication
(0 clones), and production build with unchanged budgets. Four guard mutations
fail their named regressions and restore SHA-256-exact source bytes; see
`docs/certification/m96c-t2.md`. The rig/shared rules prohibit this lane from
running full quality, merging, rebasing or pushing. Full quality and the
existing runtime/integration/live handoff remain the lead's work; no gate was
weakened and neither reviewed finding remains as a residual.

**FIXM96CC lane gate scope (2026-10-05).** The owner's rig brief explicitly
forbids a full `npm run quality`, merges, rebases and pushes in this lane.
Focused Vitest, all compiler projects, changed-file lint/format, dead-code,
duplication, localization, host API and production-build checks run directly
on macmini. Hooked local commits are checkpoints for the lead; full quality
and assembled S/K/Q/T2/X2 certification remain the lead's required gates.
Review-repair receipts are in `docs/certification/m96c-c.md`. Final focused
checks pass on macmini: 52/52 owned cases (including real Git under the
unchanged default deadline), all listed static/build gates, and 25 distinct
byte-exact restored guard drills. No RVM96CC finding is deferred.

**FIXM96CO rig validation (2026-10-05).** The lane brief forbids full
`quality` and full test suites on the shared rig; the lead runs those after
integration. Owned files are checked directly on macmini in batches of at
most three Vitest files, plus typecheck, lint, formatting, knip, duplication,
localization and build gates. The host API record still fails only on the
six base Node import-count changes already assigned to X2 (buffer 27→28,
crypto 32→34, fs 24→25, fs/promises 34→36, path 65→68, zlib 1→2).
Its gate is unchanged; X2 must regenerate and review its owned record before
full quality. Native Windows parser/runtime certification is explicitly
pending in §9 and `docs/certification/m96c-o.md`.
**M97 integration gate blockers (earlier 2026-10-05, lane I; superseded by M97FIN receipts).** Full quality did not
exit 0. Source coverage and every production cap pass, but the 456-page a11y
run was stopped within the lane time box after very slow Chrome progress.
Gitleaks reports five historical `authSource.test.ts` findings; only redacted
metadata was inspected. SAST reports five non-literal RegExp findings in the
legal ecosystem readers and rule timeouts. No history, ignore, threshold or
rule was changed. These are release blockers, not waivers; exact receipts are
in `docs/certification/m97.md`. Installed-host certification remains pending.

<!-- plan-archive:end id="gates-a07e4a8e2-35770" -->

## M101 upstream-sync lanes (2026-10-05 – 2026-10-06)

<!-- plan-archive:begin id="gates-a07e4a8e2-35491" lines="35491-35499" at="a07e4a8e2" bytes="689" sha256="37d059f28e2c9599a3018081742465c74247cfb9f45ac1d6949e181d7c014087" -->

**M101INT aggregate receipt (2026-10-06).** The brief authorizes exactly one
`VITEST_MAX_WORKERS=3 npm run quality`. It exits 1 at unit tests: 541 passing
files, 9 failing, 7 pre-existing opt-in skipped; 12,014 passing tests, 32 failing,
72 skipped. Formatting, lint, all five compiler projects, l10n, host API,
deadcode, cycles and duplication pass before that failure. Repairs are verified
by whole owning files and remaining gates separately. This records a justified
local review-commit deferral under rule 2, not an aggregate pass or release
certification; the lead must rerun full quality/coverage on the final integrated
tree. No rule, threshold, test filter or timeout is relaxed.

<!-- plan-archive:end id="gates-a07e4a8e2-35491" -->

<!-- plan-archive:begin id="gates-a07e4a8e2-35863" lines="35863-35890" at="a07e4a8e2" bytes="1878" sha256="f22d40e1549d240e7d6f72bb00de470d08723d1f6d227a7ea96c5a1c3458c9a6" -->

**FIXM101C2 current check scope (2026-10-05, kubuntu).** The five inherited
test repairs from `3e04f6f5` are carried unchanged after their failures are
reproduced here. Their old C2 baseline deferral below is historical, superseded
by this repair lane's complete-file receipts in `docs/certification/m101-c2.md`.
The shared rig common rules expressly prohibit `npm run quality` and the full
test wrapper here; run the required scoped static/build gates and complete
owning suites, with the integrator responsible for full quality and the
platform matrix before release. No threshold, ignore or timeout is weakened.

**FIXM101P1 lane verification (2026-10-05).** The rig brief expressly
forbids the full `npm run quality` wrapper and full unit suite because the
rig is shared; the lead runs the combined four-machine quality gate.
This lane runs focused complete test files (at most three per invocation),
all project typechecks, changed-file lint/format, deadcode, duplication,
localization, host API and production build directly on Kubuntu. The final
receipts and twelve red drills are in `docs/certification/m101-p1.md`: 330
focused tests and all listed lane checks pass, including the unchanged
production bundle-split gate. This defers only the full-tree/full-platform
quality receipt; no gate is weakened.

**FIXM101P2 aggregate gate deferral (2026-10-05).** The explicit lane brief
and its shared `codex/common.md` forbid the full `npm run quality` wrapper
on this shared rig. Run the required scoped suites (at most three files per
run), all five TypeScript projects, lint/format over the complete P2 range,
knip, duplication, localization, host API and production build here; record
actual receipts in `docs/certification/m101-p2.md`. The lead must run the
aggregate quality/coverage/platform matrix before integration/release. No
threshold, ignore or rule is changed.

<!-- plan-archive:end id="gates-a07e4a8e2-35863" -->

## TRAINACT scoped qualification

<!-- plan-archive:begin id="gates-3087b10dd-36944" lines="36944-36950" at="3087b10dd" bytes="508" sha256="ec736d71d88289330b0e3807047bb2e5084797b4ae3b8ff658085dbb9f346a54" -->

**TRAINACT scoped qualification.** The explicit rig/common brief reserves
aggregate `npm run quality` for the lead and forbids it in this lane.
Run production build and all unchanged caps/split checks; complete owning
suites at repository timeouts (at most three files per run); host, unit and
e2e typechecks; changed-file lint/format; knip, cycles, duplication, host API
and localization. Drill both regressions and restore source byte for byte.
Record receipts in `docs/certification/train-activation.md`.

<!-- plan-archive:end id="gates-3087b10dd-36944" -->

## MODELSPLIT4 scoped rig qualification (2026-10-11)

<!-- plan-archive:begin id="gates-3087b10dd-36952" lines="36952-36960" at="3087b10dd" bytes="656" sha256="85bc564035745a9d81d6a022c33305078708ba4e44f671f67390f9fe97274099" -->

**MODELSPLIT4 scoped rig qualification (2026-10-11, kubuntu).** The
explicit lane/common brief forbids aggregate `npm run quality` and reserves
it for the lead's integrated tree. This lane runs complete owning test files
at repository deadlines, all five type projects, changed-file lint/format,
plain knip, duplication, localization, reference, host API, token, plan and
roadmap checks, production budgets, real held/failed-chunk browser cases and
all Models panel visual comparisons. No gate, cap, coverage threshold or
timeout is relaxed. Nine byte-restored red drills and the documented
first-ever estimate are in `docs/certification/models-split.md`.

<!-- plan-archive:end id="gates-3087b10dd-36952" -->

## REL0171B final 0.17.1 branch (2026-10-10)

<!-- plan-archive:begin id="gates-3087b10dd-36962" lines="36962-36971" at="3087b10dd" bytes="672" sha256="ffa2850090730026b850c48655c94562a31005304a8790124a05a367eb4fec10" -->

**REL0171B final 0.17.1 branch (2026-10-10, linuxlt + Kubuntu).** Merge
MENUFAN and VIS0171 onto `release/0.17.1` by meaning, regenerate every
generated file with its script, and repair what the merged gates found:
the pressed menu pill's inset ring (M114 P2), the menu browser cases' setup
cost, the open-menu capture race and the 21 inherited jscpd clones. One
reviewed full visual update explains every changed scene (the two menu
scenes and What's New's 0.17.1 notes); the full unsharded `check:visual`
on the final head is the receipt that closes VIS0171's stopped replay. No
deadline, threshold, assertion or cap changes. Evidence:
`docs/certification/rel0171b.md`.

<!-- plan-archive:end id="gates-3087b10dd-36962" -->

## VIS0171 0.17.1 visual refresh (2026-10-10)

<!-- plan-archive:begin id="gates-3087b10dd-36973" lines="36973-36998" at="3087b10dd" bytes="1947" sha256="f6161e9d669d1f104dc0cac776abe37bb7b4072099ca2967244a433ed41fc808" -->

**VIS0171 0.17.1 visual refresh (2026-10-10, linuxlt).** Compare the full
9,792-frame matrix on `4acb7015f`; classify every changed scene as Title Case,
question-field spacing, provider-picker repair, or an unrelated hold. Inspect
every changed frame before the repository's reviewed update; stop on unrelated
changes. Regenerate all curated README shots, refresh their existing input
fingerprint and current audit hashes, and certify a full zero-changed-scene
replay, complete owning suites at repository deadlines, and an old-baseline
failure with SHA-256 byte-exact restoration in `docs/certification/cifix017.md`.
Aggregate quality remains lead-owned under the shared rig brief. No merge,
push, subagents, paid calls, timeout changes or gate weakening.
The initial reconstruction fails at `paid-always/light/320`: the current
driver waits for Title Case `Auth Method` in the historical sentence-case
source. Make the exact account-label and vault-action selectors accept both
capitalizations, with browser regressions; preserve their readiness checks.
The compatibility repair is committed as `7c8338ac5`; the new regressions
first fail on both historical labels and then all seven readiness tests pass
at repository deadlines. Five typechecks, changed-file lint/format, plain
knip, localization, host API, reference, tokens, plan and roadmap pass.
The unchanged duplication gate reports 21 inherited provider-wizard/test
clones, none in lane-edited files; leave their repair with the lead rather
than weakening the zero-clone threshold or expanding this visual lane.
The complete historical capture succeeds, but two candidate attempts reject
the fake Models state at `models-configure`: its required `sessionBudget`
is absent. PROVWIZ9 already documents this stale harness contract. Add the
canonical `modelsPanelFixtures.makeState().sessionBudget` to the fake host
and a strict production-schema regression; never relax the message schema.

<!-- plan-archive:end id="gates-3087b10dd-36973" -->

## VIS0171 round 1 historical stopped outcome

<!-- plan-archive:begin id="gates-3087b10dd-37009" lines="37009-37019" at="3087b10dd" bytes="816" sha256="9cce17395d920acd30c7691712b341fa8cb61946c628d9e95f7b373236251ed2" -->

**Round 1 historical stopped outcome.** The complete light matrix has 1,440 over-allowance frames
in 120 scenes: 116 label-only scenes, `models-errors` with labels and the
provider repair's error/blocker list, and three What's New content scenes.
Question spacing is already in the recorded source. No observed control-state
coverage changes occur. The full zero-changed-scene gate remains unqualified;
no baseline, README image, input fingerprint or audit hash is approved or
updated. The original manifest remains SHA-256
`e314783f2e7bcd2d95ecd83327e9e9142fe3fe66ae71a0418524fb118c4fed50`.
Owning suites pass 136 of 138 cases; the two retained failures correctly name
stale audit source hashes and the README input fingerprint. Q-VIS0171-RELEASE-NOTES
and the inherited 21 duplication clones remain release holds.

<!-- plan-archive:end id="gates-3087b10dd-37009" -->

## VIS0171 round 2 reviewed baseline

<!-- plan-archive:begin id="gates-3087b10dd-37021" lines="37021-37050" at="3087b10dd" bytes="2341" sha256="0fafaa158efe3543c8efdf552550943580ab400bb659bd468f41d2f1e7a846d6" -->

**Round 2 reviewed baseline and drill complete; full replay unqualified.** The lead accepts both harness repairs and approves
the 120 observed scenes, including 0.17.1's release-note content. The earlier
stop is historical; Q-VIS0171-RELEASE-NOTES is resolved. Finish the complete
six-theme comparison and per-frame inspection before the named reviewed
update, then regenerate every README shot and freshness record. Require the
full official replay and owning suites at repository timeouts, plus an
old-baseline failure and byte-exact restoration. Aggregate quality and the
inherited duplication repair remain lead-owned; no merge or push.
All 19 curated README captures are regenerated and inspected; 18 change and
`languages.png` is byte-identical. The 20 stale current audit rows are refreshed
without changing historical grades or evidence. All nine complete owning suites
pass 138 cases at repository deadlines; five-project typecheck also passes.
All six themes are captured and reviewed: 8,640 over-allowance frames in the
120 approved scenes, plus 90 byte-different frames within the unchanged pixel
allowance. No observed control-state coverage changes occur; question spacing
and 0.17.1 release highlights are intact. The official baseline update
and restoration drill pass. The repository update records all 9,792 PNGs /
450,604,546 bytes / 512 MiB at source `f8db72798`, with every historical
components/target/applied-state row preserved. The additional 1,255 within-policy
frames are inspected through 830 native regions on 26 sheets; no defect is
observed. Manifest owners pass 24/24 after update. Baseline commit: `f7243df25`.
The old-baseline drill exits 1 at 2,075 changed pixels against allowance 12,
then restores manifest and PNG byte-exact by SHA-256. The full unsharded replay
is intentionally stopped to respect the 90-minute rig time box, after 1,152
reported captures without an observed visual regression. Its terminal-close
error is interruption evidence, not a new visual failure. No full result is
written; zero-changed-scene qualification remains pending. Next: run the full
`npm run check:visual` in terminal mode with enough time for all 9,792 frames,
then append its actual receipt. Aggregate quality and inherited duplication
repair remain lead-owned; retained ignored browser profiles need lead cleanup.

<!-- plan-archive:end id="gates-3087b10dd-37021" -->

## PROVWIZ10 scoped qualification (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37052" lines="37052-37066" at="3087b10dd" bytes="1264" sha256="94350333a43976d18fdb773aeed80def628ddc493179b53156edf4793b77b6ab" -->

**PROVWIZ10 scoped qualification (2026-10-09, complete).** Both RVPROVWIZ9C
P2 repairs pass production/shared-form regressions, including genuine concurrent
credential changes and retry notices in all 14 translations. All 46 owning
files pass 833 tests; request goldens pass 152; Help/browser-English files pass 141. Both deliberate reversions fail and restore source SHA-256 bytes exactly;
the final restored focused run passes 108. One unit tsc, changed-file ESLint/
Prettier, localization/reference/host API, plain Knip and production build pass.
The inherited surface-English hold is closed at 25595 / 25600 bytes by shortening
existing `referenceQuestionsDeferral` in all tables; no cap or gate changes.
Production English/German visual checks pass at 690/320 px. A new repeated test
expectation was shared without losing assertions; plain jscpd remains only the
inherited 21 clones / 287 lines / 1970 tokens at its unchanged zero threshold.
Aggregate quality/coverage/release/editor/hosted/live gates remain lead-owned
under the explicit rig brief; no full quality claim. Next slice is lead review
and cross-rig release gates, including the inherited duplication hold, then
PROVSTORE-LOCKLIB after M123. Receipts: `docs/certification/provcat.md`, PROVWIZ10.

<!-- plan-archive:end id="gates-3087b10dd-37052" -->

## PROVWIZ9 scoped qualification (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37068" lines="37068-37086" at="3087b10dd" bytes="1483" sha256="6f21e6c0357ec4be98ce3a67acb69541b0f1015fb76bb3eb89f4fdc4d0a815a2" -->

**PROVWIZ9 scoped qualification (2026-10-09).** Ordered provider saves remove
rollback after RVPROVWIZ8C's three P2 findings. All 46 complete owning files
pass 816 tests at repository deadlines, including the final lazy-store preflight
move. Request goldens pass 152; deliberate byte-exact source drills prove guards
fire. Every partial outcome keeps completed writes and refresh warnings append.
New-origin rows require an origin-bound usable key. Budget-only drafts retain
fresh retry baselines; quick-pick conflict retries preserve intervening edits.
English/German production rendering passes at 690/320 px without document
overflow. Full quality, coverage, packages, hosted/editor and live qualification
remain lead-owned under the explicit rig/common brief. Plain jscpd retains the
same inherited 21 clones / 287 lines / 1970 tokens, with no new clone. Full
production build is held by surface English at 25651 / 25600 bytes: the unchanged
base built on this same macbook has exactly the same size/failure, and this lane
adds no surface bytes. Do not raise the cap or claim full quality green. The
initial schema split failure is fixed by preflight through the existing lazy
provider-store port; individual final split/global/notices receipts are recorded
in `docs/certification/provcat.md`. Next slice: lead review and cross-rig release
gates, including inherited size/duplication holds; then PROVSTORE-LOCKLIB after
M123 lands on main for the accepted cross-window residual.

<!-- plan-archive:end id="gates-3087b10dd-37068" -->

## PROVWIZ8 scoped qualification (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37088" lines="37088-37101" at="3087b10dd" bytes="1034" sha256="93490878e916efd8015a84166d311462f13394ee3fa367dcb62e8618f6f47fe4" -->

**PROVWIZ8 scoped qualification and retained duplication hold (2026-10-09).**
Repair RVPROVWIZ7C P2-3/P2-4 with a per-field inverse in the existing provider
mutation and an honest saved-provider notice on refresh failure in all 14
languages. Complete provider/models/capability suites pass 802 tests; Meta
request goldens pass 152. All qualifying guard drills fail and restore bytes
exactly; the final focused run passes 63 tests. The rig/common brief delegates
aggregate quality, coverage, packages, hosted/editor and live qualification to
the lead. Plain jscpd remains exit 1 at the unchanged threshold with the same
21 clones / 287 lines / 1970 tokens as the reviewed base. A new repeated Test/wait
interaction is shared without dropping assertions; no new clone remains. The
lead's broader duplication cleanup remains open, and quality is not claimed
green. P2-1/P2-2 are the explicit 0.17.1 cross-window residual at M95 and §8,
awaiting PROVSTORE-LOCKLIB after M123. Receipts: `docs/certification/provcat.md`,
PROVWIZ8 section.

<!-- plan-archive:end id="gates-3087b10dd-37088" -->

## PROVWIZ7 scoped qualification (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37103" lines="37103-37116" at="3087b10dd" bytes="1089" sha256="ebe46a51545b3a8027e2ceebd1a7569f8d3a340d76798cf899ae9222a0fb05d3" -->

**PROVWIZ7 scoped qualification and retained duplication hold (2026-10-09).**
Repair both RVPROVWIZ6C P2 findings with host-only edit/credential snapshots,
changed-field comparisons inside the provider mutation, expected-default
comparison and a validated Reload action. All 45 complete provider/models files
pass 788 tests at repository deadlines; 15 deliberate guard failures restore
source SHA-256 exactly. Changed-file lint/format, compiler, localization/reference,
host API, plain Knip and production size/split/global/notices checks pass. Keep
the inherited zero-clone gate's 21 clones / 287 lines / 1970 tokens; this round's
one repeated assertion sequence is shared, leaving no new clone. The initial
English surface overflow is repaired by keeping the host sentence off the
browser's text comparison path, restoring its exact 25597-byte baseline under
the unchanged 25600-byte cap. Aggregate quality, coverage and hosted/editor/live
qualification remain lead-owned under the rig brief; do not claim full quality
green. Receipts: `docs/certification/provcat.md`, PROVWIZ7 section.

<!-- plan-archive:end id="gates-3087b10dd-37103" -->

## PROVWIZ6 scoped qualification (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37118" lines="37118-37130" at="3087b10dd" bytes="989" sha256="1a103e326d14c554eec49ab5ba6af3104e6b2e241efb6f4a52b4bb1d290f888e" -->

**PROVWIZ6 scoped qualification and inherited duplication hold (2026-10-09).**
The rig/shared brief reserves aggregate quality, coverage and hosted/editor
qualification for the lead. All 45 complete provider/models files pass 774
cases at repository deadlines; 18 deliberate failures restore source SHA-256
exactly. Five typechecks, changed-file lint/format, localization/reference,
host API, plain Knip and production build pass with unchanged caps. The
one newly introduced repeated test block is shared without removing assertions.
A temporary source archive of the exact merge base `40fdfe2fe` and the repaired
worktree both fail the unchanged zero-clone gate with **21 clones / 287 lines /
1970 tokens**. None is introduced by this lane. Retain the prior wizard lane's
lead-owned broader duplication cleanup below; do not claim aggregate quality
green. The owned temporary baseline is removed. Evidence and per-batch/drill
receipts: `docs/certification/provcat.md`, PROVWIZ6 section.

<!-- plan-archive:end id="gates-3087b10dd-37118" -->

## PROVWIZ2 round 5 scoped qualification (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37132" lines="37132-37139" at="3087b10dd" bytes="595" sha256="8b58f7c21b90964ee0dccfa6fdef41fb4a7fb3e21950f4e32ffb3a7db981b36d" -->

**PROVWIZ2 round 5 scoped qualification (2026-10-09).** The rig brief
reserves aggregate quality for the lead. All 28 owned files pass 511 tests at
repository deadlines; five typechecks and individual lint, format, deadcode,
localization, reference, host API and production build checks pass. Ten
purposeful breaks fail and restore source bytes exactly. Duplication remains
the inherited 24 clones / 312 lines / 2206 tokens below; no new clone or gate
change is introduced. Final compiler/lint/format checks include the added
failed-retest regression. Receipts: `docs/certification/provcat.md`.

<!-- plan-archive:end id="gates-3087b10dd-37132" -->

## PROVWIZ2 round 4 scoped qualification (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37141" lines="37141-37155" at="3087b10dd" bytes="1078" sha256="aecb07ec158a05fa3ebcf02e00b94c800aa59cba6263c9565a85d728c85f32c8" -->

**PROVWIZ2 round 4 scoped qualification (2026-10-09).** The explicit lane
brief and shared rules prohibit aggregate `npm run quality` and reserve it
for the lead. Run complete owned suites at the repository's default timeout
and all prescribed individual gates here; do not weaken any gate. Full
quality, coverage and installed-editor qualification remain with the lead.
Evidence and deliberate byte-exact drills: `docs/certification/provcat.md`.
Duplication is an inherited lane hold: a read-only source snapshot of
`bfbdf3c35` fails the unchanged zero-clone gate with 25 clones (321 lines,
2,275 tokens). Round 4 removes all newly introduced clones; its scoped
cleanup reduces the inherited set to 24 (312 lines, 2,206 tokens). The
remaining prior-round test setup/interaction and wizard-footer duplication
is deferred to the lead's broader quality cleanup, outside these five fixes.
No ignore, threshold, assertion or check is changed; do not claim quality
green. G94 (G66 on the branch, renumbered at the 0.17.1 merge) records
freezing worktree edits during hook execution.

<!-- plan-archive:end id="gates-3087b10dd-37141" -->

## PROVWIRE lane note (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37157" lines="37157-37161" at="3087b10dd" bytes="381" sha256="73e75cc3323b0b0372fd22ff51fbd770ea1086faa37f7de97554980c8fa3dd45" -->

PROVWIRE (2026-10-09): the lane brief/common rules reserve aggregate
`npm run quality` for the lead and prohibit running it in the lane. Scoped
provider/models tests and all requested static checks, plain knip, duplication,
host API and production build pass; no threshold, ignore or deadline changes.
This is a qualification handoff, not a full-quality or installed-editor claim.

<!-- plan-archive:end id="gates-3087b10dd-37157" -->

## CIR4MAC scoped hosted-CI repair (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37289" lines="37289-37299" at="3087b10dd" bytes="795" sha256="0dd7b70bd50d3ea0dae5cfc5d006763de90ca441b56091d4248d8ff7dbc7e9e3" -->

**CIR4MAC scoped hosted-CI repair (2026-10-09, macmini).** Reproduce
round 4's macOS target-size deadline and palette failure-render ordering
under bounded CPU/memory pressure before repairing their causes. Keep all
themes, targets, assertions, repository deadlines and gate limits. Profile
scene setup and lazy rejection delivery; run the complete owning files,
five type projects, changed-file lint/format, plain knip, duplication,
localization, host API and production build. Record byte-exact red/restored
drills and load receipts in `docs/certification/cifix017.md`, Round 4,
macOS. The explicit rig/common brief prohibits aggregate quality and
delegates full hosted qualification to the lead. Requested hosted log
downloads return HTTP 403; no merge, push, rebase or paid/live model call.

<!-- plan-archive:end id="gates-3087b10dd-37289" -->

## CIFIX017 round 5 (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37301" lines="37301-37317" at="3087b10dd" bytes="2030" sha256="e97ecf08636d0e735756c24f22d43bd5e2997de1400e3bbfc51763e3a3952271" -->

**CIFIX017 round 5 (2026-10-09, lead + CIR5WIN + CIR5MAC).** Run 38022741513
left four single-test failures, each on one OS. Lead: the M108 two-account case
read usage on `turnCompleted`, but the fake CLI sends `usage/changed` after it
and the frames can arrive in separate reads, so it now also waits for
`onUsageChanged`; the estimator harness pays the browser's first-navigation
work once in `beforeAll` (only the first matrix case ever missed, at
navigation in round 3 and readiness in round 4), keeping every case's
two-second bound. The lead then took the other two over from CIR5WIN and
CIR5MAC (owner, 2026-10-09). Windows sshRunner exit-75 reached its unchanged
10 s job budget: Git Bash maps the helper's `nice -n 10` to the BelowNormal
class, which Windows' strict priority starves behind normal work, so the
Git Bash fake remote runs the job unniced, as it already stubs `getconf` and
`uptime`. macOS lifecycle read no members right after the root exits, while
launchd reaps the root's unreaped `detached` child; the case now waits out
that reap and reports the raw `ps`/helper reads if it recurs. Neither hosted
failure reproduced on the rigs (macOS 15 x86_64 rigs against hosted macOS 26
arm64), so hosted loops on a probe branch supply the evidence. A sweep of recent CI history added Windows cleanup holds (three suites now use `removeFolder`), the m114Panel first case (the same first-page warm-up) and Windows pageConverter (its fourth page gets the normal converter limits). Hosted macOS, failing only on deadlines in browser/process suites, now runs files one at a time over six shards, as Windows does. The hosted probe (150 rounds on macos-26-arm64) then caught the lifecycle cause itself: macOS 26 prints `?<` as the state of a process mid-transition, and the Mac table parser refused the whole table, so membership read empty; the parser accepts `?` (helper identity still proves membership). Its two outputSchema "promptly" probes measure the child's CPU time against the same 50 ms instead of wall time.

<!-- plan-archive:end id="gates-3087b10dd-37301" -->

## CIFIXM macOS CI repair scope with CIFIXV hosted visual repair (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37439" lines="37439-37460" at="3087b10dd" bytes="1611" sha256="1b11a8ec1b66dd7aed8c65c331915a1662f1ea1200d7f23e11564892bee2ab7a" -->

**CIFIXM macOS CI repair scope (2026-10-09).** Reproduce the reporting
journals/cache/engine, schedule-runtime and M114 panel/conversation failures
from hosted run 37897298018 on the macbook rig. Repair only the shared
reporting fixture boundary, host-dependent schedule expectations and proved
macOS browser causes; preserve all assertions, timeouts, budgets and visual
baselines. Diagnose native-helper and static-gate failures before changing
product code. No paid/live model calls, merges, pushes or full quality run;
scoped checks and local hook-enabled commits follow the lane brief. Native
compile job 113711458248 succeeded; job 113717543639 is an aggregate gate,
not a compiler failure. Log downloads return HTTP 403; readable job metadata
and local reproductions are the evidence. Results and red drills live in
`docs/certification/cifixm-macos-ci.md`. Combined quality, build/deferred
bundle/cycle repairs and visual baselines remain with their assigned lanes.
Reporting/schedule fixtures are corrected and drilled: the final CI-mode
batches pass all 191 owning tests with unchanged deadlines. Actual native
compilation and local permission-free checks pass. Current typechecks,
build, cycles, duplication, lint, tokens, localization, reference, host API,
plan and roadmap checks pass. `check:badges` receives gzip bytes at its remote
JSON boundary and fails; retain its strict check for the lead's permitted
network environment. Q-CIFIXM-HOSTED-ERRORS retains the unavailable hosted
browser traces. G84 records the in-flight commit/edit hazard; its future
M96c/M116 enforcement is not claimed here.

<!-- plan-archive:end id="gates-3087b10dd-37439" -->

## MERGESPAWN (2026-10-08)

<!-- plan-archive:begin id="gates-3087b10dd-37522" lines="37522-37528" at="3087b10dd" bytes="518" sha256="cf706cd2974626990f93984b3dc58fc9e4566ca479bddb011e7a2639f1e29b13" -->

**MERGESPAWN (2026-10-08).** `rel017/spawn4` is merged into `release/0.17.0`
with both sides' behaviour; the reporting bundles now share resource
admission and `dist/validation.js` exports `tuple`. Open for the lead, caps
and assertions unchanged: `dist/resourceGovernor.js` is 132.2 KiB against
125 KiB (spawn4's launch machinery on top of U–C1 and W2), activation grows
17,680 B, and eight test files that pass at `506ae2375` fail as at
`d1a71a348`. Receipts: `docs/certification/int0170-combined.md`, MERGESPAWN.

<!-- plan-archive:end id="gates-3087b10dd-37522" -->

## VISREGEN2 release-content repair and verified refresh (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37361" lines="37361-37386" at="3087b10dd" bytes="1821" sha256="25533df8993e3c3cffd04fafa9c4f617753295b09ee0b5adca9eb4dcda160a44" -->

**VISREGEN2 release-content repair and verified refresh (2026-10-09).**
The original two-release tree measured 79,510 decoded bytes against the
unchanged 76,800-byte bound. The lead authorized tightening only 0.17.0
wording, preserving every change, Highlight and section heading, with a
72,000-byte target. The result is 68,401 decoded / 25,347 encoded bytes;
0.16.0 and older notes remain byte-exact. The standard writer passes. Full
visual review and reviewed-update capture finish all 9,792 frames. The
review explains the original 23 status/menu scenes and two notes scenes;
eight intended README shots and their stale source records are refreshed.
All six required visual owners pass 195 tests at repository defaults.
Fix/rendering owners add 152 passing tests; the notes owners add eighteen.
Five type projects, changed-file lint/format, plain knip, localization,
reference, host API, tokens, plan, roadmap and production build pass. The
normal visual replay passes all 9,792 frames with eighteen counted pixels
within unchanged per-image tolerance; the manifest remains unchanged.
Six-theme accessibility passes 1,632 pages with zero violated pages and
315 retained incomplete findings. The ordinary deferred-loading-selector
drill fails its target, then byte-exact restoration passes all three
readiness tests at repository defaults. Goldens, intended README images,
current source records and certification are refreshed on committed source
`53fb033b49635ec95e0d5fa26dbed5248db445e8`.
Bounded deferral: fresh `npx jscpd` still finds the inherited 51-token clone
at `test/unit/windowsTrustedPath.test.ts:206,279`, with none in changed
files; the lead repairs that unrelated Windows fixture before aggregate
quality. No gate, timeout or cap changes; common.md assigns aggregate
quality and hosted CI to the lead.

<!-- plan-archive:end id="gates-3087b10dd-37361" -->

## M119PLAN documentation-only certification (2026-10-07)

<!-- plan-archive:begin id="gates-3087b10dd-38532" lines="38532-38550" at="3087b10dd" bytes="1427" sha256="fe62652aeae7ef6392ba1a5448d517eaa13619e5a76cfc1c2c2aaf0771a206bf" -->

**M119PLAN documentation-only certification (2026-10-07, Kubuntu; planned
under the numbers D102/M119, ported as D106/M124 on 2026-10-09).** The
lane brief limits changes to PLAN and `docs/design/mcp-connector.md`, requires
changed-file `npx prettier --check` and a local hooks-on commit, and forbids
source changes, pushes and unlisted merges. Shared `codex/common.md` reserves
aggregate quality for the lead; `npm run quality` is deferred here without
changing any gate. No runtime tests, new gates, red drills, builds, installed
client qualification or model calls are claimed by the planning lane. The
implementation acceptance and deliberate red drills remain M124's unchecked
delivery work. `npx prettier --check PLAN.md docs/design/mcp-connector.md`
exited 0; staged `git diff --check` passed. The document review checked unique
D102/M119 headings (now D106/M124), 23 unique proposed tools, all nine design
sections, every requested platform, local file links and explicit
dependency/unrun status; the design cites 28 distinct primary-source URLs.
Local commit `b27ad09a9` passed the unchanged hooks: lint-staged formatted
both Markdown files and gitleaks' staged scan reported no leaks. Only the two
authorized docs changed; no new gate or runtime test needs a planning-lane red
drill. The follow-up receipt commit also uses these hooks; final verification
repeats changed-file formatting after recording this receipt.

<!-- plan-archive:end id="gates-3087b10dd-38532" -->

## CM1012R7 lane verification (2026-10-10)

<!-- plan-archive:begin id="gates-3087b10dd-38554" lines="38554-38563" at="3087b10dd" bytes="750" sha256="26a71ca7595dc2104149067b458c8aa1d51416e9bc011e962ade10aac8257453" -->

**CM1012R7 lane verification (2026-10-10, linuxlt).** The shared lane
brief explicitly forbids full `npm run quality` and the full unit/coverage
run; the lead owns that aggregate matrix. All 443 tests across 18 complete
owning/importing files pass at repository timeouts, with 3 workers and at
most 3 files per invocation. All five typecheck projects, changed-file lint
and formatting, plain knip, duplication, localization, host API, reference,
cycles and production build pass. The generated host API record refreshes
four Node import counts; no VS Code API changes. Unchanged caps hold:
extension 550.1/600 KiB, Model API 515.8/525 KiB, checkpoint store 87.3/225 KiB.
No browser, install, live or paid call, merge, push, rebase or gate weakening.

<!-- plan-archive:end id="gates-3087b10dd-38554" -->

## MSM113 finish (2026-10-17)

<!-- plan-archive:begin id="gates-3087b10dd-33836" lines="33836-33851" at="3087b10dd" bytes="1155" sha256="41dedaa07aa99fff4112e0a7e6cd1050d9802c268b8d075991dfb3d9978aa236" -->

**MSM113 finish (2026-10-17, linuxlt).** Merged `main-now` and flipped the
estimate, playbook and schedules kinds to working end to end: thirteen
working kinds (project, milestone, release, changes, quality, usage, session,
keybindings, accounts, security, estimate, playbook, schedules); fleet (lane
CM1135B) and issues stay dormant. Request language rides the read context
with its locale (D33; `SourceReadContext.locale`); the estimate refusal path
no longer reads the installed table. The estimate source restores the
estimator's disclosure pointers whole after the export scrub (E23: the
scrubber reads multi-segment JSON Pointers as POSIX paths). Row-duplication
coverage binds every collector row call including the forwarded estimate,
playbook and schedules builders (19 new explicit cases; the probe suspends
duplication around builder runs). Packed proof: `report estimate` renders a
real forecast through `dist/acp.js`; reports.e2e 27 pass through the real
CLI. Record: `docs/certification/msm113.md`. Known deferrals (all
pre-existing on main, §7): the bundle-split reporting backend, the
estimator shared-module cycle, and six jscpd clones.

<!-- plan-archive:end id="gates-3087b10dd-33836" -->

## CM1133R4 bounded review gates with CM1134AR6 scoped qualification (2026-10-11/12)

<!-- plan-archive:begin id="gates-3087b10dd-37203" lines="37203-37211" at="3087b10dd" bytes="637" sha256="0fd25ddb44e74b207d68241c55861a724f3c2edc075ae1247448e9169eb9868e" -->

**CM1133R4 bounded review gates (2026-10-11, kubuntu).** The rig/common
brief delegates aggregate `npm run quality` to the lead and requires scoped
checks, five typechecks and every dependent suite at repository deadlines.
The owner explicitly leaves this branch's inherited exact-money guard
(`core/usage/journalStore.ts` and `core/usage/reportingAmount.ts` numeric fields)
and the `usagePanel.js` 138-byte budget overage outside this repair. Neither
guard, limit, ignore nor hook is changed. All accounts/security findings are
closed with regression and restoration receipts in
`docs/certification/m113-accounts-security-c-m113-3.md`.

<!-- plan-archive:end id="gates-3087b10dd-37203" -->

## CM1134AR6 journal follow-up (2026-10-12)

<!-- plan-archive:begin id="gates-3087b10dd-37225" lines="37225-37233" at="3087b10dd" bytes="654" sha256="523b4fb175171a3e736df5757625eaa3bea2a2c5d2d81e0d42edf16fb6098b6a" -->

**CM1134AR6 journal follow-up (2026-10-12, Kubuntu).** The dependent closure
exposed two twin-calibrated `scheduleJournal` bounds the shared lifecycle
broke (23/23 on the base commit): the parse bound assumed the twin's old
zero-parse mutex, and the byte coefficient assumed three fences per fire.
Fixed in code first (per-acquisition fence-parse cache, existence-only
cleanup), then corrected the bounds to the measured production-faithful cost
(`< 6` parses with the exact derivation, `run * 800` for five ~150-byte
fences per fire) with reasons in the test comments and the certification
record. No timeout, guard, cap or unrelated threshold changed.

<!-- plan-archive:end id="gates-3087b10dd-37225" -->

## CM1134AR4 scoped qualification (2026-10-11)

<!-- plan-archive:begin id="gates-3087b10dd-37235" lines="37235-37248" at="3087b10dd" bytes="982" sha256="0638d16802a5c8d5c995b5cd1373499cfb9eb260c299caea341eebf9bd1626d2" -->

**CM1134AR4 scoped qualification (2026-10-11, Kubuntu).** The explicit
rig/common brief delegates aggregate quality to the lead. This repair runs
all five typechecks, scoped static gates, the complete changed-source
dependent closure and editor/ACP/CLI host suites at repository deadlines.
The production build hits the inherited `usagePanel.js` size failure:
76,938 bytes against 76,800. Its 41 local inputs are unchanged from
`ed0cd5000`; an official in-memory rebuild is byte-identical. The affected
report engine and reader pass their unchanged 175/59 KiB budgets. The
unchanged source-list and usage money-structure assertions reproduce the
review's base failures; execStdio's base setup failures are recorded rather
than repaired, as the brief directs. These are lead integration deferrals,
not release-green claims; no cap, assertion, timeout or hook is relaxed.
Complete receipts and all twelve repair drills are in
`docs/certification/m113-playbook-schedules-c-m113-4.md`.

<!-- plan-archive:end id="gates-3087b10dd-37235" -->

## FIXM109C review repair (2026-10-05)

<!-- plan-archive:begin id="gates-3087b10dd-37645" lines="37645-37658" at="3087b10dd" bytes="1063" sha256="f9666cd387c436dc9157d9e46d37c0b6db99463187f1ba42e149a13607dbc9d3" -->

**FIXM109C review repair (2026-10-05, Mac mini).** All five RVM109C findings
are fixed: exact committed-state/hash-chain anchoring, explicitly confirmed
restore with revocation-preserving admission, authenticated write-ahead restore
intent and idempotent recovery, canonical validated MAC serialization, RNG
failure erasure and independent native fixture parents. The five complete
owned suites pass 61 tests and focused coverage meets unchanged thresholds;
20 red executions of 15 distinct mutations fail their named regressions and
restore sources byte-exact. Records: `docs/certification/m109-c.md` and its
existing drills JSON. The rig brief reserves aggregate quality for the lead.
The W-owned host API record remains an explicit deferral: crypto imports
46 → 50, fs 33 → 34, fs/promises 47 → 48, path 84 → 85. No host API or built-in
is added; W must regenerate after integration. No review finding is deferred;
P/B's protected complete-state anchor and W's trusted confirmation bindings
are mandatory before this unwired core ships (named in §9).

<!-- plan-archive:end id="gates-3087b10dd-37645" -->

## C-M109-1b scoped qualification (2026-10-10)

<!-- plan-archive:begin id="gates-3087b10dd-36766" lines="36766-36774" at="3087b10dd" bytes="676" sha256="34d2328ff920de1f4e16ea8739dd39a6af19a21f647f944966c4a92131b36c0e" -->

**C-M109-1b scoped qualification (2026-10-10, Kubuntu).** The lane brief
reserves full quality for the lead. Targeted types, lint, formatting, dead code,
duplication, localization, host API, reference, roadmap and production checks
run without changing any existing gate. A clean scratch build of starting
revision `96ded9299` already fails the Models body cap (75.8 KiB against
75 KiB); record the exact baseline and current bytes in the certification
receipt and defer that pre-existing browser-budget repair to the lead. The
broker gets only its own measured-plus-15% cap. No editor surface is enabled
until part (a)'s installed bindings and the native host receipts pass.

<!-- plan-archive:end id="gates-3087b10dd-36766" -->

## M109 H verification deferral (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-37707" lines="37707-37715" at="3087b10dd" bytes="671" sha256="5edccaf28adaa7cf9941a71c1ee263e3e612717ecae3feeb3f217ad4e78e921b" -->

**M109 H verification deferral (2026-10-06).** H58 proves unconditional
`denied` exit and vault-session close. An additional new assertion against
`FakeAgentHost.cancel` failed after two fixture fixes (first prevent immediate
completion, then hold the fake turn open). Under the lane stop rule, do not
keep rewriting that spy path. It is removed from H58 with this explicit
record; no production cancellation or existing gate is changed. Verify actual
engine/command-tree stop through B/X's installed session/lifetime binding at
integration, and run the existing exec lifecycle regressions. H does not claim
that native process-stop proof from its injected session fake.

<!-- plan-archive:end id="gates-3087b10dd-37707" -->

## M95R3 integration gate status (2026-10-05)

<!-- plan-archive:begin id="gates-3087b10dd-38403" lines="38403-38422" at="3087b10dd" bytes="1465" sha256="2dea0e97b02cd3cfd6568906b8a84e4ad7b72688b2ec7b2c3f0cf998e7d7b847" -->

**M95R3 integration gate status (2026-10-05).** The rig authorizes local
merge/repair commits with unchanged hooks and one final full quality run.
These preserve reviewable integration work and do not propose a release.
Copilot's joined factory/host regression remains stopped under the shared
two-fix rule; acceptance 9 awaits the size-rule clarification in §3. All
fixed bundle caps stay unchanged. The joined build reports providers
146.4/125 KiB, browser startup 910.7/900 KiB and deferred browser code
59.0/50 KiB. The brief assigns the startup diet to a separate batch; the
provider composition also requires a lazy split before this tree can ship.
The full 764-page accessibility run reports zero violations but 18 harness
pages without results. The repaired 48 affected pages and three deliberate
guard drills pass after exact restoration; a complete 764-page rerun remains
open. The single final three-worker quality run at `477fff4d` exits 1:
format, whole-tree JavaScript lint and CSS lint pass, then the rig cannot
load the pinned PSScriptAnalyzer 1.25.0 module. The wrapper never reaches
typecheck, unit/coverage, build or its later security/accessibility steps;
the separately recorded owning checks remain their own receipts. No
second wrapper, network install, global write or analyzer-pin change is
attempted. Exact final gate receipts belong in docs/certification/m95-r3.md. No
assertion, coverage threshold, ignore, deadline or rule is relaxed.

<!-- plan-archive:end id="gates-3087b10dd-38403" -->

## FIXM102J scoped repair receipt (2026-10-05)

<!-- plan-archive:begin id="gates-3087b10dd-38007" lines="38007-38016" at="3087b10dd" bytes="697" sha256="7678316db6b332f5ed7d7a77a341eb3821687292814b3c99668b3994fcb0edfc" -->

**FIXM102J scoped repair receipt (2026-10-05).** The five owned test files
pass 71/71, all five TypeScript projects pass, and owned-file ESLint/Prettier,
deadcode, duplication and production build checks pass. Full quality is
reserved for the lead by this rig brief and was not run. The unchanged
integration failures remain visible: localization has 14 absent usage tables
plus 3 unused manifest references (17 problems; L/W), and the host API record
has one drift in five Node importer counts (W). These are the same failures
reported at `4207b270`; no rule, cap or threshold is changed. Named follow-ups
are in §9 and exact commands, guard drills and limits in
`docs/certification/m102-j.md`.

<!-- plan-archive:end id="gates-3087b10dd-38007" -->

## M94KR3 scoped qualification (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37399" lines="37399-37419" at="3087b10dd" bytes="1446" sha256="7e98981d06fac8ceabb775ba306acab2f474e9d92723605302acdc5c419cfb88" -->

**M94KR3 scoped qualification (2026-10-09, kubuntu).** The lane's required
host typecheck, and the webview and unit projects, pass. The broader E2E
typecheck fails at unchanged `test/e2e/acpFixture.ts:26,34`: esbuild requires
a mutable `external` array but receives the readonly `ACP_AGENT_EXTERNALS`
tuple. The same TS2345 errors reproduce in an untouched `bea292208` archive
using this rig's installed pins; neither the fixture nor the tuple changed
in this lane. The integration Tab fixture now uses the keyed grant and
reloading state and its typecheck passes. Full duplication reports only the
inherited 51-token clone in `test/unit/windowsTrustedPath.test.ts:206,279`,
also reproduced unchanged in the base archive; the new binding suite has
no remaining clone. Leave those unrelated fixture repairs and aggregate
quality to the lead under the scoped brief; no rule, assertion or threshold
is waived.
The additional visual run stopped while reconstructing the committed
baseline `484964c46c307b48a5f00b127c4bf358dd27aebf`, before candidate comparison:
Playwright's `scrollIntoViewIfNeeded` found a detached control at
`test/harness/goldens/capture.mjs:413` after 2,160 baseline captures. The
manifest and pixel thresholds remain unchanged; full visual verification
stays open with the lead rather than altering the unrelated harness.
Receipts, default-timeout suites, red drills and production measurements:
`docs/certification/m94kr3.md`.

<!-- plan-archive:end id="gates-3087b10dd-37399" -->

## REDM109B / D99 (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-37758" lines="37758-37775" at="3087b10dd" bytes="1345" sha256="e8a33e8c9ca0ce6dcfe209ecc40928737f2bba0589be5c3c41fd87224fc0c18e" -->

**REDM109B / D99 (2026-10-06, Mac mini).** The broker core is a synchronous
reducer with tagged effects; the old queue and async re-validation implementation
are deleted. All three review reports have named regressions. The final restored
source passes 282 vault tests at repository-default timeout, at most three files
and three workers per invocation; the deterministic scheduler covers 505
exhaustive and 900 seeded schedules (seed 109003), 40,025 invariant steps.
The three required generation/incarnation/unowned-cleanup mutations each fail
its named test and restore byte-exact with current-source SHA-256 receipts.
All five typechecks, changed-file ESLint/Prettier, plain knip, zero-clone jscpd,
localization, schema drift and production build pass; every bundle cap is unchanged.
The only required targeted gate deferral is the same six pre-existing Node
import counts in W's generated host API record; the existing B-W patch still
applies cleanly. Aggregate `npm run quality` is prohibited by the brief and is
lead-owned, as are the joined native/editor matrix and bundle registration.
No dependencies, suppressions, casts or weakened gates were added. This record
supersedes the historical FIXM109B/FIXM109B2 await inventories and ownership
claims; current evidence is `docs/certification/m109-b.md` and
`m109-b-redesign-drills.json`.

<!-- plan-archive:end id="gates-3087b10dd-37758" -->

## CM1091CR2 round-3 qualification scope (2026-10-10)

<!-- plan-archive:begin id="gates-3087b10dd-36719" lines="36719-36736" at="3087b10dd" bytes="1290" sha256="3c6e244fb423b5408d09fcafd438591c199a98bf3b267d0662a4f74d6e950615" -->

**CM1091CR2 round-3 qualification scope (2026-10-10, Win11).** The rig
brief requires the `bdda4382f` core merge, completed as `501682b3b`, and
direct Windows owning-suite/static/build checks; aggregate quality remains
lead-owned. Core files are retained. A complete native-channel fixture's
first preparation faults because it probes before installing an accept
handler; the first repair exposes a wrong server-check call signature, and
the second exposes invalid hello ids. Stop that new fixture path under the
shared two-failed-fixes rule, remove it, and retain the attempt receipts.
The existing native transport harness independently proves unchanged v2
request/response bytes, and core management tests exercise the operations.
`test/unit/vault/channel.test.ts` requires its Unix peer fixture and is not
claimed as a Windows manage-only replay; full native channel composition
remains with the lead after the stopped fixture path.
Native Credential Manager qualification uses the existing interactive
desktop runner; the network-logon failure is retained, not skipped or fixed
by changing policy. The damaged-document quarantine/reset conflict in §3
remains an installed-binding blocker. No gate, timeout, assertion, native
hard-link refusal or production security port is weakened.

<!-- plan-archive:end id="gates-3087b10dd-36719" -->

## M109 lane 0 contract slice (2026-10-05)

<!-- plan-archive:begin id="gates-3087b10dd-37815" lines="37815-37832" at="3087b10dd" bytes="1258" sha256="61a4aac70054bf80ce1272172576489123eb50e32f69b10bfa6e5cbbf2ac5a4d" -->

**M109 lane 0 contract slice (2026-10-05, Kubuntu).** The item/material,
binding, policy, grant, requester, approval, ticket, audit, slot and broker
contracts, canonical use digest and test-only fakes are supplied by lane 0.
The isolated Models & Agents vault state and value-free host messages await
M95/M104/U binding on integration. Lane 0 does not implement OS slots,
policy enforcement, feeders or migration. Research corrections and the
V1–V16 runtime proof owners are recorded in
`docs/certification/m109-threat-model.md`; focused validation and deliberate
failures are in `docs/certification/m109-0.md`. Manifest registration, bundle
readers and the feature reference stay with their owning integration lanes.
Lane 0 records 91 focused tests and 144 byte-exact red drills, all fifteen
changed TypeScript files lint clean, and the typecheck, localization,
deadcode, duplication, cycles and production build checks pass. The host
API check is a named W deferral: its generated record needs node:crypto
imports 46 → 47 for useDigest.ts, with no new host API or built-in. W owns
that file; lane 0 leaves it untouched and records the regeneration command
in its certification. The full M109 checklist remains open until those
lanes and captures pass.

<!-- plan-archive:end id="gates-3087b10dd-37815" -->

## EXECPROV round 4 scoped qualification (2026-10-12)

<!-- plan-archive:begin id="gates-3087b10dd-36640" lines="36640-36657" at="3087b10dd" bytes="1222" sha256="8fe507f2cd61b0fa55040a5c9c044a88472950c3e7a4d5fc45881ef4f4b08af2" -->

**EXECPROV round 4 scoped qualification (2026-10-12, kubuntu).** The
explicit lane brief reserves aggregate `npm run quality` for the lead.
This lane merges `snap/hotfix-0181` (0.18.0 + 0.18.1) into
`fix/exec-provider`, keeps the D1-D6 fixes on the release (paid-stop and
stale-confirmation pass-throughs; policy output cap; cross-bundle refusal
classifier and provider assembly behind the lazy provider entry, proved
by the split gate), runs all five typechecks, the production build with
its budgets, the round-3 and hotfix owning suites at the repository
timeout, three byte-restored red drills (D1/D2/D3) and the l10n,
reference, roadmap and host-api checks. FINDING, not a deferral: the
Model API exact-byte pin (`deferredBundles`, 532,827 B) reads 533,327 B
(+500 B); every byte is attributed to pinned hot-path behavior
(transport paid/rotation branches and classifier read, client refusal
catch, host default-model hunk) in `docs/certification/exec-provider.md`.
The pin is not moved; the lead disposes (re-measure with owner decision,
as the hotfix did at +290 B, or direct further diet). Loopback suites are
sandbox-blocked here (direct probe: `fetch` to 127.0.0.1 throws), named
for the lead's unsandboxed run.

<!-- plan-archive:end id="gates-3087b10dd-36640" -->

## CM109LEASER2 qualification (2026-10-11)

<!-- plan-archive:begin id="gates-3087b10dd-36691" lines="36691-36706" at="3087b10dd" bytes="1163" sha256="4391b61e4560af14b1022fb4ed8e1258f99270b7214b3bf7d7c30df01e86e785" -->

**CM109LEASER2 qualification (2026-10-11, Win11).** The six in-scope
RVCM109LEASE findings are implemented. Shared-core ownership, atomic
publication, immutable notes, self-adoption and confirmed Reset/Restore are
covered by the owning suites and the complete non-hub dependent selection.
The rig/common brief delegates aggregate quality and cross-platform replay
to the lead. The two pre-existing duplication pairs in modelApiHost and
modelApiLoopGuarantees remain outside this lane; both files and the gate
configuration are unchanged from 18dbcb0e8. Production size still refuses the
existing usagePanel and surface-English overages. No limit is moved.
Credential Manager and foreign-user PowerShell startup refuse four native
cases here; no OS-policy change or workaround is attempted. The lead must
qualify those paths interactively and replay Linux/macOS. Git transaction
lock timed takeover remains explicitly lead-owned (review finding 6).
The requested lane timebox was exceeded. Receipts, exact failures, bytes
and byte-exact mutation restoration are in docs/certification/m109.md and
m109-lease-r2-verification.json; no complete aggregate-green claim.

<!-- plan-archive:end id="gates-3087b10dd-36691" -->

## CM1013B scoped rig verification (2026-10-11)

<!-- plan-archive:begin id="gates-3087b10dd-36600" lines="36600-36614" at="3087b10dd" bytes="1119" sha256="48a2f523af01bd5f44bca522af92db4c42d5f0d358f8c876e0e67464258cec70" -->

**CM1013B scoped rig verification (2026-10-11, kubuntu).** The task's named
shared rules explicitly prohibit aggregate quality and full-suite runs. The
lead owns those gates before integration. This lane runs every eval suite,
three owning type projects, changed-file lint/format, localization, reference,
roadmap and production build without weakening any gate or deadline.
The production build passes every size cap (extension 555.9/600 KiB,
Model API 517.1/525 KiB, checkpoint store 87.3/225 KiB), then fails five
split checks: `modelPolicy.ts` in activation and `priceCard.ts` in activation
and runtime (the latter pair is each reported twice). These are inherited
from the named merged base: all 95 production/ACP metafiles contain no eval
input and no source/build input changed by this lane. The brief explicitly
leaves the admission-helper injection to the release lead; do not change
those imports or weaken the split gate here. This justified scoped deferral
requires the lead to repair the production split before integration and
aggregate quality. Detailed receipts: `docs/certification/m101-eval-arms.md`.

<!-- plan-archive:end id="gates-3087b10dd-36600" -->

## FIXM112Q bounded-lane certification (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-38978" lines="38978-38985" at="3087b10dd" bytes="597" sha256="2f712a84afd0f61fa21f2fd7249e12dae99be4077904e86f01b6a683de3464eb" -->

**FIXM112Q bounded-lane certification (2026-10-06).** The rig/shared brief
forbids aggregate quality and full-suite runs; full integrated quality remains
with the lead. Run the complete owning test files, red drills, scoped lint and
format, compiler projects, plain knip, duplication, localization, host API and
production build directly on Kubuntu. The frozen Q base's U-owned
`uiState.ts:2452` reducer and A-owned generated host-API inventory are already
named integration handoffs in `docs/certification/m112-q.md`; do not weaken
either gate or claim them green. No review finding is deferred.

<!-- plan-archive:end id="gates-3087b10dd-38978" -->

## FIXM109B5 / RVM109B4 (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-37743" lines="37743-37756" at="3087b10dd" bytes="1076" sha256="b3d51eaeb8f3980ac3a38510052c2fedf5e036569022d597da62ba902069f441" -->

**FIXM109B5 / RVM109B4 (2026-10-06, Mac mini).** All five findings are fixed;
no review residual is accepted. The final restored source passes 313 tests in
all 18 vault files at the repository-default timeout, at most three files and
three workers per invocation. Exhaustive and seeded coverage is 518 + 1,600
schedules, 67,368 invariant steps, seed 109003. Seeded cases run 100 rounds
per scenario in separate tests after the combined case hit the five-second
limit; all rounds and invariants remain. Ten named red mutations restore
byte-exact and their source/test hashes match current files. All five typechecks,
changed-file ESLint/Prettier, plain Knip, zero-clone jscpd, localization, schema
drift and production build pass without changing any budget. `B-W-host-api`
remains the same six generated Node import totals; the existing W-owned patch
passes apply checking. Aggregate quality is prohibited in this lane by the
brief and remains lead-owned, as do joined native/editor checks and wiring.
Evidence: `docs/certification/m109-b.md` and `m109-b-round4-drills.json`.

<!-- plan-archive:end id="gates-3087b10dd-37743" -->

## CM109JOINB review scoped/native qualification (2026-10-11)

<!-- plan-archive:begin id="gates-3087b10dd-36675" lines="36675-36689" at="3087b10dd" bytes="1075" sha256="beda530620b9c1fe98eb8e118d90ee349b18c63ee3ab88bec883e3a5a0349f62" -->

**CM109JOINB review scoped/native qualification (2026-10-11, Kubuntu).** The
rig brief delegates aggregate quality and hub integration to the lead. All five
type projects and scoped lint/format, plain knip, zero duplication, l10n,
reference, host API, plan, roadmap and production budgets pass unchanged.
Round 2's installed warning deferral is resolved by RVCM109JC qualification:
the exact finished-native-helper registration race is named only after its
process group is proven gone; live/unclassified sampling failures still fail
acceptance. Both native receipts and retirement checks exit 0. The shared
epoch writer's legitimate cross-session contention is serialized by the
POSIX kernel lock, with guardian-loss and contention regressions. Full
launch measurements are observations under two CPU workers, not a total
launch guarantee. No production resource accounting guard is changed.
Availability stays off. The 17 writer
crash cases remain skipped for CM109LEASE/join; the store/shared lock helpers
are unchanged. No hook, assertion, budget or timeout is weakened.

<!-- plan-archive:end id="gates-3087b10dd-36675" -->

## M113-K bounded review gates (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-38994" lines="38994-39001" at="3087b10dd" bytes="554" sha256="701b78436bce73080f67391de32cab404a0240756ce46e075a6de3375ecd192c" -->

**M113-K bounded review gates (2026-10-06).** The rig brief and shared lane
rules require scoped tests/static/build checks and prohibit full quality in
this lane; W/lead owns the integrated `npm run quality` gate. Existing lane
0 handoffs remain: seven unused report manifest localization keys and the
node:crypto host-API inventory count (46 → 47). Neither gate is weakened or
rewritten by K. Review regressions and deliberate-break receipts are in
`docs/certification/m113-k-kinds.md`; these local commits do not certify a
shipped reporting surface.

<!-- plan-archive:end id="gates-3087b10dd-38994" -->

## LEFT017 bounded deferrals (2026-10-08)

<!-- plan-archive:begin id="gates-3087b10dd-37530" lines="37530-37543" at="3087b10dd" bytes="1047" sha256="74cd45f5eca387f755404072844a9013609d81180b0bb0fdd3b459113d9fbbf6" -->

**LEFT017 bounded deferrals (2026-10-08).** Keep every visual assertion and
budget. The combined tree has 270 webview source files and 184 render inputs,
but the current audit records 112 sources and 73 render inputs: 111 render
inputs lack scene/selector mappings. There is no audit-refresh generator in
the tracked repository; the capture helpers require an already reviewed map.
Actual new scene coverage, six-theme captures and review exceed the shared
approximately 300-new-lines-per-finding rule. The historical fixture lookup
is repaired independently, preserving the full M114 manifest and golden PNGs.
The curated README captures are separately reviewed and recorded. Final source
receipts also expose 48 stale hashes, 159 unrecorded source files and eight
missing registered variables in each third-party theme. The unchanged build
caps and unlisted deferred slashCommands split entry remain owned by the
shrinking/inventory lane. Exact gate failures are recorded in
`docs/certification/int0170-combined.md`; no deferred gate is waived.

<!-- plan-archive:end id="gates-3087b10dd-37530" -->

## FIXM109L0 review repair (2026-10-05)

<!-- plan-archive:begin id="gates-3087b10dd-37800" lines="37800-37813" at="3087b10dd" bytes="1047" sha256="d282dc903029e15d1f08b25e44fe284a17eae185a98d6d30326d6bc36f8432b0" -->

**FIXM109L0 review repair (2026-10-05, Mac mini).** RVM109L0's two P2
contract findings and its P3 fake ownership finding are fixed. A distinct
HTTPS issuer identifier schema allows paths and preserves exact spelling,
without query, fragment or credentials. The broker port and wire share
approval/ticket/denial results, with ticket handoff and audit authority; fake
approvals own their snapshots before an asynchronous boundary. Committed
issuer/authorization JSON Schemas and the wave-1 handoff accompany 100 focused
tests and 21 failed, byte-exact red drills (including two compiler drills).
Typecheck, changed-file lint/format, localization, deadcode, duplication,
cycles, exec schema and production build checks pass. The host API failure
is unchanged: node:crypto imports 46 → 47, still W-owned as below. No review
finding is left as a residual; no runtime, dependency or gate is changed.
Receipts: `docs/certification/m109-l0.md`. The rig brief prohibits aggregate
quality and merges; focused gates run directly and hooks remain enabled.

<!-- plan-archive:end id="gates-3087b10dd-37800" -->

## C-M109-1c scoped qualification (2026-10-10)

<!-- plan-archive:begin id="gates-3087b10dd-36738" lines="36738-36751" at="3087b10dd" bytes="968" sha256="b78c6e351ce9b441cdc070efffe9b90cf0a420edacd9cf85c2df0874ed5bcf28" -->

**C-M109-1c scoped qualification (2026-10-10).** The lane/common brief
reserves aggregate `npm run quality` and release qualification for the lead.
Run complete owning files directly on Win11 at repository deadlines,
changed-file lint/format, all five typechecks, localization, reference,
roadmap, host API, dead code, duplication and the capped production build.
Retain the logon-session failures and unstable timing receipt (§3) explicitly,
without a skip, deadline change, fake substitution or security-policy edit.
The new Windows paths cannot be activated until those receipts, the timing
budget and the
binding lane's private-file/launcher composition pass.
CM1091CR2 qualifies generated OS-store keys and both identity directions in
the existing interactive desktop session. It records the array validation,
ownership/erasure, retired-frame admission and native-probe guard drills,
with byte-exact restoration, without changing deadlines or the five-ms bound.

<!-- plan-archive:end id="gates-3087b10dd-36738" -->

## M123P9 inherited gate failures (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37509" lines="37509-37520" at="3087b10dd" bytes="876" sha256="63841d812f65136610b5097b82f190b61a5d28e21ccae61dbc0ec62c122c6a78" -->

**M123P9 inherited gate failures (2026-10-09, win11).** The scoped repair
passes its eleven native lane P suites, one unit/source typecheck, changed-file
lint/format, localization, plan, roadmap, reference, host API and plain knip.
The unchanged zero-clone gate exits 1 on 44 clones at both `5fed6f040` and
the repaired sources; every current matched span is equal to or a shorter
part of a base clone (547 duplicated lines now, 569 before). The production
build exits 1 only on `dist/resourceGovernor.js`: 135,386 bytes against
128,000, byte-identical to the base. Baseline overlays are restored
byte-exact and re-hashed; a restored production build confirms the same
failure. No threshold, ignore or cap changes. The inherited clones, governor
size repair and aggregate quality remain with the lead under the shared
lane rules; receipts are in `docs/certification/m123.md`.

<!-- plan-archive:end id="gates-3087b10dd-37509" -->

## FLAKETH20 scoped gate delegation (2026-10-07)

<!-- plan-archive:begin id="gates-3087b10dd-38959" lines="38959-38970" at="3087b10dd" bytes="870" sha256="e4abdf28900fe19ca92bbba961dab4e6bb0612b7b0e97c58199d0228904e0c43" -->

**FLAKETH20 scoped gate delegation (2026-10-07, win11).** The shared lane
rules forbid aggregate `npm run quality` and leave full-suite coverage and
hosted/platform quality with the lead. This lane ran all five typechecks,
changed-file lint/format, plain Knip, duplication, localization, host API,
reference, production build and 40 focused accessibility pages, all exit 0.
Final unchanged-deadline CI-style coverage passed 100 consecutive case-20
repetitions and 30 separate complete-file invocations (690 executions), plus
58 owning-suite tests. The cold-import startup failure and byte-exact red
drills are recorded in docs/certification/flake-team-harness-20.md. Linux was
unavailable because SSH refused its host key and WSL is not installed. No
gate was weakened or case deadline changed; no retries, skips, dependencies
or product source changes were introduced.

<!-- plan-archive:end id="gates-3087b10dd-38959" -->

## M71m CLI accessibility runner deferral (2026-10-02)

<!-- plan-archive:begin id="gates-3087b10dd-38946" lines="38946-38957" at="3087b10dd" bytes="843" sha256="9e87108bf70bf5e981c094d7e32a99dadec403533465f724448f8794849ef234" -->

**M71m CLI accessibility runner deferral (2026-10-02).** Required bounded
merge checks pass. The unchanged CLI accessibility script produced no axe
measurements for its 20 owning pages; a process-local background-timer
retry also produced none for the four held-PR themes. A blank browser
control and HTTP assets succeed. Real-time Playwright measured the same
20 harness pages with the same axe rules and incomplete-result exceptions:
zero violations, undecided failures or page errors (44 unseen contrast
elements counted). This evidence does not close the CLI runner failure.
The lead must resolve that runner before full quality certification; no
gate, threshold, timeout, hook or skip is changed. The existing Windows
8.3 fixture also needs a genuine short-name TEMP for its native proof.
See `docs/certification/m71.md`, M71m main join.

<!-- plan-archive:end id="gates-3087b10dd-38946" -->

## FIXM109B2 / RVM109B2 (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-37777" lines="37777-37787" at="3087b10dd" bytes="842" sha256="5186a15e1105647eed5ed0634a499e6d94fd472d06760ce7e8c2691e31306f9b" -->

**FIXM109B2 / RVM109B2 (2026-10-06, Mac mini).** All four findings are
fixed with fake-only regressions and byte-exact red drills. Direct default-timeout
vault suites pass 259 tests; all five typechecks, changed-file static checks,
schema drift and production build pass. Seventeen red drills and the reviewed
source baseline restore byte-exact; all 279 awaits have recorded boundaries. Aggregate
`npm run quality` is prohibited by the rig/shared brief and remains lead-owned;
no threshold, timeout or ignore is weakened. The existing six Node-total
`B-W-host-api` differences and its W-owned applicable patch remain the sole
inventory deferral. Evidence: `docs/certification/m109-b.md` and its round-2
receipts/await inventory. The grant writer's commit callback and value-free
audit failure notification are named C/W integration bindings.

<!-- plan-archive:end id="gates-3087b10dd-37777" -->

## M124 round 7 lane verification (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-38508" lines="38508-38519" at="3087b10dd" bytes="839" sha256="bbb47a34ef88e49b0060bb274877799db09f853d7985582a930b30c7a2d7de57" -->

**M124 round 7 lane verification (2026-10-09, Windows 11).** Native connector
tests (105) and companion tests (67) pass at repository deadlines; three
deliberate lifecycle failures restore byte-exact. The production build passes
with `connector.js` 102,260/102,400 bytes (140 free) and byte-identical
activation. One new test-setup clone was removed; the complete duplication
gate still reports only round 6's two existing clones, in files unchanged
from `2786f64ec`. Their repair and aggregate quality stay with integration;
no threshold changes. Scoped lint/format, the unit-project typecheck,
localization, reference, host API, plan, regenerated roadmap and plain knip
are the lane checks. Storage ownership/Windows DACL and the other existing
qualification deferrals remain open. Receipts: `docs/certification/m124-local.md`,
round 7.

<!-- plan-archive:end id="gates-3087b10dd-38508" -->

## FIXM112A (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-37554" lines="37554-37564" at="3087b10dd" bytes="833" sha256="440e8cbceecd06e24ae406c5c7999788402d34a3ec1b1f297525dadc8fcfcfd3" -->

**FIXM112A (2026-10-06, RVM112A).** Repair all six ACP findings in lane A:
Stop dispatches cancellation without waiting on question storage; late forms
wait for the registry's open transition; a failed deferral explicitly cancels
the waiting backend question; refused steers recheck session ownership before
queuing; idle answers acknowledge durable queuing until delivery; question
handling loads on first question/command. The last repair includes its own
build, split, package and graph-entry registration, keeping every existing
cap and guard. Each finding gets a failing regression and byte-restored red
drill in `docs/certification/m112-a.md`. The rig/shared rules delegate full
quality and Q/U integration to the lead; this lane runs its focused suites
and required static/build checks without merging, pushing or paid calls.

<!-- plan-archive:end id="gates-3087b10dd-37554" -->

## CM971R5 gate receipt (2026-10-11)

<!-- plan-archive:begin id="gates-3087b10dd-36579" lines="36579-36589" at="3087b10dd" bytes="825" sha256="cc7d1a991fb205eb8fead0be9b6bb98450fd6133a8df7f964c2a9effb29d3991" -->

**CM971R5 gate receipt (2026-10-11).** The lead's closed holder forms
and the reviewed `lz-string` receipt resolve the earlier eight-vendor blocker.
The 312-word review vocabulary moves unchanged to hash-pinned
`legal-data/slot-words.txt`, verified at build and load; missing or changed
vocabulary disables exact matching. This makes room for the receipt reader:
`legalScan.js` fits the unchanged 150-KiB cap (final measured sizes are in
`docs/certification/m97.md`). All 54 complete owning/allied files pass
11,437 tests at repository timeouts, including 10,240 restriction controls.
The production build passes; 87 bundles / 1,910 files verify and the repository scan reports
zero incomplete checks, blockers or should-fix findings (exit 0). Full aggregate
quality remains reserved for the lead by the explicit lane rules.

<!-- plan-archive:end id="gates-3087b10dd-36579" -->

## MENUFAN scoped verification (2026-10-10)

<!-- plan-archive:begin id="gates-3087b10dd-37163" lines="37163-37173" at="3087b10dd" bytes="819" sha256="090603f6e7bf35e0b19e7a7ded510e9e86148d8f20a0a2c8566a3caf1998bf7f" -->

**MENUFAN scoped verification (2026-10-10, Kubuntu).** Run the brief's
focused UI and visual suites at repository timeouts, scoped static gates,
production budgets and the reviewed full visual matrix. The shared rig brief
prohibits aggregate `quality`; the lead retains full qualification. An extra
`node test/e2e/webviewDiet.mjs` smoke remains open: its global loading-count
assertion raced two deferred renderers after GoalPanel appeared. Reusing the
harness readiness wait passed that point, then its unchanged legacy schedules
scene timed out waiting for `.local-schedules` at 5 s. The exploratory wait
was reverted; only the smoke's English opener labels change in this lane.
No timeout, assertion, scenario, hook or gate is weakened. Evidence:
`docs/certification/menufan.md` and `temp/menufan/webview-diet.log`.

<!-- plan-archive:end id="gates-3087b10dd-37163" -->

## M95R4 continuation (2026-10-05)

<!-- plan-archive:begin id="gates-3087b10dd-38359" lines="38359-38369" at="3087b10dd" bytes="814" sha256="ddf623ba97bce27e52a10681a2b3b9e711ea5bad739b012ac6055001be9cf861" -->

**M95R4 continuation (2026-10-05).** The requested two diet merges and
shared configured-provider completion repair the round-three cap and Copilot
failures. PSScriptAnalyzer 1.25.0 is installed for the current user and its gate
reports zero findings. Production size/split/host-global/notices gates pass
without changing an existing cap. The complete accessibility scan and single
three-worker aggregate quality run are recorded in `docs/certification/m95-r4.md`.
The common help-reference gate is unavailable in this checkout: its catalogue,
generator and package script are absent; integrating that system is a lead
prerequisite. General provider credential CLI/headless and OpenRouter
connect/usage are still explicit open acceptance work. No live/support closure
is inferred from the offline transport tests.

<!-- plan-archive:end id="gates-3087b10dd-38359" -->

## M109 P Windows bounded-lane gates and capture deferral (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-39034" lines="39034-39044" at="3087b10dd" bytes="812" sha256="6bca7eae013a1d8a7d805f0ef37ff7acc418a238dd29a06d03575ed8a558680b" -->

**M109 P Windows bounded-lane gates and capture deferral (2026-10-06).**
The Windows rig brief and shared lane rules prohibit full quality and the
full test suite here. Hook-on commits use the three owned test files,
guard-fire receipts, scoped lint/format and typecheck; final certification
also runs dead-code, duplication, localization, host API and production build.
The lead owns full integrated quality and coverage. This VM has no TPM or
Hello; current-user DPAPI later refused even outside the helper in its NTLM
logon context. Real PCP/Hello prompts, stable DPAPI isolation/network-logon
captures and a screen-lock event need the named Windows-capable integration
rigs. No threshold, rule, scope or OS protection setting is weakened.
See `docs/certification/m109-pw.md` and Q-M109-Windows-DPAPI in §3.

<!-- plan-archive:end id="gates-3087b10dd-39034" -->

## Estimator panel bundle budget (closed 2026-10-17)

<!-- plan-archive:begin id="gates-3087b10dd-36659" lines="36659-36673" at="3087b10dd" bytes="1125" sha256="e039c73b5887dd78c2f1d908307baf44bdc51fb39d07b126f1d4b59577e0a43d" -->

**Estimator panel bundle budget (closed 2026-10-17, corrected).** The earlier
version of this item wrongly called the 25 KiB row owner-set; it is M117's
split rule (measured size plus 15%, rounded), not an owner-set cap, and the
row is re-baselined by that same rule, not by owner word. `npm run build` on
`fix/catch-money-final` reported `OVER dist/webview estimator panel: 25.8 KiB
(budget 25 KiB)`: the lazy closure measures 26,410 bytes, against 25,479 on
`main-now`. The D207 worded-refusal matcher (`isEstimateRefusal` /
`estimateRefusalDetail` plus the panel's and composer's catch sites) adds the
~931 bytes; the matcher must run synchronously in those catch handlers (lead
decision 2026-10-16: money/consent failures reach the person in words), and
any module it lives in lands in the same lazy closure (verified minified in
`dist/webview/chunks/RN4TH3UY.js`), so no behaviour-preserving move recovers
the 810 bytes. Re-baselined by the documented rule: 26,410 x 1.15 =
30,371.5 bytes = 29.66 KiB, so 30 KiB (`scripts/lib/webviewBundles.mjs`).
Disposition: closed; `npm run build` is green on the re-baselined tree.

<!-- plan-archive:end id="gates-3087b10dd-36659" -->

## Resolved in integration (lane W, 2026-10-04)

<!-- plan-archive:begin id="gates-3087b10dd-38838" lines="38838-38838" at="3087b10dd" bytes="197" sha256="9320d1ad7dd037addffc9b60af327fb8d5a534d4ea06534a384512111e768b0a" -->

**Resolved in integration (lane W, 2026-10-04, accepted by the lead).** The import bundle's cap is 175 KiB under the D6 rule (147.7 KiB measured, plus 15%, rounded up to 25 KiB); see the D6 table.

<!-- plan-archive:end id="gates-3087b10dd-38838" -->

## FIXM109B6 / RVM109B5 (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-37730" lines="37730-37741" at="3087b10dd" bytes="879" sha256="3fdef5c8a7800d741ef3bdbe6d589ef00b765dfa2656884b39460c3bf457595d" -->

**FIXM109B6 / RVM109B5 (2026-10-06, Mac mini).** Both findings are fixed;
no review residual is accepted. Final restored-source verification passes all
335 tests in all 19 vault files with default timeouts, at most three files and
three workers per invocation. Twenty-five named red drills restore byte-exact;
current production/test hashes match their receipts. All five typechecks,
changed-file ESLint/Prettier, plain Knip, zero-clone jscpd, localization, schema
drift and production build pass without changing budgets or gates. The existing
six Node totals remain the named `B-W-host-api` integration deferral, and the
existing patch still applies cleanly. Aggregate quality, Windows/editor checks,
C/P/T/route/W binding, broker bundling and integrated latency remain lead-owned
under the lane brief. Evidence: `docs/certification/m109-b.md` and
`m109-b-round5-drills.json`.

<!-- plan-archive:end id="gates-3087b10dd-37730" -->

## FIXM109B review repair (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-37789" lines="37789-37793" at="3087b10dd" bytes="370" sha256="4fb4b190b089ec079b33286f00d5a8e7a1909ff2fe269b6d8fa60910e52b228c" -->

**FIXM109B review repair (2026-10-06, Mac mini).** RVM109B's five P1 and
four P2 findings have regression tests and failing/restored red drills; no
finding is deferred. B's targeted gates run directly with hooks enabled and
no gate weakened. Aggregate quality remains prohibited in this lane and
required at W/lead integration. The host API record is the existing named

<!-- plan-archive:end id="gates-3087b10dd-37789" -->

## M124 round 6 lane verification (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-38521" lines="38521-38530" at="3087b10dd" bytes="692" sha256="a5ef55dd342fd401376c373edd11719a3dd8610dce45b016a1db6ec558800764" -->

**M124 round 6 lane verification (2026-10-09, Windows 11).** The rig/common
brief reserves aggregate `npm run quality` for the lead and requires native
connector suites, scoped lint/format, one typecheck and unchanged bundle caps.
The full duplication check still exits 1 for the two previously recorded
clones (`connectorStdio.e2e`/`schedulesStdio.e2e` and `windowsTrustedPath`);
all three files are unchanged from `76b4bf180`, and this fix adds no clone.
Their repair remains with integration, without changing the zero threshold.
Storage ownership/Windows DACL, real-client and shared approval UI
qualification remain open as before. Receipts:
`docs/certification/m124-local.md`, round 6.

<!-- plan-archive:end id="gates-3087b10dd-38521" -->

## FIXM105E3 gate scope (second copy, 2026-10-07)

<!-- plan-archive:begin id="gates-3087b10dd-37629" lines="37629-37635" at="3087b10dd" bytes="474" sha256="fddea451c1a6fa5c073e38961cc84a4c0ce656d2c8546d0137038b7211ed5105" -->

**FIXM105E3 gate scope (Kubuntu, 2026-10-07).** The rig brief/common rules
forbid aggregate quality and full unit commands; run owning files in batches of
at most three, followed by the five typecheck projects, lint, changed-file
formatting, plain knip, duplication, unchanged-cap production build, reference
and localization. Run final verification from a fresh clone of the committed
repair with npm ci and CI=true. Hooks remain active; no external network except
npm ci.

<!-- plan-archive:end id="gates-3087b10dd-37629" -->

## FIXM95G build deferral (2026-10-05)

<!-- plan-archive:begin id="gates-3087b10dd-38028" lines="38028-38040" at="3087b10dd" bytes="954" sha256="3f8ae5a4719723aa40554e4ee0e5b02555fcc4d91e69a59bd80eb0d51e27bd47" -->

**FIXM95G build deferral (2026-10-05).** The correction lane fixes all six
assigned Gemini review findings and runs the required focused gates on
Kubuntu. `npm run build` generates all production bundles within their
unchanged caps, then exits 1 at the existing bundle-split gate because
`src/core/backends/modelapi/codecs/gemini.ts` is on neither classification
list in `scripts/check-bundle-split.mjs`. This unwired codec and missing
registration predate the fixes. Gate-script/provider integration ownership
is outside lane G; the brief prohibits widening this lane's files or any
guard. No ignore or rule is changed. Follow-up: the lead's integration lane
classifies/wires the provider codec under D74's lazy-bundle contract, reruns
the build and combined full quality, and records certification before
release. `docs/certification/m95-g.md` records the failed build and the
separately run later build checks; no successful full-build claim is made.

<!-- plan-archive:end id="gates-3087b10dd-38028" -->

## CATCHMONEY round 3 qualification (2026-10-12; review 2026-10-14)

<!-- plan-archive:begin id="gates-3087b10dd-39198" lines="39198-39205" at="3087b10dd" bytes="589" sha256="3fc8e00ae32dcd2dc3fcbaaca300706b204826f0e67c8c2e264833b9ef8e3319" -->

**CATCHMONEY round 3 qualification (2026-10-12; review 2026-10-14).**
Scoped runs and receipts: `docs/certification/catch-money.md`; the lead runs
the aggregate suite before integration. Two deferrals stand. The stricter
catch classifier reclassifies 94 raw-error logs from REPORTED to GENERIC;
the baseline was regenerated after that intentional fix and the gate still
fails on any new rise. `dist/modelsPanel.js` is 128,289 bytes against its
128,000-byte budget on the merged tree (the required three-valued read);
no threshold is changed: the lead rebases the budget or directs a trim.

<!-- plan-archive:end id="gates-3087b10dd-39198" -->

## TOOLROUNDS duplication, resolved (2026-10-17, review merge)

<!-- plan-archive:begin id="gates-3087b10dd-39154" lines="39154-39154" at="3087b10dd" bytes="349" sha256="7740053aff9723cb02c93c69ccff8b510b57d56670f8a4181e2c74967a461aac" -->

**TOOLROUNDS duplication, resolved (2026-10-17, review merge).** The 42 jscpd pairs recorded in round 8 all sat in fake-harness suites; main's test overhaul (D108) deleted those suites and the review deleted the lane's three stranded ones. `npm run duplication` on the merged tree reports 0 clones, so the deferral this paragraph carried is closed.

<!-- plan-archive:end id="gates-3087b10dd-39154" -->

## M123G4C local receipt (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37486" lines="37486-37496" at="3087b10dd" bytes="793" sha256="2ff285bd9e36131e720bd4fcf1afea2d504564bbb9678dc4db6162c4866527cc" -->

**M123G4C local receipt (2026-10-09, Kubuntu).** Own-renewal dispatch is
fixed at LOCKLIB and the Git wrapper: 301 tests passed, 2 existing platform
skips, 19 byte-exact drills fire. One unit-project tsc (including all
source), changed-file lint, formatting, deadcode, localization, host API,
reference, plan, roadmap, split, globals and notices pass. Wider blockers
stay unchanged: jscpd has the same 44 clone pairs and code fragments as
`9c8ed7f70` (all five compared files restored byte-exact); the production
build stops only at resourceGovernor's 135,557 bytes, exactly the recorded
base size, over 125 KiB. No threshold or cap moved. Full quality is the
lead's gate under the rig brief; Windows control-pipe execution remains for
its rig. Receipt: `docs/certification/m123.md`, M123G4C.

<!-- plan-archive:end id="gates-3087b10dd-37486" -->

## M123G4 local receipt (2026-10-09)

<!-- plan-archive:begin id="gates-3087b10dd-37498" lines="37498-37507" at="3087b10dd" bytes="731" sha256="7b37677e083ca7cde522e75f5f34706199c19725212897c6561c31e577f934bc" -->

**M123G4 local receipt (2026-10-09, Kubuntu).** Required Git/LOCKLIB suites:
279 passed, 2 existing platform skips; three byte-exact guard drills fire.
Typecheck, changed-file lint, localization, host API, reference, plan and
roadmap pass. Two wider gates remain for the lead, unchanged in policy:
`jscpd` reports the exact same 44 clone pairs at base `79071a8ad` and here,
none new; the production build fails only `dist/resourceGovernor.js` at
132.38 KiB against 125 KiB (base 132.35 KiB, current +30 B). No threshold,
ignore, timeout or cap moved. The rig brief forbids running full quality
in a lane; the lead owns that gate. Receipt: `docs/certification/m123.md`,
M123G4; the Windows control pipe still needs the Windows rig.

<!-- plan-archive:end id="gates-3087b10dd-37498" -->

## FIXM109PM review repair (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-37659" lines="37659-37664" at="3087b10dd" bytes="463" sha256="5271bdbddf383bb893a73c59ec413e3d288a7036021bd4f5bee61d521db7d74e" -->

**FIXM109PM review repair (2026-10-06, Mac mini).** The rig brief and common
lane rules prohibit `npm run quality` and any merge/push/rebase. Focused tests,
local gate commands and native generated-material checks run directly here;
the lead retains aggregate quality, the integrated host API record and hosted
CI. This is a lane receipt, not a release certification; no gate is weakened.
See `docs/certification/m109-p.md` for results and byte-exact red drills.

<!-- plan-archive:end id="gates-3087b10dd-37659" -->

## M109 lane T (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-37665" lines="37665-37678" at="3087b10dd" bytes="1076" sha256="7deb0be07995acc2734a08aa68a139b70fbb71b59926266c64705d61fcb58711" -->

**M109 lane T (2026-10-06, Mac mini).** Targeted default-timeout tests and
byte-exact red drills certify the provenance engine and injected scrub
boundaries; the lead owns aggregate quality and joined-tree binding. The
host API gate reports inventory drift: `node:buffer` 39 → 40 from T, plus
the six B/base totals (`child_process` 13 → 14, `crypto` 46 → 53, `fs` 33 → 36,
`fs/promises` 47 → 49, `net` 7 → 10, `path` 84 → 89). The record is W-owned;
`T-W-host-api` defers its regeneration/review to the joined source without
weakening the gate. Performance initially measured 36.24 MB/s; two attempted
fixes measured 39.80 and 32.70, then the path stopped under the shared rule.
Later restored-source runs pass the unchanged 50 MB/s guard. Preserve that
variability for the integrated rig check; no floor, timeout or cap is raised
or lowered. B/host/X binding, absent M96/M102 owners and the unsafe opaque CLI
log writer remain named handoffs, not implemented substitutes. Final evidence:
`docs/certification/m109-t-taint-and-scrub.md` and `m109-t-drills.json`.

<!-- plan-archive:end id="gates-3087b10dd-37665" -->

## M109 O (2026-10-06, MacBook rig)

<!-- plan-archive:begin id="gates-3087b10dd-37679" lines="37679-37690" at="3087b10dd" bytes="928" sha256="bc325fdd0f731026203d70f9de255bcca79472debc327c8e2fdfe6539291f166" -->

**M109 O (2026-10-06, MacBook rig).** O's core and pool seams are certified
on generated fakes; 52 named red drills restore byte-exact. Typechecks,
changed-file lint/format, plain Knip, zero-clone jscpd, localization and the
production build pass without budget or gate changes. **O-W-host-api** is the
owned handoff: B's existing six Node-import count differences remain, with O
adding two `node:crypto` readers (53 to 55); the 332 VS Code APIs, 31 adapters,
25 Node built-ins and 61 theme variables are unchanged. W regenerates the
joined record; `docs/certification/m109-o-host-api.patch` projects this base's
complete count change. No W-owned record, README/CHANGELOG, bundle script,
manifest or help catalog was edited. The cert supplies documentation text and
O-X/O-C/O-BH/O-T/O-95b/O-96/O-U/H bindings. Full quality, browser/editor checks
and integrated M109 acceptance stay lead-owned; no live/paid calls or dependency.

<!-- plan-archive:end id="gates-3087b10dd-37679" -->

## M109 M (2026-10-06, MacBook)

<!-- plan-archive:begin id="gates-3087b10dd-37691" lines="37691-37699" at="3087b10dd" bytes="665" sha256="508ed930b62f69efd4468d1a70aef86381ab65171a497fad207fcac554de3269" -->

**M109 M (2026-10-06, MacBook).** The migration/import implementation uses
the brief's focused rig checks, default test timeouts and injected C/P/B/S/L
ports. `check:host-api` reports generated inventory drift from the lane-0/B
base plus M's built-in imports: VS Code API/files and theme counts are unchanged.
W owns `docs/ide-compatibility/host-api.md` and regenerates it on the joined
tree; M does not edit that lane's file or weaken the check. The aggregate
quality/browser/editor certification stays with W/the lead under the rig
brief. Tests, mutation receipts, exact gate results and named bindings are in
`docs/certification/m109-m-migration-and-import.md`.

<!-- plan-archive:end id="gates-3087b10dd-37691" -->

## M109 H gate handoffs (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-37700" lines="37700-37705" at="3087b10dd" bytes="426" sha256="3019566d397c602100f4bcd1b92f1f4cdb8c32bca2fd7c47bc3b442a67fa2216" -->

**M109 H gate handoffs (2026-10-06).** The rig brief assigns aggregate
quality to the lead. `check:host-api` reports inherited B plus H Node import
count drift; VS Code APIs (332), adapter files (31), Node built-ins (25) and
theme variables (61) are unchanged. W owns the generated record and must
regenerate/review it in the joined tree. No ignore, cap, rule or threshold
changed; no release/full-quality claim is made by H.

<!-- plan-archive:end id="gates-3087b10dd-37700" -->

## M109 U bounded-lane receipt (2026-10-06)

<!-- plan-archive:begin id="gates-3087b10dd-37716" lines="37716-37728" at="3087b10dd" bytes="962" sha256="216e89c4b704656fcf496703e167844d6c6eea7947e73b7f8b6cf69c45f41d9f" -->

**M109 U bounded-lane receipt (2026-10-06, Mac mini).** The rig brief
prohibits aggregate quality/full-suite runs and gives W the joined build,
manifest, help/docs and generated record registrations. U's owning
panel/native/controller tests, contracts and lazy graph/budgets pass at the
repository default timeout; typecheck, localization, duplication and the
existing production build pass. Forty-six guards were deliberately broken,
observed red and restored byte-exact; 160 accessibility scenes pass across
four themes and two widths. `npm run deadcode` exits 1 for the two genuine
standalone harness entrypoints that W must register; `check:host-api` exits 1
for the generated record that W must refresh. These are named integration
deferrals, not ignored files, rule changes or raised caps. Full quality,
installed-host matrix and real C/B/P/M/S plus M95/M104 binding remain with
the lead/owning lanes. See `docs/certification/m109-u-panel-and-vs-code.md`.

<!-- plan-archive:end id="gates-3087b10dd-37716" -->

## Bundle-split reporting backend (fixed MSM113FIX2, 2026-10-18)

<!-- plan-archive:begin id="gates-3087b10dd-36813" lines="36813-36828" at="3087b10dd" bytes="1209" sha256="3ddb5bdb0eb72537a4d519c26ed2561ca78f30d25711057020bd72e26effbcad" -->

**Bundle-split reporting backend (fixed MSM113FIX2, 2026-10-18).** `npm run build`
ended in `check-bundle-split.mjs` rc=1: `dist/reporting.js` and
`dist/reportingNetwork.js` carried `src/core/backends/musecode/launch.ts`
via `playbook/modules → host/processTree → launch` (two Windows environment
helpers shared by every launcher). Fix under D6, budgets unchanged: the four
helpers moved verbatim to `src/core/childEnvironment.ts`; every importer
(backend, host, runtime, core, voice) follows. The same build then exposed two
further latent failures behind the split gate, both fixed in this lane: the
vault runtime bundle was not emitted while the live agent loader
(`runtime/main.ts` → `runtimeVaultLoader`) requires it — the `vaultRuntimeEntry`
plus broker/migrate/keyring sources removed as "dead" in 0a12f5665 are
restored with their build and 25 KiB budget hunks (the entry is filename-loaded,
invisible to knip; the broker surface rides the REPORTJOIN knip deferral below
for pending lanes C-M109-1b/c) — and the ACP package did not carry the
agent-loaded `planSnapshot.js`/`vaultRuntime.js` (added to `ACP_BUNDLES`).
`npm run build` exits 0; the lazy registry is regenerated from the build.

<!-- plan-archive:end id="gates-3087b10dd-36813" -->

## CM1136R6 inherited duplication gate (2026-10-11)

<!-- plan-archive:begin id="gates-3087b10dd-37194" lines="37194-37201" at="3087b10dd" bytes="582" sha256="6f329e059a1d2d8a1a6733d44511a669c11417f444661129252e6dcf115461f7" -->

**CM1136R6 inherited duplication gate (2026-10-11, Kubuntu).** Full
`npx jscpd` also fails on the earlier M113 store-test setup: substituting
the pre-round isolation file reproduces 23 clones, then restoring it is
SHA-256 checked. This round removes its new repeated damaged-page setup;
the remaining inherited test clones are a bounded integration deferral,
recorded with the final count in `docs/certification/m113-stores-cm1136r3.md`.
The zero-clone threshold and all analyzed files stay unchanged. Aggregate
quality is not claimed green; the rig brief delegates it to the lead.

<!-- plan-archive:end id="gates-3087b10dd-37194" -->

## M95 K repair residuals (2026-10-05)

<!-- plan-archive:begin id="gates-5cf2e1004-35371" lines="35371-35375" at="5cf2e1004" bytes="334" sha256="0f8668e57c6d2f3dcd836343774ce831c9add5ab6680f924a2ec8e4b71d923f6" -->

- **K22 resolved:** final comparable activation is 608,089 bytes against
  605,188 at `ad916bbc`: growth 2,901, under 3,072. Two size-specific
  attempts had not closed the gap; fixing misplaced K15 recovery callbacks
  subsequently closed it. All total bundle caps also pass. Full composed
  certification still belongs to the lead.

<!-- plan-archive:end id="gates-5cf2e1004-35371" -->

<!-- plan-archive:begin id="gates-5cf2e1004-35377" lines="35377-35380" at="5cf2e1004" bytes="305" sha256="72fd1c92a33699a44b3018169c6e00bd6e7188d819a01f75c88233ed5a1c0184" -->

- **K-contract:** lane M supplies the shared Models schema; lane U supplies
  chat `setupComplete`. K tests use M's exact temporary source dependency,
  which is not committed. M must adopt strict `providers/edit` and scoped
  prefill variants. Follow-up: certify the final composed protocol/editor flow.

<!-- plan-archive:end id="gates-5cf2e1004-35377" -->

<!-- plan-archive:begin id="gates-5cf2e1004-35382" lines="35382-35387" at="5cf2e1004" bytes="473" sha256="5edb06db0ffcf644c176ff2ad17d5d0733c3cbc2ffe2a94b5b0cc8fd43e4226f" -->

- **K-recovery (superseded by PROVWIZ9, 2026-10-09):** provider Save validates
  before writing and retains completed provider/key/default/limit/model steps
  after a later failure, reporting every partial outcome. No rollback remains.
  The origin guard prevents an old key serving a newly saved origin. Same-host
  snapshot comparisons remain; cross-window provider/key serialization awaits
  PROVSTORE-LOCKLIB after M123. Shared-store crash atomicity remains follow-up.

<!-- plan-archive:end id="gates-5cf2e1004-35382" -->

<!-- plan-archive:begin id="gates-5cf2e1004-35389" lines="35389-35393" at="5cf2e1004" bytes="348" sha256="99bca1bf7218687706f2d2490d76548478e15b0b2d649155e36be8bb8552375d" -->

- **K-release-base merge:** local `origin/main` at `a95f24cf` conflicts in
  release/build files, every manifest translation, extension and constants.
  Merge was aborted; lead must reconcile the release base on integration.
  This preserves the lane and both sides' behavior rather than choosing a
  side wholesale. Full certification stays open.

<!-- plan-archive:end id="gates-5cf2e1004-35389" -->

<!-- plan-archive:begin id="gates-5cf2e1004-35395" lines="35395-35398" at="5cf2e1004" bytes="288" sha256="8c62f4f688ade7a094a5fc5db165bbfd69dc673d49a71fe9e9a8c05052705ae2" -->

- **K-hook verification:** ignored Husky wrapper was missing; an early
  commit proceeded despite lint errors. `npm run prepare` regenerated the
  local `sh -e` wrapper with the same configured hook path. No bypass was
  used. Require the closing commit's positive lint/Gitleaks receipt.

<!-- plan-archive:end id="gates-5cf2e1004-35395" -->

<!-- plan-archive:begin id="gates-5cf2e1004-35400" lines="35400-35403" at="5cf2e1004" bytes="282" sha256="69ff6cc6b25fc67e95fa87ba4106d97ac4e86480f1a621e90915438ff08a7ee0" -->

- **K-final-runtime:** live setup/OAuth/discovery, unsaved-draft scan
  cancellation, four themes, pseudo-locale and 320px remain integration gates.
  Focused host tests do not certify those surfaces. Final evidence and merge
  status are recorded in `docs/certification/m95-k.md`.

<!-- plan-archive:end id="gates-5cf2e1004-35400" -->

<!-- plan-archive:begin id="gates-5cf2e1004-35405" lines="35405-35413" at="5cf2e1004" bytes="628" sha256="ff8a21eea06297dc5f11dd16602b171c4813ce60b62bd29a6f5c56a50d2bc7f7" -->

- **M95MU-HOST-API-RECORD (2026-10-05, integration prerequisite).** The
  composed M/U tree's host API record still describes 30 commands rather
  than the 33 from lane 0 and names only the chat stylesheet. Its gate
  reports those two documentation differences; the 271 API names and 59
  theme variables are unchanged. This lane adds no VS Code API. Safe while
  unmerged: this is generated documentation, not a runtime policy change.
  Lane W / the lead must regenerate and review it on the fully integrated
  tree, where lane K also contributes APIs. The full quality gate remains
  required before integration is proposed.

<!-- plan-archive:end id="gates-5cf2e1004-35405" -->

<!-- plan-archive:begin id="gates-5cf2e1004-35415" lines="35415-35422" at="5cf2e1004" bytes="592" sha256="27af66fb09f9e2fb074ee4c87652f286968d26ff9b4e7ccf99a27c162a81a27e" -->

- **M95-H bundle registration (FIXM95H, 2026-10-05).** All seven RVM95RH
  codec/test findings are fixed; none is deferred. The independent Chat
  lane still lacks its entry in `scripts/check-bundle-split.mjs`, owned by
  lane W. Safe for this unintegrated branch because the codec is not yet
  imported by a shipped entrypoint, and the unchanged split gate refuses
  the build. Follow-up: lane W registers Chat, lane I supplies its caller's
  vision capability and tools-retaining compaction body, then the lead runs
  full integrated quality/live acceptance. No product-support claim here.

<!-- plan-archive:end id="gates-5cf2e1004-35415" -->

<!-- plan-archive:begin id="gates-5cf2e1004-35424" lines="35424-35443" at="5cf2e1004" bytes="1501" sha256="7372e2a8ae25d033710f42f76bb6c04cf58d245729fef87b07785bb8f9a1c6a7" -->

- **M95 Ollama review repair (FIXM95O, 2026-10-05).** Rebuild the native
  codec against nine counted local Ollama 0.35.1 receipts before changing
  its parser: native tool index/id matching, caller-supplied session-unique
  response identities, model-bound reasoning, bounded frames/arguments/items/
  total streams, terminal-line closure, five byte goldens and translated
  codec errors. No dependency, model pull, cloud call or paid call. Proof and
  any remaining acceptance limits live in `docs/certification/m95-o.md`.
  **O-INTEGRATION** remains an integration acceptance limit: the codec is
  currently imported only by its owned test, so these changes cannot affect
  existing Meta turns. Follow-up: lane T/I must inject a stable, session-unique
  response ID, wire the lazy codec bundle, and the lead must prove the complete
  provider turn/reload/resume flow and full quality on the final joined tree.
  No Ollama review finding is intentionally deferred.
  **O-SPLIT**: the existing split gate rejects the dormant codec as on neither
  membership list. Safe for current Meta turns because it is not imported;
  follow-up: lane W must enforce the planned separate codec bundle, without
  exemptions or weakened guards. **O-HOST-API**: the inherited M95 manifest
  has 34 commands while the generated host record has 31. Safe only as an
  unmerged scaffold; follow-up: lane W regenerates/reviews the record before
  milestone certification. Both are observed gate failures, not green gates.

<!-- plan-archive:end id="gates-5cf2e1004-35424" -->

<!-- plan-archive:begin id="gates-5cf2e1004-35445" lines="35445-35451" at="5cf2e1004" bytes="520" sha256="b870e23db11c3aa26b10e23334a957b587a988932500ef9abb17e2ee201cea49" -->

- **Open documentation residual RVM95SC-R-host-api-record (2026-10-05).**
  The required merges leave five generated Node-import counts stale. The
  source/API membership is unchanged by the owned fixes, and actual counts
  are retained in the failed gate receipt, so this does not weaken a runtime
  boundary. The host API gate remains red and aggregate certification stays
  open. Lane W/lead must regenerate, inspect and recheck the record; its path
  is outside FIXM95SC's file scope. Exact count deltas are in §7.

<!-- plan-archive:end id="gates-5cf2e1004-35445" -->

<!-- plan-archive:begin id="gates-5cf2e1004-35453" lines="35453-35461" at="5cf2e1004" bytes="639" sha256="05d70188d32d363b5911f8ded6c1773dbbcd39d72f67e2a94cbae353eb8f21ff" -->

- **Open integration item RVM95SC-R-shell-env (2026-10-05).** The extension's
  inherited shell environment still forwards the user's `HF_TOKEN`,
  `ANTHROPIC_AUTH_TOKEN` and `AWS_BEARER_TOKEN_BEDROCK`; hooks and ACP strip
  them. This predates M95-S's changes and is outside FIXM95SC's authorized
  redactor/test files. Stored keys are not injected by this lane, but that
  fact does not certify shell isolation. Lane I/X/W must decide intended
  inheritance versus stripping and test the shell boundary before broader
  provider security certification. This is an open gate, not newly accepted
  risk; see `docs/certification/m95-s.md`.

<!-- plan-archive:end id="gates-5cf2e1004-35453" -->

## CIFIXV hosted visual repair (2026-10-09)

<!-- plan-archive:begin id="gates-4e09cab6e-34544" lines="34544-34567" at="4e09cab6e" bytes="1646" sha256="3b0e04618dda8b1104c9fcd7a7fe7569c5c5de4cd2c5291d7ad9efed44eea5aa" -->

**CIFIXV hosted visual repair (2026-10-09, linuxlt).** Own only the three
visual failures at `f5e0760c3`: reconstruct schedules under the served source
root, review any intended pixel changes before regenerating goldens, and
refresh current-source classification hashes without changing coverage.
Keep all thresholds and repository deadlines. Full quality remains the lead's
gate under the shared lane rules; no merge, push or live/paid calls.

- [x] Prove historical schedule loading fails before the repair and passes after.
- [x] Resolve visual comparisons and identify the aggregate's actual failure.
- [x] Refresh source receipts and pass the owning audit suite.
- [x] Pass full visual, six-theme accessibility and default-timeout stability gates.
- [x] Record evidence and local hooks-on commits in `docs/certification/cifixv.md`.

Reviewed full baseline: `CIFIXV-integrated-accessibility-review-2026-10-09`,
9,792 images / 447,310,229 bytes; all 884 distinct changed images reviewed,
27 named scenes. Full pixel gate passed; six-theme scoped axe passed on
1,632 pages with zero violations, retaining all 315 incomplete findings.
All 43 owning tests passed at repository defaults; production build passed.
The artifact action's `digest-mismatch: error` is an input;
the aggregate requires successful schedule shards and complete receipts.
Bounded external gate deferral: full `jscpd` still reports the inherited
51-token clone in `test/unit/modelApiLoopGuarantees.test.ts:741` and `:890`.
That suite is another lane's scope; leave code and duplication limits intact
for the lead's integration gate. Receipt: `docs/certification/cifixv.md`.

<!-- plan-archive:end id="gates-4e09cab6e-34544" -->

## M121A rounds 3–4 gate ownership (2026-10-09)

<!-- plan-archive:begin id="gates-4e09cab6e-34524" lines="34524-34540" at="4e09cab6e" bytes="1287" sha256="66f4036ae37945ea9033f935e396eadba65e147b940bb4afeb6547cf873023e8" -->

**M121A rounds 3–4 gate ownership (2026-10-09, kubuntu).** The rig brief and
shared lane rules forbid aggregate quality in this worktree; the lead owns
that gate before integration. This lane runs the owning usage/money/schedule
files at repository timeouts, typecheck, changed-file lint/format, localization
and the remaining scoped static checks. Full production build retains the
inherited What's New content-budget refusal; measure current production
options/plugins in memory without editing the build or raising a cap. Byte
counts and exact failure receipts are in `docs/certification/m121.md`.
The unchanged zero-clone duplication gate also retains one six-line clone in
`test/unit/windowsTrustedPath.test.ts`; that file matches `1494fbf87` byte for
byte and is outside this lane's money scope. The touched migration test's
duplicate setup is consolidated without dropping assertions. The lead owns
the remaining Windows-test repair and the full artifact size/split replay:
the refused build removes stale browser chunks before stopping, so those
artifact checks cannot certify a complete current build. No gate is weakened.
Round 4 replays the owning usage/money files, one unit-project typecheck and
the scoped static checks and production measurements at the unchanged caps.

<!-- plan-archive:end id="gates-4e09cab6e-34524" -->

## Bounded-lane gate records closed 2026-10-04 through 2026-10-06

<!-- plan-archive:begin id="gates-c7bdd3e94-35468" lines="35468-35474" at="c7bdd3e94" bytes="473" sha256="c164529acbe5c847e4b494b48fb2a2876fcdd5f54b99113ec750d442e4c36c02" -->

**KNIPC bounded lane (2026-10-05).** The rig brief and shared rules prohibit
aggregate quality/full-unit runs and integration merges/pushes on this lane.
Full quality, coverage, accessibility and integration certification remain
the lead's gates. The namespace export/type checks extend Knip's existing
issue set without an ignore or lowered severity; value/type plants prove
both guards fire. Scoped macmini evidence is recorded in
`docs/certification/knip-constants.md`.

<!-- plan-archive:end id="gates-c7bdd3e94-35468" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35476" lines="35476-35483" at="c7bdd3e94" bytes="538" sha256="f66aa4306468120b55ee2c5198c47da245ebbb79adf3ff01b7410f3fd4c401ba" -->

**DEFLAKE4 lane (2026-10-05).** The named brief and common.md assign full
quality, coverage and hosted certification to the lead; this lane runs the
owning test file and scoped gates only. Full quality remains required before
integration. The feature-delivery ledger validator cannot validate this
existing section-based roadmap (`expected exactly one quality-ledger fence`);
retain its canonical format and record that structural check as deferred.
Current receipts and any remaining blockers belong in
`docs/certification/deflake4.md`.

<!-- plan-archive:end id="gates-c7bdd3e94-35476" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35485" lines="35485-35491" at="c7bdd3e94" bytes="499" sha256="19786d47d9cfde7dfac54e0a8c5d97b2d47580897614b4a52ee2f0fcf41fe1dc" -->

**STAR lane (2026-10-05).** The owner's lane brief requires scoped tests,
typecheck, lint, localization/manifest checks, bundle budgets and an actual
VSIX README inspection, with removal drills and hooks enabled. It expressly
assigns full `npm run quality` to the release lead after integration; this
lane does not run it or weaken any gate. The generic delivery validator's
ledger-format check remains deferred for this established plan format.
Current receipts: `docs/certification/star-line.md`.

<!-- plan-archive:end id="gates-c7bdd3e94-35485" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35495" lines="35495-35501" at="c7bdd3e94" bytes="501" sha256="37080f7e92a7f6dd005a717ed4859ffa55e448645235c0bae9f24d83283f0996" -->

**M100 planning lane (2026-10-04).** The rig brief restricts changes to
PLAN and `docs/certification/m100-research.md`, forbids full quality/unit
runs and main integration, and requires a local normal-hook commit. Scoped
checks and their actual outcomes are in that research record. Runtime tests,
gate-fire and four-device certification are future M100 delivery work; the
lead retains the unchanged full quality gate on the joined tree. No product
gate is waived or weakened by committing this plan.

<!-- plan-archive:end id="gates-c7bdd3e94-35495" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35503" lines="35503-35508" at="c7bdd3e94" bytes="526" sha256="371c2521ecca1cb8327b8021ba79979ae037e7b36431c5ddbe70d66f8e1182a7" -->

**M100 review correction (FIXM100, 2026-10-05).** The follow-up brief authorizes
the D80/acceptance/research correction, its Unreleased changelog entry and a
local merge of the already-fetched `origin/main`, keeping both sides and
renumbering nothing. Only changed-document formatting/Markdown checks and
normal commit hooks run here; full quality remains the lead's joined-tree
gate. The research record separates these receipts from runtime certification. 9. **Picker, first run and usage** (lane U). The first-run screen's

<!-- plan-archive:end id="gates-c7bdd3e94-35503" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35527" lines="35527-35532" at="c7bdd3e94" bytes="458" sha256="5c12f18a499ab35ab0193a00f6f8f7b3c2563413c8cf3e385750bef9ccd51bcb" -->

**M100 review correction (FIXM100, 2026-10-05).** The follow-up brief authorizes
the D80/acceptance/research correction, its Unreleased changelog entry and a
local merge of the already-fetched `origin/main`, keeping both sides and
renumbering nothing. Only changed-document formatting/Markdown checks and
normal commit hooks run here; full quality remains the lead's joined-tree
gate. The research record separates these receipts from runtime certification.

<!-- plan-archive:end id="gates-c7bdd3e94-35527" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35545" lines="35545-35554" at="c7bdd3e94" bytes="763" sha256="ef3335003f50aa983dbdc80904aa5a24dec84724785874708a47a57d1d85a9a4" -->

**FIXM94L0 scoped result (2026-10-04).** Macmini passes changed-file ESLint,
all five typecheck projects, Knip, jscpd (0 clones), localization (0 problems)
and the host-API record (0 problems). Production build emits all bundles
and passes the current size gate, but exits 1 at the exhaustive split gate:
`TAB_MODEL_TEXT` has no registered reader. This wiring is explicitly lane W's
ownership in M94, so it is deferred to W's `dist/tab.js` build/split wiring;
no check, cap or ignore was changed. The inherited Model API bundle is
426.5 KiB under main's existing 475 KiB gate, not compliant with common.md's
older 400 KiB figure. Full quality and the later build-chain checks remain
open. See `docs/certification/m94-0.md` for scoped tests and byte-exact drills.

<!-- plan-archive:end id="gates-c7bdd3e94-35545" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35556" lines="35556-35561" at="c7bdd3e94" bytes="425" sha256="fec57116a366f590cbd0712cf5e3c164dc829df5c2c5c06447c6ea2380c85555" -->

**MRG78 rig PowerShell analyzer unavailable.** The additional
`npm run lint:ps` check fails before analysis because this Win11 rig has
no PSScriptAnalyzer 1.25.0 module. JavaScript and CSS lint pass. Native
PowerShell files are unchanged by this merge; no global install, network
fetch, version downgrade or skip is permitted under the shared rig rules.
The lead retains the pinned PowerShell check on a provisioned machine.

<!-- plan-archive:end id="gates-c7bdd3e94-35556" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35565" lines="35565-35570" at="c7bdd3e94" bytes="431" sha256="bf88dbc6961d96318ba0181c75be5bda46920396e89ec5a05c8899da294876a6" -->

**MRG78 native identity integration.** Main's R1 lint gate rejects M71's
direct `dev`/`ino` reads in `gitExtension.ts`. Reuse the existing
`statIdentity`, `statIdentitySync`, `fileIdentityKey` and `sameFile` helpers
for physical owner capture and synchronous rechecks, preserving the
canonical cwd, both lexical/canonical checks and sticky ownership loss.
No suppression or gate change. Verify native Git owners and their callers.

<!-- plan-archive:end id="gates-c7bdd3e94-35565" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35572" lines="35572-35576" at="c7bdd3e94" bytes="357" sha256="ee23c11638e54401aa23f35437d52a54b9a66b633608d544664cc1819e472345" -->

**MRG78 panel compatibility.** The owning test sweep exposes an old
M71 review assertion missing main's `disposition: started` acknowledgement
field, and the four Git palette rows missing M87's required tips. Keep the
complete acknowledgement assertion and reuse each row's existing translated
detail as its tip; no new English or translated key is needed.

<!-- plan-archive:end id="gates-c7bdd3e94-35572" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35580" lines="35580-35586" at="c7bdd3e94" bytes="490" sha256="c0a7d61f26843f5179beee9de7e50698571acc620ebde2a500932d2ada494f74" -->

**M115-G bounded-lane gate delegation (2026-10-06).** The rig brief and
`common.md` prohibit aggregate quality/full-suite runs in this worktree.
G runs its owned suites, red drills, all five compiler projects, scoped
lint/format, cycles, dead-code, duplication, localization, host API and
production build here, with hooks enabled. W/lead retains full quality,
coverage, accessibility and installed-editor/live certification on the
integrated tree. No threshold, rule or ignore is changed.

<!-- plan-archive:end id="gates-c7bdd3e94-35580" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35590" lines="35590-35596" at="c7bdd3e94" bytes="516" sha256="9c5837fa6e99c30c4d016dd27b6a4710edd1d74ff21a9125cdb6fe19f8703b02" -->

**M114 lane 0 scoped gate delegation (2026-10-06).** The rig/shared brief
prohibits full quality/full unit runs and edits to another lane's owned files.
The token foundation is checked with its owning suites, deliberate failures,
all compiler projects, scoped lint/format, dead-code, duplication,
localization and the production build. Full integrated quality, coverage,
the polished-surface accessibility/visual matrix and editor bindings remain
with the lead and lanes A/C/D/N/S. No gate or threshold is weakened.

<!-- plan-archive:end id="gates-c7bdd3e94-35590" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35598" lines="35598-35607" at="c7bdd3e94" bytes="695" sha256="6fc84e1bf7fd04b0b53ae3aaf5591d76314aded5367b39c1907b7887871d2b37" -->

**M114 P1 forced-colors repair scoped gates (RVM114P12, 2026-10-06).**
The rig/shared brief forbids full quality/full unit runs and other lanes'
file edits. P1 runs the five compiler projects, owning regressions and red
drills, scoped lint/format, dead-code, duplication, localization and the
production build. `check:host-api` retains its one inherited mismatch:
the source inventory lists 50 roles, including contrastActiveBorder, while
omitting the imported extended-role sheet. Lane 0/S own both inventories
and the generated record; the lead owns aggregate quality and S owns reviewed
goldens/shared changelog. No threshold, guard or hook is weakened, and no
RVM114P12 finding is deferred.

<!-- plan-archive:end id="gates-c7bdd3e94-35598" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35609" lines="35609-35618" at="c7bdd3e94" bytes="745" sha256="1402636dc9f680f2c1b7fd56cd0a715733c48dd54fc31a2406e66d6d7c8465a5" -->

**M114 C scoped certification (2026-10-06).** The rig/shared lane brief
prohibits full quality/full unit runs and another lane's owned edits. C checks
its internal theme consumer with whole owning test files at default timeouts,
byte-exact red drills, compiler projects, scoped lint/format, localization,
dead-code, duplication and production build. M104's captured-wire adapter,
companion/native bootstrap and shipped lazy-asset registration are absent
from this base and are named integration handoffs in C's certification.
S/lead retain the host-API inventory, public docs, real editor captures and
the full integrated quality/visual/accessibility gates. No gate is weakened
and internal-port fakes do not certify unavailable native engines.

<!-- plan-archive:end id="gates-c7bdd3e94-35609" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35622" lines="35622-35629" at="c7bdd3e94" bytes="561" sha256="3a0ce053ba2fcc5678f841cc51162285e9e152cacbb1b23dfbb499699215dc03" -->

**M109 P Windows host-API snapshot deferral (2026-10-06).**
`npm run check:host-api` exited 1 only for this lane's Node import counts:
`node:child_process` 13 → 15, `node:crypto` 46 → 49,
`node:fs/promises` 47 → 48, `node:path` 84 → 86. All portable-module
checks passed; no VS Code API was added. M109's ownership table assigns
`docs/ide-compatibility/**` and the host-API record to W, so P leaves that
file untouched. W regenerates it with `npm run check:host-api -- --write`
on the integrated tree and runs the unmodified check before certification.

<!-- plan-archive:end id="gates-c7bdd3e94-35622" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35631" lines="35631-35631" at="c7bdd3e94" bytes="75" sha256="f2be6842a226c9f67f47d1e6cef4ce2a341b6c6bf6b3a85412fa5b18c40d53dd" -->

FIXM109PW's final check also has `node:crypto` **46 → 50** and `node:os`

<!-- plan-archive:end id="gates-c7bdd3e94-35631" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35633" lines="35633-35635" at="c7bdd3e94" bytes="224" sha256="84348e9fe03bd259ff3f09df24c0c201a429d23c1383eb8d2a4f22e82fef2494" -->

**9 → 10**, from the trusted build digest and protected temporary-directory
fallback. The other counts above are unchanged. W owns this same generated
snapshot handoff; the portable-module check and all build checks pass.

<!-- plan-archive:end id="gates-c7bdd3e94-35633" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35637" lines="35637-35643" at="c7bdd3e94" bytes="520" sha256="80ce83d305a01f4c4527f542043f36b0f30e3bd08d38813662038efa832670fa" -->

**FIXM98J bounded-lane gate delegation (2026-10-04).** The rig brief and
shared lane rules prohibit a full `npm run quality` or full test suite in
this worktree. Hook-on repair commits require the owning regression files,
red drills, scoped lint/format and typecheck here; the final lane receipt
also runs dead-code, duplication, localization, host API and production
build. The lead retains full quality, coverage, accessibility and installed
host certification on the integrated tree. No threshold or rule is changed.

<!-- plan-archive:end id="gates-c7bdd3e94-35637" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35645" lines="35645-35654" at="c7bdd3e94" bytes="700" sha256="7a152feef951857275d11c1d94b0a652120711a21e93c490648afb50d55026c5" -->

**FIXM98J host-API snapshot deferral.** `npm run check:host-api` ran and
exited 1: `docs/ide-compatibility/host-api.md` needs the generated record of
`paidHost.ts`'s shared-budget read (11 → 12 calls, adding that file to
`WorkspaceConfiguration.get`) and lane J's `node:crypto` import (32 → 33).
The rig brief limits edits to the findings' files plus tests/certification/
localization, so this generated document is left for the lead's integrated
refresh: run `npm run check:host-api -- --write`, review those three rows,
then rerun the check. API policy is unchanged; the snapshot gate is neither
weakened nor claimed green. This is a documentation gate deferral, not an
unfixed RVM98J finding.

<!-- plan-archive:end id="gates-c7bdd3e94-35645" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35751" lines="35751-35758" at="c7bdd3e94" bytes="615" sha256="6c22ef693ed4ac301a39f314b8b3e86b8b4868742031c1c0e95a0db69052320b" -->

**FIXM101C2 current check scope (2026-10-05, kubuntu).** The five inherited
test repairs from `3e04f6f5` are carried unchanged after their failures are
reproduced here. Their old C2 baseline deferral below is historical, superseded
by this repair lane's complete-file receipts in `docs/certification/m101-c2.md`.
The shared rig common rules expressly prohibit `npm run quality` and the full
test wrapper here; run the required scoped static/build gates and complete
owning suites, with the integrator responsible for full quality and the
platform matrix before release. No threshold, ignore or timeout is weakened.

<!-- plan-archive:end id="gates-c7bdd3e94-35751" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35760" lines="35760-35769" at="c7bdd3e94" bytes="696" sha256="51e4f5b1740b5a73a0470eca6ccf5858123560a45ce253c673a0f7b6310ba5bb" -->

**FIXM101P1 lane verification (2026-10-05).** The rig brief expressly
forbids the full `npm run quality` wrapper and full unit suite because the
rig is shared; the lead runs the combined four-machine quality gate.
This lane runs focused complete test files (at most three per invocation),
all project typechecks, changed-file lint/format, deadcode, duplication,
localization, host API and production build directly on Kubuntu. The final
receipts and twelve red drills are in `docs/certification/m101-p1.md`: 330
focused tests and all listed lane checks pass, including the unchanged
production bundle-split gate. This defers only the full-tree/full-platform
quality receipt; no gate is weakened.

<!-- plan-archive:end id="gates-c7bdd3e94-35760" -->

<!-- plan-archive:begin id="gates-c7bdd3e94-35771" lines="35771-35778" at="c7bdd3e94" bytes="565" sha256="3d5555e766c03d9f50b624d0be2734be136847a21cc4ec48155795ecca8a8286" -->

**FIXM101P2 aggregate gate deferral (2026-10-05).** The explicit lane brief
and its shared `codex/common.md` forbid the full `npm run quality` wrapper
on this shared rig. Run the required scoped suites (at most three files per
run), all five TypeScript projects, lint/format over the complete P2 range,
knip, duplication, localization, host API and production build here; record
actual receipts in `docs/certification/m101-p2.md`. The lead must run the
aggregate quality/coverage/platform matrix before integration/release. No
threshold, ignore or rule is changed.

<!-- plan-archive:end id="gates-c7bdd3e94-35771" -->

## M95 section-7 gate view (2026-10-04/05, superseded by the section-6 record)

<!-- plan-archive:begin id="gates-5d64f91ce-35309" lines="35309-35783" at="5d64f91ce" bytes="49768" sha256="cd5880e740a4f4bf5f5e2b15823af6df86771ceafb78721a181b3fcc1fb564c4" -->

**Status 2026-10-04: planned on `feature/m95-byo-providers` from main
`1e93c67c`; research in `docs/certification/m95-research.md`. Step 13's
wire captures were recorded 2026-10-04 for the twelve cloud presets the
owner gave keys for (`docs/certification/m95-captures.md`: 46 model-call
attempts, 44 billed, about $0.07). Completed lanes 0/P/G/A/R/K/M/U are integrated on
`m95/int` as of 2026-10-05; remaining lanes, final composition and
release acceptance are still pending.**

- **Goal.** A user adds any listed provider, or a compatible server of their
  own, in the Models & Agents panel in under a minute, and every harness
  feature then works on its models: tools and approvals, hooks, checkpoints, `then_run`,
  ObservationPack, compaction, budgets, usage, the paid-feature gates and
  the ACP and headless agent. Keys stay in the OS keychain, bound to the
  origin they were entered for.
- **Depends on.** M91's request and `setModel` regions of `ModelApiHost.ts`
  (its lane E) and M94's `client.ts` additions (its lane C): lanes I and T
  start on main after those merge, or take those regions by the lead's
  agreement. M95b builds on this milestone's seam. M96 (agent roles, planned
  in parallel) uses the `ProviderRegistry`, model references and
  per-reference price cards and tallies defined here.
- **Scope.**
  - The seam: `ProviderClient`, `AuthSource`, the shared transport, five
    codecs (`responses`, `chat`, `anthropic`, `gemini`, `ollama`), the
    registry, presets, model references, capabilities, price cards.
  - `providers.json`, the credential records and their origin binding, the
    endpoint policy and address classifier.
  - The vendored models.dev snapshot and its sync script.
  - The **Models & Agents** panel's framework (section registry, shared
    state, shared components) with its **Providers** and **Models**
    sections, the quick-pick fast path, the workspace suggestion, the
    composer picker's rows and Account & usage's rows per provider. M96
    adds the panel's **Roles** and **Agent map** sections.
  - **Start with your own model** on the first-run screen and in the
    getting-started walkthrough (D74). It opens the wizard at "Pick a
    provider". On finish it sets the composer's model and the default
    model, leaves first run and confirms. Cancel leaves nothing saved.
  - OpenRouter as a first-class provider (D74): account connection over
    OAuth PKCE with a shared loopback helper (M95b reuses it), privacy
    routing, its key's usage and limit, prices fetched with their time,
    caching and reasoning pass-through, attribution headers.
  - The ACP agent's `auth set --provider`, `providers` commands, model
    options and `exec --provider`.
  - Redaction and credential-variable additions; strings in all 14 tables;
    README, PRIVACY, SECURITY, CHANGELOG, AGENTS.md, `docs/acp.md`,
    `docs/ci.md`, this plan and `docs/certification/m95.md`.
- **Providers in the first release.** The panel lists a preset only once
  its own capture is recorded (AGENTS.md rule 13). The captured frames are
  in `docs/certification/m95-captures/<provider>/`:
  **STAR lane (2026-10-05).** The owner's lane brief requires scoped tests,
  typecheck, lint, localization/manifest checks, bundle budgets and an actual
  VSIX README inspection, with removal drills and hooks enabled. It expressly
  assigns full `npm run quality` to the release lead after integration; this
  lane does not run it or weaken any gate. The generic delivery validator's
  ledger-format check remains deferred for this established plan format.
  Current receipts: `docs/certification/star-line.md`.
  **FIXM95T scoped remediation (2026-10-05).** RVM95T findings 1, 2, 3, 4
  and 6 have focused regression tests and byte-exact restored red drills in
  `docs/certification/m95-t.md`. Finding 5 is the named residual in §9.
  Full quality is reserved for the lead by the lane's common.md. The inherited
  bundle inventory and host-API record failures remain W's integration gates;
  no threshold, timeout, ignore or rule is weakened to obtain a lane commit.

  The **Custom server** preset speaks any of the `chat`, `responses` and
  `anthropic` formats. M95b adds the subscription sign-ins and plan keys;
  M95c adds Bedrock, exposure to VS Code's chat, OpenAI's explicit
  breakpoints, providers' hosted search, more presets, custom headers and
  Tab on BYO providers.

- **Lanes and file ownership.** One integration branch
  (`feature/m95-byo-providers`). Lanes 0 and P first, with lane M's
  `src/shared/modelsPanel.ts` schemas (M96 builds on them); then T; then C,
  R, H, A, G, O, K, M, U, X and S in parallel; I after T and after M91
  merges; W last. Region-owned files follow M87's lane rules.

| Lane                             | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Strings                        | `src/shared/l10n/en.ts`, the 14 `l10n/ui.*.json`, `package.nls*.json` (commands, settings)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P Providers core                 | new `src/core/providers/**`: `providersFile.ts` (the zod schema of `providers.json`, read and atomic write), `presets.ts` (formats, origins, auth headers, key pages and shapes, key tests, quirks as data, OpenRouter's routing and attribution), `modelRef.ts`, `capabilities.ts`, `priceCard.ts`, `endpointPolicy.ts` (URL rules and the address classifier over M69's ranges), `credentialRecord.ts`, `pkce.ts` (verifier, challenge, state), `wizardFlow.ts` (adding a provider as a pure state machine the panel and the quick pick both drive), `suggest.ts` (the local suggestion engine, each value with its reason), `scanDiff.ts` (a scan against the last one), `modelFilters.ts` (search, filters, sorting and badges as pure functions); tests `providers*.test.ts`                                                                                                                                                                                                                                                                                                               |
| C Catalogue                      | `scripts/sync-provider-catalog.mjs`, `vendor/models-dev/**` (the filtered snapshot and `VENDOR.json`), the copy to `dist/providerCatalog.json` in the build, `.vscodeignore`, `scripts/third-party-notices.mjs` and `THIRD_PARTY_NOTICES.txt`; tests `providerCatalog.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| T Transport                      | `src/core/backends/modelapi/client.ts` (its request loop out to `transport.ts`), new `providerClient.ts` and `authSource.ts`, `sse.ts`, new `ndjson.ts`; the Meta golden fixtures and tests; `redirect: 'error'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| R Responses codec                | new `modelapi/codecs/responses.ts` (OpenAI, Azure, xAI); tests and goldens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| H Chat codec                     | new `modelapi/codecs/chat.ts` (the family's quirks read from the presets; OpenRouter's breakpoints, `reasoning_details` and routing object); tests and goldens per preset                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A Anthropic codec                | new `modelapi/codecs/anthropic.ts` (breakpoints, thinking replay and the edit rule); tests and goldens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| G Gemini codec                   | new `modelapi/codecs/gemini.ts` (thought signatures, the schema subset); tests and goldens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| O Ollama codec                   | new `modelapi/codecs/ollama.ts` (NDJSON, `num_ctx`, `think`); tests and goldens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| I Integration                    | `ModelApiHost.ts` (client resolution at its nine call sites and the reviewer's, tool and hosted-tool gating, window, output cap, effort tiers, price lookup, compaction's tools, the identity line, hook fields), `reviewerEntry.ts`, `modelCallHooks.ts`, `instructions.ts`, `sessionStore.ts` (each replay entry's provider), `sessionBudget.ts`, `src/core/usage/insights.ts`, `src/shared/paid.ts`, `src/shared/effort.ts`, `src/core/import/agentImport.ts`, `src/core/backendSelection.ts`, `modelApiBackendManager.ts`, `modelApiEntry.ts`, `modelApiBundle.ts`, new `src/host/backend/providersEntry.ts` (→ `dist/providers.js`)                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| K Keys and panel host            | new `src/host/providers/**` (SecretStorage records, the password box with the preset's live shape check, the local-server probe, `oauthLoopback.ts` (a one-shot `127.0.0.1` callback server), OpenRouter's connect and key usage, the model scans' cache and diff, removal with undo, import and export, the workspace suggestion), new `src/host/models/modelsPanel.ts` (the `WebviewPanel`, its CSP, its zod-validated bridge) and the quick-pick fast path; entry → `dist/modelsPanel.js`; `src/host/auth/credentialStore.ts`, `src/host/auth/authService.ts` (a provider counts as a Model API credential), the command region of `src/extension.ts` (with `museSpark.startWithOwnModel`: the wizard opened at "Pick a provider"; its draft held in memory only; **Save** writes `providers.json` and the secret together, sets the default model and asks the conversation to set the composer's model; **Cancel** discards the draft, so nothing is written)                                                                                                                              |
| M Models panel UI                | new `src/webview/models/**`: the entry (→ `dist/webview/models.js`, a second entry in `scripts/build.mjs`), the section registry, the Providers and Models sections, the shared components (below), the panel's reducer; new `src/shared/modelsPanel.ts` (the panel's message and state schemas); the harness scenarios and accessibility cases for every state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| U Picker, first-run and usage UI | `src/shared/protocol.ts` (`modelOptionSchema` gains provider fields; `SIGN_IN_METHODS` gains `byo`), the `listModels`, `setModel` and `signIn` regions of `src/host/conversation/conversationController.ts` (`byo` runs `museSpark.startWithOwnModel`), `src/webview/components/SignIn.tsx` (the first-run screen's **Start with your own model**, ranked equally with the other two when no backend is set up), the "You're set up with `<provider>` · `<model>`" confirmation with **Manage providers**, `src/webview/components/Palette.tsx` (groups, pinned favourites first, **Add a model provider…** and **Manage models…**), the composer pill, `UsageDialog.tsx` (rows per provider, "unpriced", "local", OpenRouter's key usage; its setup rows offer the BYO choice too), `src/webview/state/uiState.ts`, the walkthrough region of `package.json` (`contributes.walkthroughs`: a step with a `command:museSpark.startWithOwnModel` link) and its `resources/` media, their harness scenarios and accessibility cases (the first-run screen with the new button, in both its states) |
| X ACP and headless               | `src/runtime/authCommands.ts`, `keyStore.ts`, `credentialVariables.ts`, `cliArgs.ts`, new `src/runtime/providersCommands.ts`, `src/runtime/backends.ts`, `src/runtime/exec/**` (`--provider`, per-codec origin pins and path allowlists), `src/acp/agent.ts` (model options)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| S Security                       | `src/core/redact.ts` (the presets' key shapes), the credential-variable names in `constants.ts`, the threat-model tests (`providersThreats.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| W Wiring                         | `package.json` (commands, `museSpark.suggestedProvider`; the walkthrough region is lane U's), README (with **Get started** naming the three ways in), `docs/PRIVACY.md`, `SECURITY.md`, CHANGELOG, AGENTS.md (rule 8's provider credentials), `docs/acp.md`, `docs/ci.md`, PLAN, `scripts/check-bundle-size.mjs`, `scripts/check-bundle-split.mjs`, `scripts/check-vsix-size.mjs`, knip and dpdm entries, CI's VSIX member list, `docs/certification/m95.md`, the full gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

- **The panel's components and state, for M95 and M96.**
  - **Sections.** `src/webview/models/sections.ts` registers each
    section as `{id, title, icon, Component, reducer}`; M95 registers
    `providers` and `models`, M96 `roles` and `agents`. The panel's
    navigation, deep links (`museSpark.modelsAndAgents` with a section
    and an item) and narrow layout come from the registry.
  - **State.** One host-owned state, schemas in `src/shared/modelsPanel.ts`,
    in slices: `providers` (each provider's preset, address, auth
    mode, credential state, test state, routing), `models` (scanned rows
    with capabilities, price card, badges, ticked and pinned flags),
    `scans` (per provider: time, status, diff, cancellable), `suggestions`
    (value, reason, source, accepted), `lastChoices`, `drafts` (unsaved
    forms with their errors) and `pendingRemovals` (undo). M96 adds
    `roles` and `agents` slices. The webview only renders and asks; the
    host validates, saves and owns every credential.
  - **Messages.** Namespaced by section and zod-validated both ways:
    `providers/*` (`select`, `prefill`, `enterKey`, `connect`, `test`,
    `save`, `remove`, `undo`, `export`, `import`), `models/*` (`scan`,
    `cancelScan`, `tick`, `pin`, `filter`), `suggestions/*` (`accept`,
    `change`); M96 adds `roles/*` and `agents/*`.
  - **Shared components** (`src/webview/models/components/`), each with
    its own tests and harness cases: `SearchableSelect` (the combobox
    pattern, type-ahead, descriptions, filter chips), `DataTable`
    (sortable, filterable, a keyboard grid that becomes cards at narrow
    widths), `FilterBar` (chips and range inputs), `Badge`,
    `SuggestionCard` (value, reason, **Accept**, **Change**),
    `InlineError`, `UndoBar`, `ScanStatus`, `KeyState` (never a key's
    characters), `CostNotice` (a call's cost, asked before it is made).
    They reuse the panel webview's theme tokens (M61) and `UI_TEXT`.
  - **Suggestion engine.** `suggest(kind, context)` returns
    `{value, reason}` from local facts only; M95 implements `defaultModel`
    and `sessionBudget`; M96 adds `roleModel` and `roleBudget` beside them.
    The strict four-theme usage accessibility gate currently fails with zero
    violations but 424 undecided color-contrast results for short table text
    (including zero-count cells). No exemption or rule is changed. This page
    finding is retained for the incoming U review rather than pre-empting its
    repair. PSScriptAnalyzer 1.25.0 is absent on Win11, so PowerShell lint cannot
    run; the brief prohibits installing system tools. Browser settings/folder/
    Models navigation and Tab/conversation/OpenRouter meter feeds remain explicit
    implementation gaps. These are not green checks or a release sign-off.

The actual helper-free VSIX is **2,515,818 bytes**, exceeding its unchanged
2,252,800-byte cap by 263,018 bytes. ZIP inspection confirms the compact
3,034-byte guide, recent notes and compact tables are present; the staged
runtime graph has no stale webview chunks. The printed VSCE source-document
sizes were misleading. No assets, language tables or features are removed and
no cap is raised to conceal the failure. The ACP package assembles successfully
(1,416,250 compressed bytes). A larger packaging/bundle change and the universal
helper receipt remain with the lead.

- **Archived.** The record that stood here is in [docs/plan-archive/gates.md](docs/plan-archive/gates.md).

**FIXM102E / RVM102E scoped receipt (2026-10-05).** Both P2 findings are
repaired; 147/147 targeted tests and seven byte-exact restored red drills pass
on Kubuntu. All five type projects, changed-file lint/format, plain knip,
duplication and production build/size/split/globals/notices pass. Localization
still exits 1 with the same 17 integration problems (L's 14 missing usage
tables, W's three unused manifest references); host API still exits 1 with the
same generated-record difference, no portable-boundary violation. The brief
reserves full quality and integration for the lead and forbids merging here.
No gate is weakened; W/L and the lead own those carried deferrals. See
`docs/certification/m102-e.md` and the named integration limits in §9.

- **Archived.** The record that stood here is in [docs/plan-archive/gates.md](docs/plan-archive/gates.md).

**FIXM95A gate delegation (2026-10-05).** The owner's rig brief expressly
forbids a full `quality` / full-test run and integration merges in this
lane. Local focused suites, five-project typecheck, scoped lint/format,
localization, host API, knip, duplication, cycles and production build run
here; the lead must run full quality on the integrated tree. No threshold,
ignore or rule is weakened. `docs/certification/m95-a.md` records results.
M95 K repair: FIXM95K/common.md delegates full quality to the lead. The new
activation-growth test passes at 2,901 bytes versus 3,072; no threshold
or test was weakened. Final M/U integration remains a certification gate.
**FIXM95H gate boundary (2026-10-05).** The rig brief requires scoped
tests and static/build checks here; full `npm run quality` is the lead's
integrated gate. Chat's existing bundle-split registration failure belongs
to lane W, which the brief explicitly forbids this lane from editing. Keep
the gate unchanged and record its exact failure and passed size budgets in
`docs/certification/m95-h.md` before integration.
**FIXM95SC gate deferral: RVM95SC-R-host-api-record (2026-10-05).** After
required merges, `npm run check:host-api` exits 1 solely because generated
`docs/ide-compatibility/host-api.md` has stale Node import counts:
`node:crypto` 32→33, `node:fs/promises` 34→35, `node:net` 3→4,
`node:os` 6→7, `node:path` 65→66. Membership and API rows have no reported
difference; the fresh receipt reports 279 VS Code APIs, 19 importing files,
23 Node built-ins and 57 theme variables. FIXM95SC's redactor import is
unchanged; its new imports are test-only. The generated record is outside
the lane brief's allowed files, so lane W/lead must run
`npm run check:host-api -- --write`, review these five counts and rerun the
unchanged gate on the integrated tree. No gate is disabled or weakened, and
this lane does not claim all gates or full quality green. See §9 and the
S/C certification records.

     The Providers section then lists each provider with its test state,
     key state ("stored, bound to `<origin>`", never any of the key), last
     scan, usage (OpenRouter's key), and **Test**, **Change key** or
     **Reconnect**, **Refresh models**, **Edit**, **Remove** (with
     **Undo**), **Export** and **Import**.

9. **Picker, first run and usage** (lane U). The first-run screen's
**Start with your own model** (equal rank when no backend is set up),
the walkthrough step, and the post-wizard confirmation. The wizard is
step 8's, opened at "Pick a provider". 10. **ACP and headless** (lane X). 11. **Security** (lane S). 12. **Docs** (lane W). 13. **Captures with keys**, as the owner supplies them (Owner steps): for
each cloud preset, one short turn with a tool call on its cheapest
tool-capable model in an empty workspace, its calls counted from the
request log, the frames saved as that preset's fixtures; for
Anthropic also a tool-use turn after a packing swap, with and without
the stale-block rule, and a compaction with tools. - **Recorded 2026-10-04** for OpenAI, xAI, Anthropic, Gemini,
OpenRouter, Groq, Mistral, Together, Fireworks, DeepSeek, Hugging
Face and Z.ai (`docs/certification/m95-captures.md`). Each has its
model list, a streamed tool call and its follow-up, usage, an
invalid-model error, and the cache pair where the provider caches.
The calls were made directly from scratchpad scripts, with no
workspace, and counted per request. - **Still to capture:** - Azure (needs a deployment); - Anthropic's packing-swap turn with and without the stale-block
rule, and its compaction with tools (these need the codec); - one live turn per preset through the built codec (acceptance 2),
which also rechecks Together's leaked `final` word.

- **Acceptance.**
  1. The panel adds a provider in under a minute from its first screen
     (timed on Ollama and on OpenRouter with **Connect**), from every
     entry point, and the quick pick does too.
  2. A turn on each listed preset runs tools with approvals, streams text
     and reasoning, records usage and cost (or tokens and "unpriced"), and
     resumes after a window reload.
  3. With no provider configured, Meta's request bytes equal the step 2
     goldens, and the M75 evaluation's wire is unchanged.
  4. Each codec's request for a growing session keeps its earlier native
     bytes; Anthropic's breakpoints sit where the rule says; nothing in a
     request depends on the clock or a random value.
  5. Editing `providers.json` to another origin makes the next request
     refuse and ask for the credential again; a 3xx answer fails the
     request; a key never reaches a log, the webview, a hook, a tool, a
     child process, an exported session or an error shown to the user.
  6. A workspace's `museSpark.suggestedProvider` only offers the panel; no
     workspace file can set an address.
  7. HTTP to a non-loopback address, a link-local or metadata address, and a
     public name resolving to a private address are refused; a private
     HTTPS address asks once.
  8. Every M51 and M91 hook event fires on a BYO turn with the provider id
     and the qualified model; a matcher on `meta` still matches Meta's turns.
  9. ObservationPack, `recall_output`, `then_run`, checkpoints, the verify
     loop, compaction and `/handoff` work on a BYO model; compaction keeps
     the tools where the preset says; an Anthropic tool-use turn after a
     packing swap is not refused.
  10. An unpriced model shows tokens and "unpriced", and a session with a
      dollar cap refuses it before sending; a local model shows cost 0; the
      reviewer, subagents, best-of-N and scheduled runs ask with the BYO
      price or refuse an unpriced model.
  11. Web search is never declared to a BYO model; images in a BYO
      conversation work only with a stored Meta key and its D48 popup.
  12. Switching models between providers in one conversation drops the
      previous provider's reasoning items and keeps everything else.
  13. OpenRouter: **Connect** stores a key without copy-paste; the privacy
      default sends `provider.zdr: true` on every request and lists only
      ZDR models; Account & usage shows the key's usage, limit and remainder
      from `/api/v1/key`; prices show the time they were fetched and
      **Refresh** updates them; settlement takes the reported `cost`; the
      attribution headers are exactly the three in D74.
  14. The ACP agent lists, uses and tests the same providers;
      `auth set --provider` reads standard input only; `exec --provider` runs in the
      fake CI harness with the key from standard input.
  15. Removing a provider deletes its secret after its undo; **Sign out**
      keeps provider keys unless its confirmation's "Also remove model
      providers and subscriptions" is ticked.
  16. Every bundle within D6; a Meta-only session loads neither
      `dist/providers.js`, `dist/modelsPanel.js` nor
      `dist/webview/models.js`.
  17. **The panel.** Choosing each preset prefills exactly its known
      fields; the provider dropdown searches by name and description
      with type-ahead and filters by chip; the Models table searches,
      sorts and filters by every listed facet and shows the four badges
      by their rules; a scan reports new, removed and repriced models
      against the last one, can be cancelled, and is reused while fresh;
      every suggestion shows its reason and can be accepted or changed;
      **Save** stays disabled until the form is valid, with each error
      inline in plain words; **Undo** restores a removed provider with
      its key; an export holds no credential, and an import is validated,
      previewed and confirmed address by address.
  18. **Accessible and narrow.** Every control has a label; the
      dropdowns and the table work from the keyboard alone (type-ahead,
      arrows, Enter, Escape); at 320 px nothing scrolls sideways; all 14
      languages; the accessibility gate passes in all four themes for
      every state.
  19. **Start with your own model.** The first-run screen shows the choice
      in both its states, ranked equally with the other two when no backend
      is set up.
      - It opens the wizard at "Pick a provider", and so does the
        walkthrough step's command link.
      - Finishing sets the composer's model and the default model, leaves
        first run, accepts a message at once and shows "You're set up with
        `<provider>` · `<model>`" with **Manage providers**.
      - Cancelling at any step returns to the first-run screen with no
        provider in `providers.json` and no secret in SecretStorage.
- **Tests** (each guard broken once on purpose, seen red, restored; the
  drills in `docs/certification/m95.md`):
  - **First run**, each able to fail:
    - the button opens the wizard at "Pick a provider";
    - a completed wizard sets the composer's model and the default model
      and leaves first run;
    - cancel at each step leaves `providers.json` and SecretStorage
      unchanged;
    - the walkthrough's command opens the wizard;
    - with no backend, the three choices render with equal rank.
      **DEFLAKE3 test-only lane scope (2026-10-04).** The rig brief requires a
      complete Windows unit inventory in batches of at most three files and
      300 consecutive checkpoint-copy file passes. It explicitly requires full
      `npm run quality` only for a product change; this lane changes tests and
      documentation only. Shared static/build checks still apply. Aggregate
      coverage/full quality and hosted confirmation remain the lead's gates; no
      rule, timeout or coverage threshold is weakened. The exact original hosted
      failure is not supplied and has not reproduced in 200 original-file runs.
      Evidence: `docs/certification/deflake3.md`.

- **Archived.** The record that stood here is in [docs/plan-archive/gates.md](docs/plan-archive/gates.md).

- **Golden requests**: one per codec per scenario (first turn, tool loop
  with reasoning, image, packed output, compaction), checked-in bytes;
  Meta's against step 2. Drill: reorder a key; add a timestamp.
- **Prefix stability**: requests n and n+1 of a fixture session share
  every earlier native byte (cache markers moved by the rule excepted).
  Drill: re-sort the tool list per request.
- **Stream decoding** from the captures: text, tool calls (fragments,
  whole, parallel, a float index), reasoning in each field and `<think>`,
  usage in each place, keep-alives, mid-stream errors under HTTP 200.
  Drill: drop the `index` fallback.
- **Reasoning replay**: the same provider and model replay, another drops;
  DeepSeek's every-turn rule; Anthropic's stale-block rule; Gemini's
  exact-part signatures; OpenRouter's `reasoning_details` order. Drill:
  replay across providers.
- **Origin binding and redirects**: an edited origin refused; 301 and 307
  refused with nothing sent on. Drill: compare hosts instead of origins.
- **Endpoint policy**: the URL and address table (loopback, private,
  link-local, metadata, IPv4-mapped IPv6, NAT64, `localhost` resolving
  elsewhere, rebinding between saving and a request). Drill: let
  `0.0.0.0` through.
- **OAuth loopback**: bound to `127.0.0.1` only, one use, a ten-minute
  end, `state` checked, the code exchanged once, the server closed in
  every path. Drill: accept a wrong `state`.
- **Keys never leak**: a key planted in every error envelope, header echo
  and stream error ends redacted in the log, the notice and the hook
  payload; the webview protocol has no credential field (a schema test).
  Drill: remove the transport's exact-value registration.
- **Prices**: the card's source order, the long-context tier, the
  worst-case reservation (OpenRouter's highest upstream), settlement from
  `cost`, the unpriced refusal under a cap, local free, the
  `estimateCostUsd` fix. Drill: restore the Standard fallback.
- **Catalogue**: the sync refuses a checksum mismatch and partial data;
  the filter; the data file's size cap. Drill: accept a truncated
  download.
- **Hooks**: payload fields per provider; matcher compatibility. Drill:
  send the literal `meta`.
- **Wizard flow** (the pure state machine): every step, back, cancel,
  skip, failures, the cost statement before a paid test, OpenRouter's
  privacy default. Drill: skip the cost statement.
- **Workspace suggestion**: a URL-shaped value is ignored. Drill: accept a
  URL.
- **Prefill per preset**: a table test that each preset fills exactly its
  fields and leaves the rest empty. Drill: drop one preset's key hint.
- **Search and filters**: provider search by name and description;
  each Models facet alone and combined; range bounds inclusive; sorting
  stable. Drill: make the context range exclusive.
- **Badges**: Recommended, Cheapest capable (tool calling and the
  harness's minimum context), Largest context, New, over a fixture
  catalogue. Drill: let a model without tool calls be cheapest capable.
- **Scan diffs** against a fake catalogue: new, removed and repriced
  models; staleness; cancellation leaves the last scan; one scan per
  provider at a time. Drill: compare ids case-insensitively.
- **Suggestions**: each value's reason text, from history and without
  it; the last choice remembered. Drill: drop the reason.
- **Validation, undo, import and export**: Save disabled until valid;
  undo inside and after its window; an export with no credential
  field (a schema test); an import refusing a bad address and
  previewing each change. Drill: let an import skip the address check.
- **Panel accessibility**: harness scenarios for every state (empty,
  scanning, scan failed, form errors, test results, the table filtered,
  badges, suggestions, undo, import preview, 320 px), axe in four
  themes, and keyboard paths through the dropdown and the table.
  Drill: remove a control's label.
- **ACP and exec**: the stdin-only key, per-codec pins, the CI fake run.
- **Live plan** (no money spent). Ollama on the Kubuntu rig and the Mac mini
  with a small tool-capable model: one turn with a tool call, a packing swap
  and a compaction; llama.cpp server on CPU; LM Studio on the host if
  installed; model calls counted from the servers' own logs. OpenRouter's
  connect flow and a `:free` model if the owner opens a free account (no
  credits needed for `:free`). Cloud presets otherwise only through step 13,
  with the owner's keys; free tiers (Gemini, Groq, Mistral) cost nothing if
  he opens them.
- **Gates.** The full quality gate; D6: activation grows by command
  registrations and loaders only (at most 3 KiB; about 20 KiB is left),
  `dist/modelApi.js` by the seam only (at most 8 KiB of its 54 KiB margin),
  new caps for `dist/providers.js`, `dist/modelsPanel.js` and
  `dist/webview/models.js` (the panel's React app, its own entry, so
  `dist/webview/main.js` keeps its 900 KiB budget) at measured
  plus 15%, rounded up to 25 KiB, and a size cap on
  `dist/providerCatalog.json` in `check-vsix-size.mjs`'s allowlist;
  `check-bundle-split.mjs` keeps the codecs out of activation and
  `dist/modelApi.js`; check-l10n; host-API (the new VS Code calls); the
  accessibility gate on the picker's and Account & usage's new rows.
- **Security.** D74's rules: credentials only in SecretStorage or the OS
  store, each bound to its origin; HTTPS except loopback; no redirects;
  private networks asked, link-local and metadata refused, rebinding
  checked; providers only in the user's own file; a workspace suggests a
  preset id at most; no credential in the webview, a log, a hook, a tool, a
  child or an export; OAuth with PKCE, `state` and a loopback bound to
  `127.0.0.1` for one use.
- **Threat model.**
  - **A malicious workspace.** It cannot set an address: no setting names
    one, `providers.json` is user-level, and `museSpark.suggestedProvider`
    takes a preset id whose origin is ours. Its rules, skills or files can
    still prompt-inject the model, as today, and the approval modes stand. A
    workspace hook or MCP server never sees a credential (variables
    stripped, none in any environment). Residual: a user who completes the
    form with an attacker's address because a README told them to; the
    confirm step names the origin that will receive their code, and the key
    is bound to that origin only.
  - **A malicious or compromised provider.** It controls what the model
    says, so it can propose any tool call: no worse than a jailbroken model
    today, since every call goes through the permission engine, protected
    paths and the shell guards; the confirm step for a custom server says
    so. Its frames are zod-validated and size-capped (frame, arguments,
    items, total stream), and its usage validated as M75 does (finite,
    non-negative, cached at most input); invalid usage leaves the cost
    unknown and closes the session budget (M82). It can under-report usage;
    the reservation still caps output. Model ids and labels it lists are
    untrusted text: control and format characters stripped, length capped,
    and the provider's label always shown beside them, so a custom server
    cannot pass itself off as Meta's `muse-spark-1.3`.
  - **Key exfiltration.** A config edit pointing a provider elsewhere: the
    origin binding. An HTTP redirect: refused. DNS rebinding: TLS binds the
    name, and each request re-checks the answers. Logs and errors: the
    redactor's shapes, the header and field rules and the exact value for
    the request's life; error bodies that echo part of a key are redacted
    before display. The webview: no credential crosses postMessage. Hooks,
    tools, MCP servers, git and checks: no credential in any environment,
    argument or file. Exports and shares (M84): no credential in a session.
    Settings Sync: neither the file nor the secrets sync. An OAuth code:
    PKCE makes a stolen code useless, `state` refuses a forged callback, and
    the loopback listens once, on `127.0.0.1` only. Residual, as with Meta's
    key today (§9): a process running as the same user can read the OS
    credential store.
  - **Local network (SSRF-like).** A custom address lets the extension POST
    JSON with a key to a host of the user's choosing. Plain HTTP only to
    loopback; private ranges asked; link-local and the metadata addresses
    (169.254.169.254, 168.63.129.16, `fd00:ec2::254`) refused; a public name
    resolving to a private address refused at each request. Residuals:
    behind a proxy, the proxy resolves the name, so the check sees only the
    local answer; on a shared machine another local user can listen on a
    free loopback port first (the panel's scan shows what answered, and a
    local server gets no key unless the user gave one).
- **Cost controls.** Free key tests (models lists, OpenRouter's `/key`,
  Ollama's tags); a one-token test only where nothing free exists, its cost
  stated first; prices dated and sourced, unknown models unpriced and
  refused under a dollar cap; reservations at the worst case, the
  long-context tier and OpenRouter's highest upstream included; settlement
  from the provider's reported cost where there is one; no hidden or
  background call on any provider (M74's automatic work, when built,
  follows Q-M74 per provider); paid features unchanged (D48), Meta-hosted
  ones billed to the Meta key only; the M75 evaluation unchanged; live tests
  local or free only, captures with the owner's keys counted and reported.
- **Docs.** README: **Get started** names the three ways in (Muse sign-in,
  a Meta Model API key, **Start with your own model**); **Model providers**
  (the panel and the quick pick, each preset's notes,
  local servers and Ollama's context, OpenRouter's connect, privacy routing
  and usage, prices and "unpriced", what stays Meta's, the ACP and CI
  commands); PRIVACY: which hosts receive code and keys for each provider,
  OpenRouter's routing, the local case, no telemetry; SECURITY: the threat
  model's summary and residuals; AGENTS.md rule 8: provider credentials join
  the Model API key's rules; `docs/acp.md` and `docs/ci.md`; CHANGELOG
  `[Unreleased] ### Added`; `docs/certification/m95.md` with every capture
  (workspace, server version, counted calls) and drill.
- **Owner steps** (credentials and new spending only; every design question
  is settled in D74).
  - For each cloud preset, create a key (paid, a few cents per capture, or
    the free tiers of Gemini, Groq, OpenRouter and Mistral) and hand it
    to step 13 by the existing in-memory route (standard input from a DPAPI
    file, `auth clear` after; M73's handling). Nothing is minted on his
    behalf; a preset without a capture stays out of the panel.
    - Done 2026-10-04 for twelve presets: OpenRouter, Groq, Mistral, Gemini,
      Together, xAI, OpenAI, DeepSeek, Fireworks, Hugging Face, Z.ai and
      Anthropic.
    - Azure needs a resource and a deployment.

<!-- plan-archive:end id="gates-5d64f91ce-35309" -->

## Candidate-lane gate records (2026-10-10/11)

<!-- plan-archive:begin id="gates-5d64f91ce-34829" lines="34829-34836" at="5d64f91ce" bytes="576" sha256="089e2a1b8589edad7670fd82b33472679f9c488ef9eedb68dd7d95d4d3168567" -->

**CM971R4 gate receipt (2026-10-10).** The unchanged production build gate
refuses eight upstream licence texts under the owner's strict slot grammar;
see §3 and `docs/certification/m97.md`. This is an external vendor evidence
blocker, recorded before committing the review repairs. The gate remains on
and failing; no product qualification or repository exit-0/1 pass is claimed.
The lane's explicit shared rules reserve the full aggregate quality command
for the lead, so this rig runs the prescribed static gates, production build,
and complete owning test files instead.

<!-- plan-archive:end id="gates-5d64f91ce-34829" -->

<!-- plan-archive:begin id="gates-5d64f91ce-34894" lines="34894-34931" at="5d64f91ce" bytes="2744" sha256="37435e3ab6bb072caaf602c741c6f701412d3729ce3e2a408753b576f324a384" -->

**CM1091A3 scoped rig qualification (2026-10-10, linuxlt).** The explicit
rig/common brief prohibits aggregate `quality` and delegates it and the
Windows replay to the lead. Run the complete vault file list at repository
deadlines, with at most three files per invocation, plus the owning reference
suite, scoped lint/format, all five type projects, plain knip, duplication,
localization, reference, host API, plan, roadmap and unchanged bundle budgets.
The foreign-user peer probe fails identically on base `82d50d5e4` and this
lane: `sudo-rs` cannot find the generated client under the rig's private
`TMPDIR`; no assertion, deadline, permission or test is weakened.
Reviewed repairs and six byte-exact restoration drills are recorded in the
M109 certification. All eleven scoped gates exit 0. The full visual gate
starts, but the unchanged 9,792-capture baseline plus candidate render
exceeds the explicit 120-minute time box at the observed pace; stop its
owned process group after 288 baseline captures (exit 143), clean only its
owned directories, and defer full visual approval to the lead with aggregate
quality. No baseline or tolerance changes. Native Windows replay remains a
separate lead step.
**CM952 scoped gate boundary (2026-10-11).** The C-M95-2 rig brief and
shared lane rules expressly forbid the aggregate `npm run quality` here:
the lead owns that run and the hosted Windows/macOS/Linux matrix. CM952
runs changed-file lint/format, all typecheck projects, relevant full test
files at repository timeouts, l10n/reference/roadmap/host-API checks,
deadcode/duplication/build, real loopback/Chrome drills, and supported visual
shards. The full 9,792-image-per-revision visual matrix belongs to the lead
with aggregate quality: measured serial rendering exceeds this lane time box.
No threshold, ignore, rule level or timeout is changed. Owner-account OAuth captures
and installed editor/OS receipts are the lead's external actions;
exact evidence is in `docs/certification/cm952.md`.
**PORTM105 gate boundary (2026-10-11, MacBook).** The authorized rig brief
and common rules prohibit aggregate quality/full tests and all browser, GUI,
microphone and capture launches. Run all five typecheck projects, scoped
ESLint/Prettier, complete owned files in batches of at most three at repository
deadlines, localization/reference/roadmap/plan/host API, plain knip,
duplication/cycles and production build; record exact results in
`docs/certification/m105-port.md`. Lead owns aggregate quality, coverage,
installed-editor/native qualification, actual `check:visual`/accessibility,
and `companionMediaBrowser.test.mjs` on a Linux desktop rig. No skip or timeout
is added to any test; existing cross-platform skips are reported as such.

<!-- plan-archive:end id="gates-5d64f91ce-34894" -->

<!-- plan-archive:begin id="gates-5d64f91ce-34952" lines="34952-34964" at="5d64f91ce" bytes="945" sha256="08ac46103a37d3744eeff82750ec55c411665f8ce419ca6be22d38f18fca36dd" -->

**MSM115-DELIVERY (2026-10-17, wslpc).** Delivery-lane scope: all nine
`cand/MSM115/*` branches are contained in the lane head (verified with
`git log <branch> --not HEAD`, empty for all nine), so no candidate merge is
owed. The lane connects the versioned store root, the v1 migration, the
ACP-side engine module, the lazy `/schedule` mapping and the per-schedule
consent line; it removes only `@unwired` tags whose exports have a caller in
the tree. It does not flip `SCHEDULE_EDITOR_DELIVERY_CERTIFICATION`: every v2
fire still refuses in production by design until the lead's complete receipts
exist, and flipping it here would weaken the gate. Still waiting: the report
action's `reports` port and the `schedule_report` tool (M113 lane Q and G
regions, not this lane's files), further sources/targets/editor rows (their
milestones), and M115w (needs M96c). No cap, threshold, ignore or rule is
weakened. See `docs/certification/msm115.md`.

<!-- plan-archive:end id="gates-5d64f91ce-34952" -->

<!-- plan-archive:begin id="gates-5d64f91ce-34966" lines="34966-34973" at="5d64f91ce" bytes="575" sha256="a4af9d1027868e3a07c5dbf80c32483f6b613f52e98f950e420797e4efc7e103" -->

**SCHEDJOIN2-ASSEMBLY-GRANT (2026-10-11, kubuntu).** The native helper builds
and fixture preparation fits the budget, but all three assembly families stay
red: the background coordinator's reconcile throws "Schedules are unavailable
in this host" during close on this rig, before any delivery assertion runs
(0/3 at the committed head and in the worktree). Per the shared lane stop rule
no third repair or broader grant is tried here. Keep every assertion and the
certification switch false. The lead owns further context/grant assembly
qualification and aggregate quality.

<!-- plan-archive:end id="gates-5d64f91ce-34966" -->

<!-- plan-archive:begin id="gates-5d64f91ce-34975" lines="34975-34983" at="5d64f91ce" bytes="653" sha256="1d10a8ac654db09444ad5b015d3715dad408af8206d7b1b49656e325f2159358" -->

**C-M115-2 R2 verification (2026-10-11, macbook).** All RVCM1152 findings
are fixed, with sixteen byte-exact red guards and interrupted-write shutdown
reconciliation. The scoped rig brief delegates aggregate quality to the lead.
Production build/full visual replay retain the accepted What's New decode
hold; jscpd retains only the two unchanged base clones. An additional direct
native-backend probe reproduces five unchanged native-queue failures with
HEAD English; its backend sources and tests are outside this lane and are
unchanged. Certification names all five and retains the control receipt.
No gate, timeout, dependency or budget is weakened.

<!-- plan-archive:end id="gates-5d64f91ce-34975" -->

<!-- plan-archive:begin id="gates-5d64f91ce-34985" lines="34985-34994" at="5d64f91ce" bytes="726" sha256="f7d56f63bb7beed392b11fe09d523670f5e8440c7fc7002aba802dee9a4f1452" -->

**C-M115-2 gate ownership (2026-10-11, macbook).** Scoped runtime/ACP/CLI
checks and red/restoration controls belong to this lane; aggregate quality,
independent Codex/Grok review and Windows/Linux execution remain with the
lead. The production build retains C-M115-1's accepted-base What's New decode
refusal; integrate the already accepted `fix/whatsnew-budget`, then replay
size/split/host-global checks on the complete artifacts. No cap is raised.
The zero-clone gate retains unchanged clones in `test/unit/ideMcpServer.test.ts`
and `test/unit/windowsTrustedPath.test.ts`, outside this lane's ownership.
Owned duplicate fixture setup is consolidated; no rule or ignore is relaxed.
See `docs/certification/m115-cm1152.md`.

<!-- plan-archive:end id="gates-5d64f91ce-34985" -->

<!-- plan-archive:begin id="gates-5d64f91ce-34996" lines="34996-35008" at="5d64f91ce" bytes="994" sha256="5b3b1848f944712182b32941d2958302f678709303aa471fe92e2bb28f30bced" -->

**C-M115-3 gate ownership (2026-10-11, win11).** The rig brief and shared
lane rules assign aggregate `npm run quality` to the lead; this worktree runs
complete owned test files at repository timeouts, five-project typecheck,
changed-file lint/format and scoped static checks. The production build still
refuses the inherited What's New decode budget before producing a complete
artifact set; size/split certification awaits the accepted content repair at
integration. The zero-clone gate retains only the inherited six-line clone in
`test/unit/windowsTrustedPath.test.ts`; that independent repair remains with
the lead. No cap, threshold, ignore or rule is weakened. This process runs in
Windows Session 0 and cannot exercise Session 1's native VS Code modal.
Native decline, Linux/macOS and independent Codex/Grok receipts remain required,
and the existing automatic-delivery certification switch stays false. See
`docs/certification/m115-cm1153.md` for scoped evidence and editor ownership.

<!-- plan-archive:end id="gates-5d64f91ce-34996" -->

<!-- plan-archive:begin id="gates-5d64f91ce-35010" lines="35010-35025" at="5d64f91ce" bytes="1149" sha256="a158a52d36b2303ba14654a518e1387995bc8578408c1fbf8853f73dec7409e5" -->

**C-M115-1 gate ownership (2026-10-10, win11).** The rig brief and shared
lane rules forbid aggregate quality in this worktree; the lead owns
`npm run quality` before integration. This lane runs its complete owning
test files at repository timeouts, the five typecheck projects, changed-file
lint/format, plain knip, duplication, localization, host API, reference,
roadmap and production build checks. Caps and gate levels stay unchanged.
Delivery registration remains absent until the acceptance matrix and the
independent Grok/fresh-Codex reviews are complete; the lane forbids sub-agents
and live model calls. See `docs/certification/m115-cm1151.md`.
The production build retains the accepted base's What's New decode refusal
(79,510 bytes against 76,800); no budget is raised. Its artifact size/split
replay and the visual gate's build prerequisite are deferred to the lead
after that inherited content is repaired.
The zero-clone gate also retains the accepted base's unchanged six-line clone
in `test/unit/windowsTrustedPath.test.ts`; owned clones are removed rather
than ignored, and that independent Windows-test repair belongs to the lead.

<!-- plan-archive:end id="gates-5d64f91ce-35010" -->

<!-- plan-archive:begin id="gates-5d64f91ce-35120" lines="35120-35136" at="5d64f91ce" bytes="1206" sha256="4ec15ed47c5776d93865a960526a1bb718f0f82a33e742d5351907eb6b00a7f6" -->

**CM1091A3 scoped rig qualification (2026-10-10, linuxlt).** The explicit
rig/common brief prohibits aggregate `quality` and delegates it and the
Windows replay to the lead. Run the complete vault file list at repository
deadlines, with at most three files per invocation, plus the owning reference
suite, scoped lint/format, all five type projects, plain knip, duplication,
localization, reference, host API, plan, roadmap and unchanged bundle budgets.
The foreign-user peer probe fails identically on base `82d50d5e4` and this
lane: `sudo-rs` cannot find the generated client under the rig's private
`TMPDIR`; no assertion, deadline, permission or test is weakened.
Reviewed repairs and six byte-exact restoration drills are recorded in the
M109 certification. All eleven scoped gates exit 0. The full visual gate
starts, but the unchanged 9,792-capture baseline plus candidate render
exceeds the explicit 120-minute time box at the observed pace; stop its
owned process group after 288 baseline captures (exit 143), clean only its
owned directories, and defer full visual approval to the lead with aggregate
quality. No baseline or tolerance changes. Native Windows replay remains a
separate lead step.

<!-- plan-archive:end id="gates-5d64f91ce-35120" -->

## Finished lane gate records (2026-10-06/11)

<!-- plan-archive:begin id="gates-5d64f91ce-35027" lines="35027-35035" at="5d64f91ce" bytes="604" sha256="d067fe32ba90cf982f3912ff02c82cc369b03bb9661067ba319d31ebc27648bb" -->

**M114PANEL hosted macOS timeout (open).** Run 38311021688, attempt 1,
job 115017063279: "loads the real lazy menu independently of the secret
modal focus owner" (`test/unit/m114Panel.test.mjs:241`) exceeded Vitest's
5,000 ms default; the other 70 cases passed, with no step times logged.
Probe `b45c7592b` passed 14/14 in 1.2–3.9 s on hosted macOS: the case's
run time is close to its 5 s budget under load; which step overran in the
failing run is not measured. Disposition: open; the case's fate belongs to
`chore/test-overhaul`, in review, not merged. Detail:
`docs/certification/release-0182.md`.

<!-- plan-archive:end id="gates-5d64f91ce-35027" -->

<!-- plan-archive:begin id="gates-5d64f91ce-35037" lines="35037-35047" at="5d64f91ce" bytes="788" sha256="1bfd2e4f1221c3c28315f8ad96998e1d6d79218228ad3f0c951c858d0efd4879" -->

**0.18.2 released-commit Hosts red (open).** Hosts 38329749606 on
`898a26c5e`, job 115076562053, "VSCodium latest" (1.135.06055): "creates
AGENTS.md in the workspace root and opens it (D15)" failed with "no matching
tab appeared within 5000 ms; open: Untitled, Untitled, AGENTS.md"; the same
case passed in PR-head Hosts 38311021363. Measured cause: a chat panel whose
webview finishes loading focuses its composer and takes the active editor
from a document opened in the meantime, a product defect since `fb1166ec6f`
(`docs/certification/release-0182.md`, probe runs 38335980951, 38336295689,
38336506352). Disposition: product fix is open work (panel focus fix,
`fix/panel-focus-steal`, in review; not merged). Hosts 38340629307,
workflow_dispatch on the same commit, ended cancelled.

<!-- plan-archive:end id="gates-5d64f91ce-35037" -->

<!-- plan-archive:begin id="gates-5d64f91ce-35062" lines="35062-35080" at="5d64f91ce" bytes="1425" sha256="e3426c44e0fc0e3827a60b37cb463160252bfc55531c5757ffd0dbdf88d646c6" -->

**MINOUT round 2 scoped qualification (2026-10-10, macmini).** The explicit
rig/common brief prohibits aggregate quality and full-suite runs; the lead
owns those gates. Complete owning suites use repository deadlines and at most
three files per invocation. Run all five type projects, changed-file lint and
formatting, plain knip, duplication, localization, host API, reference, plan,
roadmap and production build without weakening any limit. Record per-path
SHA-256 restoration drills and the full configured-provider loopback receipt
in `docs/certification/min-output-cap.md`. Hooks stay installed and enabled;
local commits only, no merge, push or paid/live request.
**CM9LNX publication hold (2026-10-10, Kubuntu).** The lane's explicit
rig/common brief forbids aggregate quality and delegates hosted platform
qualification to the lead. Keep every existing bundle/VSIX cap. The approved
Linux dictation engine adds a measured 3,111,639-byte x64 ZIP payload before
arm64, against the unchanged 3,700-KiB whole-VSIX cap; Q67 needs a lead/owner
budget decision or a separately reviewed payload reduction. Package staging
and CI now refuse missing recognizers, baseline libraries and notices; no
partial Linux-enabled VSIX has been produced or published. Local fake/real
recognition, guarded acquisition, licence and focused gate receipts are in
`docs/certification/m9-linux.md`. Native editor bindings stay C-M9-1/C-M104-1.

<!-- plan-archive:end id="gates-5d64f91ce-35062" -->

<!-- plan-archive:begin id="gates-5d64f91ce-35140" lines="35140-35148" at="5d64f91ce" bytes="668" sha256="9046995f33efa5b66c2e3543074159f8a96bb898dc55e95700ad2aa790a8d652" -->

**ACPM118 scoped rig qualification (2026-10-09, macmini).** The explicit
rig/common brief prohibits aggregate quality and delegates hosted replay to
the lead. All five type projects, changed-file lint/format, plain knip,
duplication, localization, host API, reference, tokens, plan, roadmap, cycles
and production build pass with unchanged limits. Complete sampler/runtime,
reference and ACP stdio owners certify the shared Darwin libuv boundary;
the matching Node 22 memory/CPU-loaded timeout and restored guard drill are
recorded in `docs/certification/cifix017.md`, Round 3. Hosted log downloads
return HTTP 403; local receipts do not claim a green hosted release.

<!-- plan-archive:end id="gates-5d64f91ce-35140" -->

<!-- plan-archive:begin id="gates-5d64f91ce-35184" lines="35184-35193" at="5d64f91ce" bytes="681" sha256="3c2940949cc0f12eb2444302b8bbb92dad4d423b62483455c3380544a3b12519" -->

**RVM94KR3G scoped follow-up (2026-10-09, kubuntu).** All 30 Tab/paid
suites pass (706 tests) at repository deadlines, including four additional
byte-exact restored red drills. The new fixtures' two duplication findings
are removed using the existing held-wait helper and the request's feature.
Full jscpd still reports only the unchanged 51-token
`test/unit/windowsTrustedPath.test.ts:206,279` clone already deferred below;
that file has no diff against `84e7df7fc`. No ignore, threshold, assertion,
timeout or hook is changed. Aggregate quality and the unrelated fixture
remain with the lead under the shared lane rules. Follow-up receipts are in
`docs/certification/m94kr3.md`.

<!-- plan-archive:end id="gates-5d64f91ce-35184" -->

<!-- plan-archive:begin id="gates-5d64f91ce-35261" lines="35261-35269" at="5d64f91ce" bytes="655" sha256="53307a22447c145a56288c475d429ef4b89abce03087f7a92aa8484e7a074253" -->

**RVMEDIAV3 gate scope (Windows host, 2026-10-09).** The lane brief runs
vitest on this Windows host only, at the repository's default timeout and at
most three files per run. The aggregate `npm run quality` and the full unit
run are not run. Instead these run directly: typecheck (all five projects),
ESLint `--max-warnings=0` and Prettier on the changed files, `check:l10n`,
`check:host-api`, `check:reference`, plain knip and the unchanged-cap
production build. Hooks stay on. The lead owns native macOS and Linux runs of
the new lease suite and full quality on the integrated tree. Results are in
`docs/certification/m105.md`, "Fix round: RVMEDIAV3".

<!-- plan-archive:end id="gates-5d64f91ce-35261" -->

## Closed gate items (LEDGER, MSM9M35, TOOLCAP, FIXM101)

<!-- plan-archive:begin id="gates-5d64f91ce-34840" lines="34840-34862" at="5d64f91ce" bytes="2029" sha256="0dec1c02d24db30bec557bfd85449aca9ef1acbb61e30bfbafb671cfbe2a1969" -->

**LEDGER local qualification deferral (2026-10-12). Superseded 2026-10-17 by
D208:** the 100 ms admission bound, its benchmark and the ledger it measured
are removed, so R3/R4 below no longer apply. The original record follows. The owner's latest
no-stand-in/no-screenshot testing rule replaces full `quality` and fake provider
proofs for this lane. Static gates and real core/packed commands are recorded in
`docs/certification/spend-ledger.md`. The unchanged 100 ms admission bound failed
on macOS at 10 closed claims (1,106.692 ms before the single-inode correction);
two earlier post-correction core tests exceeded the default 5 s (5.184 / 6.842 s); the current core/migration/typed-refusal batch passed all 35 without changing a timeout. Their earlier cause is UNMEASURED.
The final indexed-history fixture measured admission maxima 782.652 / 440.347 /
380.090 ms at 10 / 1,000 / 10,000 entries, hold maximum 856.212 ms; the 2 s
wait has no certified eightfold margin on those results. R3/R4 remain open.
No cap, timeout, ignore or assertion is weakened. ACP packaging is blocked by missing required Darwin/Linux native artifacts;
the keyless local product run stopped before connection at model availability,
so packed transport refund remains uncertified. The redacted full-history
secret scan found two entries among 4,731 commits; locations/cause are
UNMEASURED and history is not rewritten. Final static exits are in the
certification's named receipts. Preliminary duplication returned 10 clones, including inherited fake suites
that the owner forbids this lane to repair; no ignore or threshold is changed.
The final receipt lists every remaining clone. The history-size fixture expands
real-writer transaction data and is distinct from 10,000 actual admissions. Final macOS matrix, Windows
rename/hard-link takeover, editor interactions and provider billing outcomes
remain uncertified until their named real-use/platform runs. This is not a
release certification and the change must not be described as fully green.

<!-- plan-archive:end id="gates-5d64f91ce-34840" -->

<!-- plan-archive:begin id="gates-5d64f91ce-36491" lines="36491-36507" at="5d64f91ce" bytes="1168" sha256="afb3ffd238e3af1fd3211d4f0050b3f7b062a1ea4b35fb9e0b76b1f3d94d6e0c" -->

**TOOLCAP lane verification (2026-10-13, macmini).** One tool result can
never end a conversation: every tool result passes one choke
(`boundToolResultText`: 16,000 estimated tokens per result, 8,000 chars per
line, at most 1/4 of the remaining window), cuts keep a spill file under
`.muse-spark/tool-results/` with a one-line notice to the model and the
person, and a provider `prompt is too long` refusal trims largest results,
compacts once, then ends the turn with the true sentence (at most 3 sends).
The lane's own base measurement (fake provider, ten 400,000-char lines:
32,014 chars reach the request packing-off, a 1,024-char placeholder
packing-on) and the per-kind bound survey are in
`docs/certification/tool-result-bound.md`; the exact entry path of the
lead's 2026-10-12 940k-token session is recorded there as undetermined, with
the two consistent mechanisms named. The rig brief forbids the full
`npm run quality` wrapper and the whole suite here (at most three files per
run, repository timeouts); the lead runs the aggregate gate and the
loopback/socket suites this sandbox blocks (EPERM) before release. No
threshold, ignore or timeout is weakened.

<!-- plan-archive:end id="gates-5d64f91ce-36491" -->

<!-- plan-archive:begin id="gates-5d64f91ce-36513" lines="36513-36513" at="5d64f91ce" bytes="2411" sha256="9aa682e13de0d9e7dc315c44906404bb9b48831d20c24650ee5bc8f6c2f455ee" -->

**MSM9M35 lane-K activation budget (2026-10-17, macmini; open, lead-owned).** `test/unit/modelsActivationBudget.test.ts` (at most 3 KiB over the immutable pre-K production bundle) fails on the lane tree: baseline 561,352 B, current 568,566 B, growth 7,214 B against the 3,072 B cap. `main-now` 3d30a7321 alone measures 561,352 B to 564,215 B = 2,863 B (the test passes there with 209 B headroom), so the lane's specified behaviour adds 4,351 B and no behaviour-adding milestone can fit the remainder. Diet already applied, none of it a gate change: the Linux driver ships in the new `dist/voiceLinux.js` (50 KiB budget by the measured-plus-15% rule, actual 35,907 B) instead of raising `dist/voice.js`'s 50 KiB cap; companion tunables moved out of `src/shared/constants.ts`; moving the download-consent card into `dist/voiceLinux.js` was tried and reverted because deferred bundles keep no `vscode` import by build design (a stray import fails `npm run build`) and consent arrives as a parameter, the M93 precedent. What remains in activation is specified behaviour: the M9 Linux availability probe (`src/core/voice/helperLocation.ts`), the disabled-model cleanup with its honest pending/removed states (`src/host/voice/dictationHost.ts`, RVCM9LNX P3), the Linux bundle loader (`src/host/voice/voiceBundle.ts`), the M35 paid scope identity and reserve wiring (`src/extension.ts`, D30), and the `LINUX_DICTATION` pins and paths (`src/shared/constants.ts`, D140). No threshold, rule level or ignore is changed and the test is not skipped. **Fixed 2026-10-17 (linuxlt, RVMSM9M35FIX), no cap change:** the setups moved off the activation path into the new `dist/dictation.js` (13,032 B measured, 25 KiB budget by the measured-plus-15% rule), required at their existing construction points with the installed table, so timing and behaviour are unchanged; `dictationHost.ts` takes its host capabilities as parameters (the M93 precedent) because deferred bundles keep no `vscode` import; `LINUX_DICTATION` moved to `src/shared/linuxDictationConstants.ts` (re-exported, the browser-check precedent) so activation no longer carries it. Growth is now 2,577 B of the 3,072 B cap (495 B headroom). The split gate refuses the four moved modules back in activation, and its fire drill is recorded with the real-use proof in `docs/certification/msm9m35.md`. No threshold, rule level or ignore changed; the deferral is closed.

<!-- plan-archive:end id="gates-5d64f91ce-36513" -->
