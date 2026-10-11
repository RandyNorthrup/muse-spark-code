# M106 contracts against M95 and M101 C1 (2026-10-05)

Read with `git show` and `git grep`, without merging or changing either ref:

- `m95/caprec` at `e013dffb52049914d3aadd604ba32ec79a328ed4`:
  `src/core/providers/capabilityRecord.ts` and `docs/certification/m95-n.md`.
- `m101/c1fix` at `9cf6a4c47ad0444ca78898f1a3dce763d03fd4cc`:
  `src/core/backends/modelapi/ModelApiHost.ts`, `src/shared/constants.ts`
  and `docs/certification/m101-c1.md`.

## Hosted bounds: M95's record, not a second resolver

The exact upstream exports are `ModelCapabilityRecord`, `Known<T>`,
`CapabilitySource`, `CapabilityOverrides`, `CapabilityEvidence` and
`resolveModelCapabilities`. M106 extends `ModelCapabilityRecord['hosted']`
with **`maxToolCalls: Known<true>`**, using the existing private `flag`
schema. This states support for a per-response hosted-call bound; it is not
the request's configured count or a claim about function-call limits.

[The applicable patch](m106-capability-record.patch) adds that field to
`hostedSchema` and its conservative resolver default. Its inferred override
type and existing source indexing then work without further duplication.
The patch is against the exact named upstream file, which is absent from
this lane's base. It is supplied for the integration branch rather than
copying the provider subsystem or merging another lane here.

Feed captured Meta support through the existing resolver as
`CapabilityEvidence` with this payload:

```json
{
  "source": {
    "kind": "capture",
    "ref": "test/fixtures/m106/u8-hosted-bound.json#seq=34",
    "at": "2026-10-05"
  },
  "fields": {
    "hosted": {
      "maxToolCalls": {
        "state": "yes",
        "value": true,
        "source": {
          "kind": "capture",
          "ref": "test/fixtures/m106/u8-hosted-bound.json#seq=34",
          "at": "2026-10-05"
        }
      }
    }
  }
}
```

U8 establishes this for `muse-spark-1.3-contributor`, the captured native
model. It does not establish support for every Meta model or every Responses
provider. Unknown records keep `state: 'unknown'`; a captured refusal can
use `state: 'no'`. `sources['hosted.maxToolCalls']` names the same capture.
The existing priority remains user > capture > models-list > catalogue >
preset, and unknown cannot erase evidence. Lane H checks this field together
with the selected record's `hosted.webSearch` before admitting a bounded
search. A search request still uses the configured integer bound; a returned
count above it remains fully settled and reported. Other providers require
their own evidence.

O1 uses `ModelCapabilityRecord['output']['formats']`, a
`Known<Array<'text' | 'json_object' | 'json_schema' | 'strict_schema' |
'forced_tool'>>`: select strict schema, schema, forced tool, then the current
text parser, in that order, only from `state: 'yes'` values. L1 reads
`tools.streamingArguments`; L2 reads `output.maxTokens`. U10 supports strict
schema only for its captured model. M106 adds no replacement boolean record.

## Summary: C1's prose and host assertions remain separate

C1 does **not** export a `StructuredSummary` type, answer zod schema, or
fixed Markdown renderer. Its structured prompt is the six-heading English
`MODEL_API_MODEL_TEXT.compactionPrompt` in `src/shared/constants.ts`:
Goal, Constraints, Progress (completed, in progress, blocked), Decisions,
Next steps, Critical context. `compactionUpdatePrompt` retains those headings.
`ModelApiSession.runCompaction` in `ModelApiHost.ts` collects free Markdown.
It then assembles replay with `compactionPrefix`, that prose, the host
snapshot and the retained whole-turn tail.

M106's `compactionSummarySchema` in `src/shared/sideCallSchemas.ts` therefore
requires exactly six nonblank strings: `goal`, `constraints`, `progress`,
`decisions`, `nextSteps`, `criticalContext`. Progress describes completed,
in-progress and blocked work. A section with no facts says so explicitly.
No `todos`, `read`, `modified` or `keptEntries` is accepted from the model.
The schema is strict, every field is required, and parsed strings are kept
verbatim, including exact paths, errors and untrusted-content labels.

O1's deterministic Markdown rendering is specified as the concatenation
below (literal LF characters, fixed order, no trailing LF added):

```text
## Goal\n\n{goal}\n\n## Constraints\n\n{constraints}\n\n## Progress\n\n{progress}\n\n## Decisions\n\n{decisions}\n\n## Next steps\n\n{nextSteps}\n\n## Critical context\n\n{criticalContext}
```

Only the model prose slot changes. C1's private `compactionFilesSchema`
(`read: string[]`, `modified: string[]`, optional nonnegative integer
`keptEntries`) and `compactionMetadata()` keep reading the host-generated
JSON line after the exact `compactionFiles` delimiter. `compactionFiles()`
derives paths from successful effective tool arguments. The snapshot also
contains unfinished host todos after the `compactionTodos` delimiter;
neither list comes from this answer. O1 must preserve C1's exact snapshot
bytes, wrapper, tail, retry/admission fences and budget.

There is no existing deterministic C1 prose renderer whose bytes can be
claimed unchanged. O1 certifies the new renderer with a fixed-answer golden,
while comparing C1's unchanged wrapper/snapshot/tail bytes. Invalid JSON,
invalid sections, repair failure or rendering failure takes the current text
summary path and must not prevent compaction. The existing C1 tool-return
fallback remains separate from M106's one structured-answer repair.

C1's exact engine seam is `ModelApiHostDeps['compactionModel']`; its return
uses `ModelRow['contextTokens']`, `Pick<ModelCapabilities, 'toolCalling'>`,
`keepToolsWithHistory` and `FormatQuirks['reasoningReplay']`. That narrow
seam does not expose `output.formats`: O1's integration must obtain the
selected full M95 record, without inferring format support from this seam.
`CompactOutcome` in `src/core/agent/agentBackend.ts` is C1's operation
result, not the model answer type.

These contracts are shared core data and apply equally to all editors,
ACP and headless. Lane 0 enables no new paid request or UI action.
