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
