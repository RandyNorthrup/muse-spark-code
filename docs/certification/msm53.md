# MSM53 certification — finish M53: rewind and side chat with Muse Code on Windows

Lane MSM53, rig `macmini`, worktree `/Users/randy/lanes/MSM53`, branch
`ms/msm53`. Base: `b44651402` (lane C-M53-3). Merged `main-now`
`3d30a7321` as `0ffcc2369`, then the C-M53-1 evidence as `481c2915a`.
No push, no rebase, no model call. Hooks on for every commit.

M53 itself (D46) shipped in 0.9.0 (PR #41). What was still open: the
Windows fork refusal was certified only to 1.4.3, and the Plan-mode side
fork was not certified read-only (C-M53-3 built the refusal on an old
base; C-M53-1 probed 1.4.4 on Win11). This lane joins both onto current
main and leaves them reachable, documented and gated.

## What was merged from which branch

- `b44651402` (lane HEAD, `rigs/macbook/c/m53-3`, 2026-10-11): C-M53-3
  read-only side fork — `sideChatRefusalChoice` / `isApprovingChoice` in
  `approvalRules.ts`, controller wiring, two l10n keys in all 14 tables,
  README paragraph, CHANGELOG entry, `docs/certification/cm53-3.md`.
  Already the lane base; carried over the main merge by git's auto-merge.
- `9cf182bab` (`rigs/win11/c/m53-1`, 2026-10-10): C-M53-1 Windows 1.4.4
  retest. Merged by hand onto the joined tree in `481c2915a`:
  - `docs/certification/m53-captures/win11-1.4.4/{msp.json,trace-counts.json,tui.json}`
    copied byte-exact (SHA-256 checked per file against the source commit).
  - The `## C-M53-1 Windows 1.4.4 retest` section appended to
    `docs/certification/m53.md` (append-only; main's text untouched).
  - README Windows limitation entry extended to 1.4.4-R5419.1 with the
    capture link; `MuseCodeHost.ts` guard comment cites the 1.4.4 refusal;
    PLAN.md D26 handshake line and M53 section note both probes;
    `docs/roadmap/entries.json` M53 summary extended; ROADMAP.md
    regenerated (`node scripts/gen-roadmap.mjs`).
  - NOT carried: the lane's `test/unit/MuseCodeHost.test.ts` version rows
    (that suite was deleted by main's test overhaul; deletions stay
    deleted) and its `sdk144.md` edits (main rewrote that record for the
    1.4.4/ACP-1.7.0 bump already).
- `main-now` `3d30a7321` merged as `0ffcc2369`. Conflicts: CHANGELOG.md
  (union: C-M53-3 entry kept atop main's Pending list) and
  `test/unit/conversationController.test.ts` (modify/delete — deleted, per
  the brief; the C-M53-3 controller tests lived in that file and go with
  it, see below). No decision number collides: the branch adds no new
  D-number (D46 and D26 are references).

## What is now reachable and where (connections, final tree)

Side-chat refusal, VS Code panel, Muse Code backend:

- `src/core/agent/approvalRules.ts:166` `isApprovingChoice` — an
  `approved`-prefixed decision is an approval; anything else is not.
- `src/core/agent/approvalRules.ts:178` `sideChatRefusalChoice` — the
  card's own `abort` choice, or `undefined` when the host names none.
- `src/host/conversation/conversationController.ts:2483`
  (`approvalRequested`): a side-chat Muse Code session answers with the
  refusal via `refuseSideChatApproval` (`:2109`, sends `approval/decide`
  with `abort`, marks `sideRefused`, shows no card) and returns; with no
  session or no reject choice the card is shown and the raw event is kept
  in `sideChatCards` (`:2484`).
- `src/host/conversation/conversationController.ts:2507`
  (`approvalUpdated`): refreshes the retained card's choices.
- `src/host/conversation/conversationController.ts:2536`
  (`approvalResolved`): a policy refusal resolves labelled
  `UI_TEXT.sideChatResolver` with `UI_TEXT.sideChatWriteRefused`
  (`:2540-2541`); other resolutions drop the retained card (`:2545`).
- `src/host/conversation/conversationController.ts:3017`
  (`decideApproval` backstop): an approving click on a retained side-chat
  card is refused with the notice and the card is re-offered; a reject
  click passes through. Questions (`userInput`) are untouched, so Plan
  elicitation still works.
- `src/shared/l10n/en.ts:3119-3120` and all 14 `l10n/ui.*.json` tables:
  `sideChatWriteRefused`, `sideChatResolver` (`npm run check:l10n`: 0
  problems; 14/14 `equal=true` in the pack-order diagnostic).
- Session teardown clears both maps (`:1991-1992`).

Windows guard (every version, until one is verified):

- `src/core/backends/musecode/MuseCodeHost.ts:2038-2044`:
  `canEditSessions` stays `platformOs !== 'windows'`, now citing the
  1.4.3 (2026-10-05, `muse143.md`) and 1.4.4-R5419.1 (2026-10-10,
  `m53.md`) refusals.
- Rewind, fork, side chat and rename stay hidden on Windows; **Rewind
  Code to Here** still works; the Model API backend offers everything
  (README `No Rename, conversation rewind or Side chat…`, `README.md:4727`).

Help reference and docs: `npm run check:reference` passes (no new
command, setting or feature — no catalog row, same as C-M53-3);
`npm run check:roadmap` passes; `npm run check:plan` passes (0 drift).

## Tests

- `test/unit/approvalRules.test.ts`: 82/82 pass on this tree (repo
  default timeout, `--maxWorkers=3`), including the four C-M53-3
  side-chat cases (refusal choice on Model API and MSP-shaped cards, no
  refusal without a reject choice, the `approved`-prefix classifier).
  Pure logic through the real module, data in — no stand-ins.
- Dependents (`vitest related` over `approvalRules.ts`,
  `conversationController.ts`, `MuseCodeHost.ts`): 4 files pass, 143
  tests pass — `museCodeProtectedWrites` (31), `approvalRules` (82),
  `runtimeServices` (17), `acpStdio` e2e (13). Three live e2e files skip
  by their own existing condition (need a real provider): `live`,
  `modelApi.live`, `reviewer.live`. Exit 0.
- The C-M53-3 `conversationController.test.ts` additions are gone with
  main's deletion of that suite. Not restored: the owner's testing rules
  forbid fake-driven suites and the brief keeps overhaul deletions
  deleted. The controller paths they covered are proven by the
  packed-product run below and the lead's real-life steps.
- Red drill (final tree): `sideChatRefusalChoice` forced to `undefined`
  in `src/core/agent/approvalRules.ts` → `approvalRules.test.ts` fails
  exactly `the side-chat policy on Muse Code … answers every approval with
the reject choice` (`expected undefined to be 'abort'`, 1 failed, 81
  passed); restored byte-exact (SHA-256
  `5096aa639285a5779787aae516c211409a94b25e54ebe6a618b4f7177b5ea8ed`)
  → 82/82 again.
- Packed product: `NPM_CONFIG_CACHE="$TMPDIR/npm-cache" npx vitest run
test/e2e/execStdio.e2e.test.ts` (repo default timeouts) → 14 passed, 32
  skipped (live-provider cases, by their own condition), file red on the
  `M80 D package guards` `beforeAll`: `packagingFixture()` plus the
  `package-acp.mjs` pack exceed its 60 s hook budget on this loaded rig
  (load 5–12). Same file on the untouched base (`main-now`, clean
  `$TMPDIR/msm53base` clone with hard-linked `node_modules`, same flags):
  exit 1 with the identical shape — 14 passed, 32 skipped, file red on the
  same two hook timeouts (`Hook timed out in 10000ms` at file level,
  `Hook timed out in 60000ms` in the `M80 D package guards` `beforeAll`).
  Measured on both trees: fails on base too, so this is not a regression
  from this lane. The lead re-runs it on a quieter machine; the clone was
  removed after the measurement.

## Gates (final tree, exit codes)

- `npm run format:check`: 0. `npx eslint --max-warnings=0` on the five
  touched source/test files: 0. `npm run typecheck` (all projects): 0.
- `npm run deadcode` (knip): 0 (3 pre-existing config hints only).
  `npm run cycles`: 0 (no circular dependency). `npm run duplication`
  (jscpd): 0 clones. `npm run check:l10n`: 0 problems.
  `npm run check:reference`: current. `npm run check:host-api`:
  0 problems. `npm run check:plan`: 0 drift. `npm run check:roadmap`:
  current. `npm run check:badges`: 0. `npm run check:tokens`: 0 problems.
- `npm run build`: 0 (all bundles within budget; the old webview-surface
  overflow noted in `cm53-3.md` is gone on this tree).
- `npm run security:audit`: 0 (2 advisories, 1 in
  `.github/audit-exceptions.json`).
- `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`: BLOCKED on this
  rig — semgrep starts then dies with `Fatal error: exception Failure:
ca-certs: empty trust anchors` (exit shows an OCaml backtrace ending in
  that line). Environment TLS store, not a code finding; the lead runs it
  outside the sandbox. Not claimed clean.

## Real-life steps for the lead (no model call needed for 1–3)

1. Windows guard: on Win11 with any Muse Code CLI (1.4.4-R5419.1
   verified), open a Muse Code-backend conversation — Rename, Rewind,
   Fork and Side Chat stay hidden; **Rewind Code to Here** still works.
   Switch to the Model API backend: all four appear.
2. Side-chat refusal: on macOS/Linux with the Muse Code backend signed
   in, open **Side Chat** from a conversation header, send a prompt that
   makes the CLI raise a write/shell approval. No approve-capable card
   appears; the turn resolves labelled `Side Chat` with “Side chats are
   read-only, so this request was refused.” If a card does appear (host
   offered no `abort`), clicking its approve choice refuses with the same
   notice and re-offers the card; clicking reject carries on. Needs a
   real provider answer — the lead's real-life run.
3. Rewind: on a Model API conversation, a sent message's ⋯ menu offers
   Fork / Fork and Rewind / Rewind; choosing Rewind restores the prompt
   as a new draft.
4. Packed product: `npm run build`, `npm pack`, install the VSIX and
   repeat 1–3 against the installed build.

## Still not done, and why

- ACP and other editors keep their own approval path (C-M53-4 scope):
  the refusal is the VS Code panel only.
- Live Plan-on-1.4.4 verification and the upstream sdk#86 report (CLI
  allow-rule writes run without asking): need a live CLI with model
  calls / a state-changing `gh` command — forbidden in this lane.
- SAST (above): sandbox TLS store; lead runs it outside.

## App problems

- None found in this lane's scope. The merged tree builds, gates and
  tests as listed above.

## Review correction (RVMSM53, 2026-10-17)

Three claims above do not hold as written, and the code had three holes
the review fixed in `e30eb6352`:

- "The controller paths they covered are proven by the packed-product
  run below" is wrong: that run is `test/e2e/execStdio.e2e.test.ts`
  (the ACP exec package), which never reaches the panel's side-chat
  approval paths, and the file was red on its packaging hook besides.
  On the final tree the controller wiring has no automated proof; the
  pure policy is proven by `approvalRules.test.ts` and the wiring
  rests on the lead's real-life steps 1–4 above, still open.
- The backstop failed open: a click whose choice id was not on the
  retained card (or with no retained card) was sent to the host, which
  forwards choice ids unvalidated. `approvalRules.isSideChatClickRefused`
  now lets only a known non-approving choice through (test added,
  red-drilled; `approvalRules.test.ts` is 83/83).
- A staged approval's later stages (`approvalUpdated`) were shown
  instead of refused; they are now refused with the stage's own reject
  choice (`conversationController.ts:2512-2531`), and a refusal that
  fails after its session ended no longer forwards the dead session's
  card (`:2109`). Line references above from `approvalUpdated` on
  moved by these edits; the click backstop is now at `:3034`.
