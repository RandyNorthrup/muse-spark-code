# M106 lane 0 contracts and model-text parser inventory

Base: `plan/m105-m107` at `1262a926`; decisions: PLAN.md D86 and M106.
The new schemas live in `src/shared/sideCallSchemas.ts`. They are formats
chosen by this harness for model answers, rather than inferred service
response envelopes. No call sites or paid gates change in lane 0.

| Model-text consumer       | Current reader and caller                                                                                                          | Lane 0 contract / disposition                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto approval reviewer    | `autoReviewer.ts:parseReviewerAnswer`; `reviewerEntry.ts:callReviewer`; Muse Code's `museCodeReviewer.ts` also uses the reader     | `reviewerAnswerSchema`: allow/ask, bounded nonblank reason. O1 keeps the existing permission fences and text fallback.                                                                    |
| Judge stated yes/no       | `judge/same/answers.ts:decodeJudgeReply` and `settleBatch`; `judge/techniques.ts:materialForStated`; both backends use this settle | `judgeNoulAnswerSchema`: yes/no and finite confidence in 0–100 percentage points. No permission grant.                                                                                    |
| Judge stated choice/score | Same reader, with the batch's known options                                                                                        | `judgeDistributionAnswerSchema(optionCount)`: exact length, finite 0–100 values, positive mass. The existing reader normalizes mass; a sum other than 100 is still usable.                |
| Prompt/agent hooks        | `hookModelEntry.ts:runHookModelTurn` returns text; `hookHandlers.ts:runModelHandler` sends it through `hooks.ts:parseHookAnswer`   | `hookDecisionSchema`: continue/block, nullable reason, nullable context; all fields required, no granting or input-rewriting fields. See adaptation below.                                |
| Commit draft              | `git/gitText.ts:commitMessageFrom`; `host/git/conversationGit.ts` consumes the held turn's reply                                   | `commitDraftSchema`: nonblank message; preserve it, then apply the caller's existing secret redactor and editable draft flow.                                                             |
| Pull-request draft        | `git/gitText.ts:pullRequestTextFrom`; the same held-turn caller                                                                    | `pullRequestDraftSchema`: nonblank bounded title and body (empty body allowed). Preserve the existing redaction/edit/confirmation flow.                                                   |
| Compaction                | `ModelApiHost.ts:runCompaction` collects text and inserts it into replay                                                           | `compactionSummarySchema`: C1's six required prose sections; host snapshots remain authoritative. The exact C1 seam and M106 rendering specification are in the upstream contract record. |
| Verify check claims       | `verifyLoop.ts` builds summaries from actual shell outcomes and skips; `verifyLedger.ts` tracks rounds                             | No parser of model-written check claims on this base. Dropped here per D86.3; O2 must inventory the M96c claim reader when its dependency is integrated.                                  |

Other inspected text paths do not need a side-answer schema: ordinary
chat/review/subagent output is displayed or replayed as text; tool arguments
are already separately validated; the voice protocol, persisted files,
imported configuration, shell directory reports, HTML and trace logs are
not machine-read model side answers. No title-generation side call exists
on this base. Local command parsers (`/goal`, `/review`, `/loop`, handoff)
read user input, not a model's answer.

For hooks, O1 adapts the canonical answer before the existing event-specific
reader: `block` becomes `{decision: 'block', reason}`; `continue` contributes
no permission decision. Non-null context becomes
`hookSpecificOutput: {hookEventName: currentEvent, additionalContext}`.
Null fields are omitted. The current reader still decides whether that
event may block or add context, and D83/M92 still guard settlement.
The schema cannot accept `allow`, `permissionDecision`, `updatedInput` or
unknown properties. A block requires a nonblank reason; a continue requires
null reason. The context is data, never a grant.

All contracts serialize through `z.toJSONSchema` to root objects with every
field required and `additionalProperties: false`. Zod refinements for
positive distribution mass and hook reason consistency are still validated
locally; JSON Schema generation does not replace that validation. O1 owns
mode selection by the actual capability record, one repair request, and the
old text fallback. `STRUCTURED_OUTPUT_REPAIRS_MAX` is 1.

The upstream records have now been read directly from `m95/caprec` and
`m101/c1fix`, without merging. [The exact contracts and upstream commits](m106-upstream-contracts.md)
name M95's `ModelCapabilityRecord`, `Known<T>` and `CapabilityEvidence`,
the applicable `hosted.maxToolCalls` patch, and C1's actual private summary
metadata schemas and host seam. C1 has no exported structured-answer type
or deterministic Markdown renderer; M106's six-section answer and fixed
rendering specification preserve C1's host snapshots and replay wrapper.
Unknown providers keep the upstream resolver's conservative default.

UI handoff: `en.ts` and every `l10n/ui.*.json` have 26 new translated keys.
`docs/research/m106-manifest-strings.json` holds the three setting-description
translations for English and all 14 locales. Lane W owns `package.json`,
so the descriptions are staged as data until it adds the three planned
machine-scoped setting references. Adding unused keys to `package.nls*.json`
would correctly fail the localization gate. No manifest or default is
silently changed in another lane's file.

The defaults are four parallel reads, one continuation, three repetitions,
16,000 preview characters, five hosted calls (range 1–20), and a provisional
ten startup fan-out requests per minute. The legacy 32,768 output constant
and existing requests are unchanged; lane L2 applies the selected record's
131,072 recommended Meta cap with the budget clamp. Repeat and continuation
model notes live in `MODEL_API_MODEL_TEXT`, its existing lazy block, so D6
does not carry unused model text into activation.

These shared core contracts are usable by every editor, ACP and headless.
They import no `vscode`, add no paid path or host-only feature, and introduce
no dependency or escape hatch. Lanes O1/O2/H/L1/L2/R/S and W own actual
behavior and final documentation, including CHANGELOG and README.
