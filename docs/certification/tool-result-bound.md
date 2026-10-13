# TOOLCAP certification: one tool result can never end a conversation

Lane TOOLCAP, branch `fix/tool-result-bound`, base `38ef148f19` (release 0.18.1).
Tester: the lane agent on rig `macmini`, worktree `/Users/randy/lanes/TOOLCAP`.
No model calls: fake providers only. No sub-agents, no background tasks.

## 0. The measured case (lead, 2026-10-12, released code path, Model API backend)

One command-tool call (`grep -rIn -i "glimmer" …`, ten lines at most, some lines
megabytes long: one-line JSON captures) put about 940,000 tokens (~3.4 MB) into
request 11 (input 994,294; 941,455 cached). Request 12 reached 999,913 tokens.
The next request was refused: `prompt is too long: 1002881 tokens > 1000000
maximum`. Every resumed attempt was refused again (1002979, 1003048, 1003117):
nothing trimmed, dropped or compacted; automatic compaction is inactive
(`Automatic compaction is awaiting evaluation and is inactive.`). The single
result also cost about $2.35 of cache writes.

## 1. Part 1: what bounds exist today (before the change)

Measured on the base commit with a fake provider (a `bash` call returning
ten 400,000-character lines ≈ 4.0M chars; request index 1 is the first
request carrying the result; probe file created, run, read, then deleted —
base worktree `$TMPDIR/toolcap-base` at `38ef148f19`):

| run                                                            | characters in request 1's `function_call_output`     | form                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packing off                                                    | 32,014                                               | `clipMiddle` of the single stream to 32,000 chars around `\n[… output elided …]\n` (`TOOL_OUTPUT_ELIDED_MARKER`), plus `\n[exit code 0]`; the middle is dropped: no counts, no spill, not recoverable |
| packing on                                                     | 1,024                                                | pack placeholder (id, chars, lines, tokens, first/last lines) because 4.0M chars > `SHELL_PACKED_MAX_CHARS` (1,000,000); the full text stays in memory only, `recall_output` pages it back            |
| packing on, output 8k–1M chars (code-read, not measured)       | whole (up to 1,000,000 chars) on the first two sends | `OBS_PACK_WHOLE_SENDS` (2): rides whole twice, placeholder from the third send                                                                                                                        |
| model cannot pack (`canPack()` false) or reviewing (code-read) | whole, every send                                    | `body()` skips `packing.project`; the replay keeps the originals, so a restore re-sends them whole too                                                                                                |

Per-kind survey on the base (measured rows marked; the rest code-read with
the constant's file and line verified 2026-10-13; "model is told" = what the
model receives when the bound bites):

| kind                    | bound today                                                                                                                                                                   | unit          | applied                                                    | model is told                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| shell (`bash`)          | 64,000 (`TOOL_OUTPUT_MAX_CHARS`, constants.ts:3834; 32k per stream, middle-clip)                                                                                              | chars         | outcome (`shellText`); whole kept in replay iff packing    | elided marker, no counts, no recovery; or pack placeholder with counts + recall id |
| user shell (`!`)        | 64,000 at the outcome (`shellOutcome` default), then never packed                                                                                                             | chars         | outcome, then user-message note (`noteForModel`)           | elided marker in the row; the ≤64k note rides every request                        |
| `read_file`             | min(64k, half the context tokens in chars) (`readFileCharacterBudget`, tools.ts:977; fraction 1/2, constants.ts:2239); 2,000 lines default; 2,000 chars/line end-cut with `…` | chars/lines   | outcome, with offset/limit paging                          | `[lines x–y of z; offset=…]` trailer; pages forward, never the cut text            |
| `search`                | 200 results (`SEARCH_MAX_RESULTS`); 500 chars/hit (`SEARCH_HIT_MAX_CHARS`); 64k end-clip                                                                                      | lines/chars   | outcome                                                    | hit counts; `[output clipped]` marker, no recovery                                 |
| `list_files`            | 500 names default (`LIST_FILES_DEFAULT_LIMIT`); 64k end-clip                                                                                                                  | entries/chars | outcome                                                    | clipped rows, no recovery                                                          |
| `web_fetch`             | 5 MiB download (`WEB_FETCH_MAX_MIB`), 512 MiB convert-heap guard, explicit too-large refusal sentences; converted text rides whole as `function_call_output`                  | bytes/chars   | fetch layer, then send-time pack projection only           | refusal names the byte cap; an under-cap page rides whole (then pack rules)        |
| MCP tools               | 64k end-clip + marker (`clip`, mcp/functions.ts:491); name/description caps (`clipDescription`)                                                                               | chars         | outcome                                                    | `[output clipped]` marker, no recovery                                             |
| IDE/external tools      | 64k end-clip + marker (`clipOutput`, ModelApiHost.ts:2303)                                                                                                                    | chars         | outcome                                                    | `[output clipped]` marker, no recovery                                             |
| sub-agent replies       | summary ≤512 (`SUBAGENT_SUMMARY_MAX_CHARS`) + text ≤32,768 (`SUBAGENT_RESULT_TEXT_MAX_CHARS`), sliced parent-side — then never packed                                         | chars         | user-message note (`drainChildResults`)                    | clipped once; the ≤~33k note rides every request                                   |
| hook additional context | 16 KiB total hook output (`HOOK_OUTPUT_MAX_BYTES`, sliced before parse); contexts appended unbounded across turns, never packed                                               | bytes         | hook entry, then user-message notes (`appendHookContexts`) | passed through; accumulation counted for usage only                                |
| images/media            | `MediaBudget` projects per request                                                                                                                                            | mixed         | send projection                                            | `olderMediaOmitted`-style counts                                                   |
| verify/then_run         | note budgets (`VERIFY_NOTE_MAX_CHARS` 64k)                                                                                                                                    | chars         | note                                                       | clipped into the note                                                              |
| reviewer                | full observations retained (`isReviewing` skips packing, `body()`)                                                                                                            | —             | —                                                          | whole (tool-layer clips still apply)                                               |
| code intel answers      | ride the call-outcome path (no per-call cap line-surveyed)                                                                                                                    | —             | outcome                                                    | whatever the call returned                                                         |
| vault/plugin tools      | 64k end-clip + marker (tools.ts:2152)                                                                                                                                         | chars         | outcome                                                    | `[output clipped]` marker, no recovery                                             |

The measured hole, stated honestly: the exact entry path in the lead's
session was not captured, so its cause is NOT proven. Consistent with the
evidence (first send whole at ~940k tokens; second send whole at 999,913;
every resume refused a little larger) are: (a) packing constructed but
`canPack()` false for that model id (no tool-calling capability in model
facts and no paid-tier entry) while `wholeShellOutput` stays true — then
`body()` never projects and the whole text rides every send; (b) packing on
with the output just under `SHELL_PACKED_MAX_CHARS` but token-dense
(minified JSON: ~1 token/char), riding whole on exactly its first two sends.
The lane closes every candidate by construction (§3) and recovers when a
refusal still arrives (§4).

What the product did NOT have: a per-line cap on shell/MCP/hook/sub-agent/
fetch text (`read_file` is the only per-line cap: 2,000 chars, end-cut); a
cap relative to the model's remaining window for tool text (`read_file`'s
half-context budget is the only window-relative bound); a spill file
(packing keeps originals in memory only: never pageable by file tools); any
recognition of or recovery from the provider's `prompt is too long` refusal
(`classifyContextOverflow` only labels it; the turn fails).

## 2. The field, with sources

- Muse Code `--max-tool-output-bytes` on `muse exec`: refuses values below
  the readable floor; `0` disables the cap. Source: the official changelog
  (`https://dev.meta.ai/docs/muse-code/changelog`, "Muse Spark" entry: the
  flag rejects below the floor and `0` disables). The official default value
  is not published on the configuration or changelog pages read (network
  reached; page content searched 2026-10-12). The only numeric default seen
  is third-party: a workbench adapter passes `--max-tool-output-bytes
65536` (metartifact MCP hub,
  `https://github.com/metartifact/mcp-sparkdesk-hub`). The certification
  does not claim 65536 is official.
- Claude Code: `BASH_MAX_OUTPUT_LENGTH`, default 30,000 characters, hard
  ceiling 150,000; valid over-long results spill the full output to a file
  with a preview. Sources: nexus-hub policy doc (quotes the official
  environment-variable table), cc-triad-relay (full output auto-saved,
  visible middle-truncated).
- Codex CLI: middle-truncated command output with a
  `Warning: truncated output (original token count: N)` and
  `Total output lines: N` prefix; the full output is saved under
  `$TMPDIR/hook_outputs`. Sources: the multi-herdr Codex adapter (10k-token
  default, explicit spill path), the codex-relay skill (head+tail 1 MiB
  buffer).
- SoL-Pi ObservationPack (open harness, in-repo research
  `docs/research/competitive-landscape-2026-09.md`): results over 10 KiB ride
  whole twice, then a placeholder (id, size, first/last lines); `obs_recall`
  pages the original back. The product's own M73 packer follows this design.

Numbers chosen, each with its reason (also in the constant comments):

- Per result 16,000 estimated tokens (~64,000 chars at the product's
  4-chars-per-token rule): keeps today's 64k behaviour for ordinary results;
  sits between Claude Code's 30k chars and the 65,536 bytes Muse Code
  adapters pass.
- Per line 8,000 chars: the product's own `OBS_PACK_THRESHOLD_CHARS`; the
  measured failure was line length, not count.
- Window share 1/4 of the remaining room: the measured result took ~94% of
  the window; one result may never dominate a turn this way.
- Readable floor 1,024 bytes for the configured cap (refused below, with the
  reason; `0` does not disable: the invariant forbids a disable switch).
- Recovery sends at most 3: first attempt, one resend after trimming, one
  resend after compaction (`OVERFLOW_MAX_REQUEST_SENDS`, pinned by test).

## 3. Part 2: the bound, by construction

- One function: `boundToolResultText` in
  `src/core/backends/modelapi/toolResultBound.ts`. Every tool result passes
  it on its way into the conversation: `boundOutcome` at the finished-call
  choke (shell, reads, search, glob, fetch, MCP, IDE, code intel, plugin,
  reviewer, verify/then_run outcomes), `boundHookNote`/`appendHookContexts`
  (hook context), `noteForModel` (background and user-shell notes),
  `noteChildCut` (sub-agent replies, incl. restore), `noteSyncCut`
  (fork/restore copies), `trimLargestToolOutputs` (recovery). Under every cap
  the text returns byte-identical.
- A cut keeps the FULL runner/tool text in
  `.muse-spark/tool-results/<session>-<call>.txt` (workspace root, so file
  tools page it; `*.txt` git-ignored; deterministic names overwrite on
  retry). The model gets one line: totals, head/tail with the omitted middle
  counted, the longest line when lines were cut, and the exact paging
  (`recall_output id "<call>"` for character pages — including inside
  megabyte lines that line-paged reads cannot reach — or `read_file` with
  offset/limit). The person gets the same in plain words on the row.
- Guard: `test/unit/toolResultBoundGuard.test.ts` parses the sources for
  `function_call_output` constructions and tool-carrying `noteItem`s; any new
  site outside the bound fails. It also pins the caps lattice (no per-tool
  cap exceeds the choke) and the 3-send bound. Red drill: with the
  `boundOutcome` call commented out, the guard and the measured-case test
  fail; restored byte-exact (SHA-256 compared before/after).
- Setting `museSpark.modelApiMaxToolOutputBytes` (default 64,000, machine
  scope): validated where used — below the floor or past the model's whole
  window is refused with the reason (person notice + log) and the default
  applies. One-run raise: `exec --max-tool-output-bytes` (Model API only;
  below the floor refused at parse; window fit refused at runtime).
  `docs/reference.md` regenerated; README Limits documents both.

## 4. Part 3: recovery

- Typed refusal: `parsePromptTooLong` reads Anthropic's exact
  `prompt is too long: N tokens > M maximum` with N and M (digits only;
  every other wire shape keeps the existing `classifyContextOverflow`
  labels: Responses/Chat Completions `context_length_exceeded` and
  token-limit prose, Gemini quota/input-too-long prose — none observed with
  numbers, so the end sentence falls back to the short form there).
- Order, each proven by a request-counting test at the fake provider:
  (a) replace the largest riding results with the cut form (spills kept),
  send again once; (b) compact once through the existing entry when
  available (automatic compaction stays off: another lane evaluates it);
  (c) end the turn with the true sentence — the provider's own numbers, by
  how much, `/compact`, a larger-window model, or a new conversation —
  with the conversation intact (cuts kept spills; the next turn succeeds).
  At most 3 sends; the flags make a loop impossible.
- Restored sessions: recovery triggers at send time, so a session that was
  already past the window gets the same recovery on its next turn (covered
  by the trim path: pre-change whole outputs in a restored replay are cut
  with spills on refusal).
- When compaction is unavailable (default: evaluation inactive), trim-then-
  fail takes at most 2 sends.

## 5. Before / after the measured case

|                   | before (base)                                                                                                                                        | after (this lane)                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| request 1 carries | packing off: 32,014 chars, middle dropped silently; packing on: 1,024-char placeholder but 4.0 MB held in memory; unpackable model: whole every send | ~64k cut + one-line notice (counts, longest line, spill, recall id)                       |
| full result kept  | packing on: memory only; packing off: no                                                                                                             | spill file, full runner text, pageable                                                    |
| model told        | elided marker without counts, or placeholder                                                                                                         | how much, which head/tail, omitted count, longest line, exact paging                      |
| person told       | clipped rows                                                                                                                                         | plain-words preview with the spill path                                                   |
| refusal then      | turn fails `contextWindowFull`; resumes refused forever                                                                                              | trim → resend; compact → resend; else the true sentence with numbers; conversation usable |
| sends on refusal  | unbounded authoring, then stuck                                                                                                                      | ≤ 3, counted by test                                                                      |

Golden: requests without an oversized result stay byte-identical (16
behaviour tests + the repo's golden-request suite green; exact counts in the
final message).

## 6. Red drills (each seen to fail, then green)

- Choke bypass: `boundOutcome` call removed → guard test + measured-case
  test fail; restored.
- Line cap: 8,000 → 7,999 in a scratch edit → line-cap test fails; restored.
- Window share: share 1/4 → 1 (no share) → share test fails; restored.
- Recovery order: trim skipped → trim test fails (2 sends, no cut);
  restored. Refusal with a wrong message (`prompt too long` without numbers)
  → end sentence falls back to the short form (asserted).
- Guard: a new `function_call_output` literal in a scratch file → guard
  fails; removed.

## 7. What the lead must run or look up

- Loopback is blocked in this lane's sandbox (EPERM): suites that listen on
  127.0.0.1 fail here (acpModelApi image/webfetch, ideMcpServer). They must
  run outside the sandbox; the lane changed no socket code (probe: `node -e`
  listen → EPERM, recorded 2026-10-12).
- Official Muse Code `--max-tool-output-bytes` default: unpublished on the
  pages read; the cert uses 64,000 (today's behaviour, within 2.5% of the
  65,536 third-party value). Correct it if Meta publishes the default.
- Spills persist under git-ignored `.muse-spark/tool-results/` until the
  user removes the directory: ToolIo offers no delete, so no automatic
  removal exists. Restores page them. Recorded as a follow-up, not silent:
  the directory, the `.gitignore`, and this paragraph say so.
- `docs/research` had no Muse Code default; the field numbers above come
  from the live pages named, all read 2026-10-12.
