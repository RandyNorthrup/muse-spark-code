# TOOLCAP certification: one tool result can never end a conversation

Lane TOOLCAP round 2, branch `fix/tool-result-bound` (round 1 commits
`7d9495238`, `839821555`, `51cc8acbb` on it).
Tester: the lane agent on rig `macmini`, worktree `/Users/randy/lanes/TOOLCAP`.
No model calls, no provider requests. One test/typecheck/lint/build at a
time; vitest with `--maxWorkers=2`; repository timeouts throughout.

## 0. The measured case (lead, 2026-10-12, released code path, Model API backend)

One command-tool call (`grep -rIn -i "glimmer" …`, ten lines at most, some
lines megabytes long: one-line JSON captures) put about 940,000 tokens
(~3.4 MB) into request 11 (input 994,294; 941,455 cached). Request 12 reached
999,913 tokens. The next request was refused:
`prompt is too long: 1002881 tokens > 1000000 maximum`. Every resumed attempt
was refused again (1002979, 1003048, 1003117): nothing trimmed, dropped or
compacted; automatic compaction is inactive. The single result also cost about
$2.35 of cache writes.

## 1. Part 1: what bounds exist today (before the change)

Measured on the base commit with a stand-in provider (a `bash` call returning
ten 400,000-character lines ≈ 4.0M chars; probe file created, run, read, then
deleted — base worktree `$TMPDIR/toolcap-base` at `38ef148f19`). These rows
are labelled for what they are: measured against a stand-in, not the product.

| run                                                            | characters in request 1's `function_call_output`     | form                                                                                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packing off                                                    | 32,014                                               | `clipMiddle` of the single stream to 32,000 chars around the elided marker, plus exit code; the middle is dropped: no counts, no spill, not recoverable |
| packing on                                                     | 1,024                                                | pack placeholder (id, chars, lines, tokens, first/last lines) because 4.0M chars > `SHELL_PACKED_MAX_CHARS`; the full text stays in memory only         |
| packing on, output 8k–1M chars (code-read, not measured)       | whole (up to 1,000,000 chars) on the first two sends | `OBS_PACK_WHOLE_SENDS` (2): rides whole twice, placeholder from the third send                                                                          |
| model cannot pack (`canPack()` false) or reviewing (code-read) | whole, every send                                    | `body()` skips the projection; the replay keeps the originals                                                                                           |

The measured hole, stated honestly: the exact entry path in the lead's
session was not captured, so its cause is NOT proven. Consistent with the
evidence are: (a) packing constructed but `canPack()` false for that model id
while `wholeShellOutput` stays true — then the whole text rides every send;
(b) packing on with the output just under `SHELL_PACKED_MAX_CHARS` but
token-dense (minified JSON: ~1 token/char), riding whole on exactly its first
two sends. The lane closes every candidate by construction (§3) and recovers
when a refusal still arrives (§4).

## 2. Guarantee or estimate: which number is which

- Guarantee: the window share. Measured in UTF-8 bytes against tokens
  (`windowShareBytes`: a quarter of the remaining window). A token is at
  least one byte, so a result of at most N bytes is at most N tokens whatever
  the text's density (hex, base64, minified JSON, CJK). The guarantee covers
  the kept result text; the harness's own one-line cut notice (a fixed
  template plus the spill path and recall id, a few hundred bytes) rides on
  top of it and is not part of the measured result (review, 2026-10-17). Pure test: 62,061
  ASCII characters pass the character estimate but are cut under a 60k window
  (`keptBytes <= 15,000` asserted); 20,000 CJK characters (60,000 bytes,
  inside the character estimate) are cut to the same byte bound.
- Estimate: the per-result cap. 16,000 tokens at the product's own
  4-characters-per-token rule (~64,000 chars). Friendlier for ordinary text;
  denser text carries more tokens per character. Never the safety argument.
- Per-line cap: 8,000 characters (the product's own `OBS_PACK_THRESHOLD_CHARS`).
  A character count, therefore an estimate; the measured failure was line
  length, not count.
- Unknown window: where the model's record names no window, the share is
  skipped, never guessed; the bound is then the per-result caps alone
  (asserted: `validateToolResultCap(10_000_000, undefined, 64_000)` keeps the
  configured bytes). The model record is the only source of the window.

## 3. The bound, held by a type

`BoundedToolText` (`src/core/backends/modelapi/schemas.ts`) is the text of a
tool result allowed into a request. Only four producers exist, all named on
the type: `boundToolResultText` (tool text through the one bound),
`withCutNotice` (bounded text with its cut notice), `fixedHarnessText` (fixed
harness words with no tool text), and `restoredToolText` (byte-identical
restore; text stored before the bound still meets it through send-time
recovery). Every place that builds a `function_call_output` or a
tool-carrying note takes that type, not `string`: `FunctionCallOutputItem.output`,
`callOutputItem`, `toolNoteItem`.

Construction sites changed (all of them):

- `ModelApiHost.boundToolOutput` / `boundOutcome`: the choke returns the
  branded request text beside the row's strings; `finishCall` takes the
  branded `requestOutput` (new required parameter) and builds the replay item
  with `callOutputItem`. Callers that never ran (incomplete, stopped,
  skipped) brand their fixed words with `fixedHarnessText`.
- `noteForModel` / `settleNotes` / `appendHookContexts` / `noteSyncCut` /
  `noteChildCut` / `trimLargestToolOutputs`: notes and trims carry
  `BoundedToolText` via `withCutNotice`; the local string-taking `noteItem`
  is deleted in favour of `toolNoteItem`.
- `skipCalls`: fixed skip reasons via `fixedHarnessText` + `callOutputItem`.
- `replaceOutput` (imported-hook replacement): model-visible tool text, now
  through `noteSyncCut` under the call's own spill (recall returns the bytes
  the model saw).
- `copyInto` (fork/restore): whole outputs enter through `noteSyncCut`;
  recorded and pending notes are already bound.
- `observationPack.placeholder`: placeholders pass the bound under the
  default caps; when a smaller configured guard would cut one, the current
  (already bounded) text rides instead, with send-time recovery as backstop.
- `codecs/responses.ts` replay mapping: brand-preserving `cleanWireText`
  overload; the empty-output constant via `fixedHarnessText`.
- `codecs/shared.ts` `cleanWireText`: overload preserving the brand (a
  1-for-1 character swap cannot break the caps).
- `hookModelEntry.ts`: read-only tool text through the bound with default
  caps; over the bound it throws loudly (no spill writer exists in the hook
  loop) instead of riding unbounded into a paid side call.
- `sessionStore.ts` restore: stored bytes stay byte-identical via
  `restoredToolText` (goldens, forks, compaction rely on it).
- `execArgs.ts` renders the below-floor sentence inline (the same words
  `capRefusalReason` renders) because the bound loads lazily with the backend
  and must not ride in `dist/acp.js` (the split gate failed the import;
  reverted to the inline render).

Red drill (seen to fail, then green): a scratch file returning a bare
`string` as `function_call_output.output` fails typecheck with
`Type 'string' is not assignable to type 'BoundedToolText |
readonly FunctionOutputPart[]'`; removed after. The source-scanning guard
test is deleted: bypassing is now impossible by construction, not by grep.

The notice tells exactly what was cut: `headLines`/`tailLines` count the
lines actually kept, `omittedChars` is exactly `totalChars - keptChars`.
Pure tests over odd inputs (all asserting kept + omitted = total): one
enormous line, many short lines, a cut inside a surrogate pair (no split
pair, no replacement character), CRLF text, lines cut while the total fits,
and a zero-room window (empty keep, all omitted).

## 4. Recovery: one proven refusal, and nothing else phrased

Provenance of every recogniser the recovery rests on:

| recogniser                                                                                                                                                                  | rests on                                                                                                           | kept or removed                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anthropic `prompt is too long: N tokens > M maximum` (digits only), `parsePromptTooLong`                                                                                    | recorded real answer: the lead's 2026-10-12 session (`prompt is too long: 1002881 tokens > 1000000 maximum`, §0)   | kept; typed as `PromptTooLong`, numbers flow into the true sentence                                                                                                                                                                                                            |
| count-based overflow kinds (`preflight`, `input-above-window`, `empty-near-window`)                                                                                         | usage counts and the model record, not phrases                                                                     | kept                                                                                                                                                                                                                                                                           |
| OpenAI Responses / chat-completions / Gemini refusal phrases (`context_length_exceeded`, token-limit prose, input-too-long prose, inherited from `classifyContextOverflow`) | neither: no recorded real answer in-repo, and no provider documentation consulted (no provider requests this lane) | removed from the recovery path: `canRecoverOverflow` refuses the trim-and-resend steps for phrase-based `error` kinds without the proven numbers, so an unrecorded shape ends the turn with the short sentence instead of a resend, until an answer is recorded for its format |

The shared classifier itself is untouched (another lane's feature and tests);
only TOOLCAP's reliance is narrowed. Order when proven: trim largest riding
results with spills and send again once; compact once when available and send
again; else the true sentence with the provider's own numbers
(`contextWindowTooLong`), or the short form (`contextWindowFull`) — the
numbers appear only when proven, never guessed. At most 3 sends; restored
sessions recover at send time the same way. Pure tests: the proven refusal
parses with its numbers; every other shape (`context_length_exceeded`, bare
prose, empty) is rejected; `canRecoverOverflow` recovers counts and the
proven shape only.

What TOOLCAP needs from the provider-refusals branch (`fix/provider-refusals`,
`ProviderRefusal` with kind `tooLarge`): nothing copied. When it lands, the
recovery should consume its `tooLarge` kind instead of the phrase
classification, and it needs the wire's own numbers on it (refused tokens and
window maximum when the wire states them) so the true sentence keeps saying
by how much; without numbers the short form stays. Its classification must
itself rest on recorded answers per format.

## 5. The full output's life on disk

- Who can read it: spills are plain workspace files under
  `.muse-spark/tool-results/` (git-ignored). Whoever can read the workspace
  can read them: POSIX file modes from the process umask, Windows ACLs
  inherited from the workspace folder. A command's output can hold secrets the
  command printed; spills are not encrypted. Stated in the constant comment
  and the setting description.
- Removed with the session: the store's `remove` and retention-expiry paths
  delete the session's spills (`spillPrefix` match); a failed removal is said
  in the log with the session and file, never swallowed; an unknown workspace
  is said too. Both notices (model and person) say the spill file is removed
  with the session.
- Age rule: `TOOL_RESULT_SPILL_MAX_AGE_DAYS` (30), stated in the setting
  description, enforced by a sweep wherever sessions are listed (once per
  workspace). Only spill-shaped files (`isSpillFile`) are ever removed;
  anything else a person put in the directory is left alone. Pure tests pin
  the prefix, the shape, and the stale boundary (unreadable clocks are kept).

## 6. Before / after the measured case

|                   | before (base)                                                                                                                                | after (this lane)                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| request 1 carries | packing off: 32,014 chars, middle dropped silently; packing on: 1,024-char placeholder, 4.0 MB in memory; unpackable model: whole every send | ~64k cut + one-line notice (counts, longest line, spill, recall id)                                                                                      |
| full result kept  | packing on: memory only; packing off: no                                                                                                     | spill file, full runner text, pageable                                                                                                                   |
| model told        | elided marker without counts, or placeholder                                                                                                 | how much, which head/tail, omitted count, longest line, exact paging, removal with session                                                               |
| person told       | clipped rows                                                                                                                                 | plain-words preview with the spill path and removal                                                                                                      |
| refusal then      | turn fails `contextWindowFull`; resumes refused forever                                                                                      | proven refusal: trim → resend; compact → resend; else the true sentence with numbers; conversation usable. Unproven shape: the short sentence, no resend |
| sends on refusal  | unbounded authoring, then stuck                                                                                                              | ≤ 3, and only for proven overflows                                                                                                                       |

Golden: requests without an oversized result stay byte-identical (the kept
pure suite plus `execArgs`' 59 tests green; the repo's golden-request suites
are the lead's dependent runs in §9).

## 7. Red drills (each seen to fail, then green)

- Type choke: a scratch `function_call_output` with a bare `string` output
  fails typecheck (`Type 'string' is not assignable to type 'BoundedToolText
| readonly FunctionOutputPart[]'`); removed after.
- Line cap, window share, refusal without numbers (short form): covered by
  the kept pure tests (29 in `toolResultBound.test.ts`), each asserting the
  failing leg.
- Recovery order: the old fake-provider order tests are deleted with the
  fake suite (§8); the gate that remains is `canRecoverOverflow`, proven by
  the pure cases above.
- Split gate: importing the bound into `execArgs` put `toolResultBound.ts`
  in `dist/acp.js` and failed the build; reverted to the inline render, build
  green again.
- Duplication gate: the twin spill-directory listings failed `jscpd`
  (threshold 0); merged into one helper, 0 clones.

## 8. The person's steps (for the lead's real-life run)

Terminal (`acceptEdits` mode: the mode where the command tool IS offered,
because a plan-mode turn offers no command tool — the deleted e2e case's own
finding):

1. `muse-spark-code-acp exec --backend modelApi --key-stdin --mode acceptEdits --max-budget-usd 0.05 "run: node -e \"for(let i=0;i<200;i++){console.log('L'+i+'_'+'x'.repeat(20000))}\""` (about 4 MB on one command call; cheap model).
2. Observed: the turn completes; the answer says the output was cut and names
   the spill file; the request's recorded input tokens stay under the stated
   bound (per-result estimate plus a quarter of the remaining window — §2
   says which number is which); `.muse-spark/tool-results/<session>-<call>.txt`
   holds the full text; a second turn in the same session works from the
   intact conversation.

Editor session: open the chat panel on the Model API backend, same prompt;
observed: the row shows the plain-words preview with the spill path, the
answer carries the same notice, the file exists in the workspace, and the
next turn succeeds.

Above-window flag check (needs a model, so lead-run): the same command with
`--max-tool-output-bytes` past the model's whole window proceeds on the
default with the translated reason in a person notice and the log (unit
`validateToolResultCap` above-window case pins the refusal value).

## 9. What the lead must run or look up

- The dependent suites in §6's golden line: this sandbox blocks loopback, so
  socket suites fail here; the `vitest related` run over the touched files is
  recorded in the final message (NOT RUN HERE files listed first if blocked).
- `npm run package:acp` fails on this rig (`Required Darwin created-path
helper is missing: native/darwin/muse-dictate`, unbuilt); the packed proof
  below ran the built bundles directly instead.
- Packed proof (this lane, built `dist/`): `exec --max-tool-output-bytes 10`
  is refused with `below the readable floor of 1,024 bytes` (exit 2,
  translated); `1024` passes parse and proceeds (fails only on
  authentication, $0 spent); `--help` and `docs/reference.md` name the option
  and the setting (reference regenerated in this change).
- Above-window packed attempt (this lane, built `dist/`):
  `exec --backend modelApi --max-budget-usd 0.01 --max-tool-output-bytes 2000000 "hello"`
  with a dummy stdin key prints the language line, `message withheld: the
response did not complete`, and `[info] Authentication Required; requests
0; settled $0.000000` (exit 3). The value passes parse; the run stops at
  auth before any session exists. The window-fit refusal fires inside a live
  session when the first result is bound (`toolResultLimits`), after auth, so
  showing it packed needs a real key and a provider turn: lead-run (§8). No
  provider request was made here (requests 0).
- Official Muse Code `--max-tool-output-bytes` default: unpublished on the
  pages read; the lane uses 64,000 (today's behaviour).
- HUB files touched: `src/shared/constants.ts` (spill lifetime + age
  constant + notice sentence), `src/shared/l10n/en.ts` + 14 locales (preview
  sentence), `package.nls.json` (setting description). Integration run per
  the dependents rule.
- What TOOLCAP needs from `fix/provider-refusals`: §4 names it; nothing copied.

## 10. Review fixes (RVTOOLCAP, 2026-10-14 and 2026-10-17)

An independent review of this lane fixed, each with its proof:

- A raised byte guard now raises what one result may keep
  (`limitsForByteGuard`): before, the fixed 16,000-token estimate silently
  stayed in charge, so raising the setting changed nothing. Pure test keeps
  a 99,999-character result whole at a 128,000 guard that is cut at 64,000.
- The above-window refusal is judged against the model's whole window, not
  the room left: before, a cap that fits the window could be refused
  mid-session as the conversation grew, naming a window size that was not
  the model's.
- Recovery trims before it compacts for every proven overflow kind, and a
  trim-resend that is still too long falls through to compaction (at most
  three sends, as §4 states); before, count-based kinds skipped the trim and
  a failed trim-resend ended the turn.
- `headLines`/`tailLines` count whole lines only: before, a fragment the cut
  made inside a line counted as a kept line, so one line could be reported
  as two.
- `keptChars` counts original characters, not the `…` markers the cut adds
  (red drill: one 200,000-character line reported 8,000 kept where 7,999
  original characters are carried; CRLF case 16,001 for 15,999). A middle
  cut now marks where head meets tail with the same `…`, counted against
  the byte guarantee, so two fragments never read as one line the tool
  never printed. The notice says "about N tokens" (the estimate), counts
  whole lines as such, and no longer claims everything omitted was "in the
  middle" when only lines were cut. The person's preview no longer reads
  the original total as the amount kept.
- A spill write that fails (a read-only workspace) no longer ends the turn
  or reports a cap refusal that never happened: before, `writeSpill` emitted
  the cap-refusal sentence with an untranslated English reason and then
  threw out of the tool-call commit. Now the person gets a true translated
  sentence, the model gets the cut text with a notice naming no file
  (`toolResultCutNoSpill`), and the turn continues. The synchronous spill
  sites (sub-agent and restore notes) still name their deterministic path
  before the write lands; a failed write there is said to the person the
  same way, and a recall then keeps the packer's own failure.
