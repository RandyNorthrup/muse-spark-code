# plan-format v1

`readPlan(text, evidence?)` is a pure reader. It returns `facts: PlanFacts`,
the section and decision inventories, and the validated ledger when present.
It performs no filesystem, Git, network, model, credential or clock access.
S supplies text and captured lane evidence; K consumes the facts;
R scrubs rendered output again before hashing. VS Code, native hosts, ACP,
the companion and the CLI use this same reader through the reporting engine.

The gate uses that reader directly:

```sh
npm run check:plan
node scripts/check-plan.mjs PLAN.md M12
```

It checks the entire file, with no baseline, ignored ids or grandfathered
rows. A drift exits 1 and prints `PLAN.md:<line>`, the localized Plan format
message and the diagnostic code. Exact selection exits 0; an unknown id
exits 3 with the two nearest ids. Invalid arguments exit 2; an unreadable
file exits 1. A document with neither format returns `format: none`, allowing
the project report's other sources to remain available. JSON is decoded before
validation; every returned string (including diagnostic paths and the ledger)
has Unicode escapes resolved before the shared credential scrub. The gate
scrubs final diagnostics and selection output again, and never echoes
filesystem error details. UTF-8 input above `REPORT_PLAN_MAX_BYTES` (4 MiB)
returns `input-size` drift with the technical byte limit, never an empty
success. The gate checks file size before reading and caps the read at the
limit plus one byte even if the file grows. Parsing indexes headings once
and uses sets for duplicate ids rather than rescanning prior milestones.
Folded status continuations are scanned once, and ledger evidence is indexed
by acceptance id and passing check kind instead of searched for each check.

## Grammar

Line numbers are one-based. CRLF and LF give the same facts. Backtick and
tilde fences mask examples without changing locations; escaped pipes and
pipes inside code spans stay in their GFM table cells.

| Record            | Accepted form                                                                                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section           | `## <number>. <title>`; section numbers are unique                                                                                                                                                                                                             |
| Decision          | `### D<number>[lowercase suffix] — <title>`; today's numbered subdecision `D89.5` is also explicit                                                                                                                                                             |
| Milestone         | `### M<number><lowercase suffix> — <title>`; uppercase working ids such as `CIFIX14C`; current range headings such as `M43–M56`; current `M26 follow-up` gets the distinct id `M26-follow-up`                                                                  |
| Other §6 headings | `### Delivery order (<date>)` and `### 6.0 Standard certification checklist (<note>)`; arbitrary level-three headings fail                                                                                                                                     |
| Status            | `**Status YYYY-MM-DD[ (<note>)]: <phrase>[.]**`; current dated `- **Status …**` list rows are accepted too                                                                                                                                                     |
| Status phrases    | Every dated phrase in the October 6 file is enumerated in `statusPhrases.ts`, alongside the nine canonical states. Whitespace and one terminal period are normalized; the whole phrase must match. Historical/superseded notes do not override the current row |
| Checklist         | `- [ ]` / `- [x]`; indented continuation text stays with its item                                                                                                                                                                                              |
| Fields            | `- **Goal.**`, `- **Depends on.**`, `- **Gates.**`; multiline field bodies are retained, milestone dependencies and declared gate names are extracted                                                                                                          |
| Lanes             | GFM tables are established by delimiter rows at any list indentation; lane tables have `Lane` or `Lane / receipt` in their first column. Enumerated columns, duplicate/unknown columns, delimiter width and data-row width are checked                         |
| Questions         | §3's `- **Q-<id> …**` and `### Q-<id> …`; legacy colon and title/date variants and the full decision text are retained. Explicit Resolved, Answered, Decided or Owner answer markers set the existing `answered` state                                         |
| Escape hatches    | All §8 GFM data rows, including repeated/indented tables; delimiter-established headers are excluded regardless of their names. Source text and associated milestone ids are retained                                                                          |
| Residuals         | §9's bullet records and their continuations                                                                                                                                                                                                                    |
| Releases          | §10's version/date headings, bold version/date records, published/released/preparation variants, and the original dated 0.1.0 status record; full record text is retained                                                                                      |
| Delivery          | `N. **<item>** [ (<note>)] — <reason>. Needs: <items>.`, with folded lines; ordinals are consecutive. Versioned release trains have their own version id                                                                                                       |

Drift facts are `{code, line, detail}`. They are the input for K's localized
`reportLabels.planFormat` row and the CLI's `reportUi.planDrift` message;
invalid records are never assigned a guessed state. Codes cover unknown
milestone headings, wrong milestone sections, duplicate sections or milestone
ids, missing/malformed/unknown statuses, table delimiters, lane columns/rows,
ambiguous lane evidence, delivery form, unparseable primary Needs and input size.

Milestone ids are exact and case-insensitive, with `M` optional for numeric
ids. Suggestions use Levenshtein distance and code-unit id ordering. They do
not select a milestone. Dependencies include declared working ids and lane
references (`M12:P`, `m12/p`, `M12's lane P`; multiple qualified lanes are
retained). Next steps preserve delivery order and require every
primary Need to be complete, merged, released or superseded; definitive
release records satisfy version dependencies, while preparation records stay
visible without declaring a release complete. The initial legacy release
gets its version from the record's explicit `v<version>`, never a preset.
In today's annotated Needs
prose, the first clause before a semicolon or lane-specific `for`, `with` or
`whose` describes the primary prerequisites; the full prose remains in
`reason` for consumers that need its conditional detail. An unparseable
primary clause produces `delivery-needs` drift and its entry is withheld from
next steps. A qualified lane requires that exact lane's merged evidence or
its entire milestone's completed state; a building prerequisite stays blocked.

## Lane evidence

The injected `PlanEvidence` provides normalized branch refs with ancestry,
PR number/branch/state and certification paths. S owns Git capture and
ancestry; N owns the captured PR boundary. Ref normalization covers local
and remote refs, including the captured `l0` spelling for lane zero (the
brief's `m113/l0` base). Certification paths normalize Windows separators before
matching `docs/certification/m<id>-<lane>.md`, then `m<id>.md`.

| Evidence                                                      | State        |
| ------------------------------------------------------------- | ------------ |
| Matching branch is an ancestor of the default branch          | `merged`     |
| Open PR names a matching lane branch, even without local refs | `inReview`   |
| Matching branch exists                                        | `inProgress` |
| No matching branch                                            | `planned`    |

Certification alone does not prove a branch exists or merged. A lane's
declared prose never establishes its state. Branch and PR evidence pair only
when their branch names match exactly after ref-prefix normalization (branch
case is retained). One exact pair selects that evidence, including a newer
unmerged branch instead of a historical merged branch. Multiple candidates
without one exact pair, multiple open PRs for it, or conflicting ancestry
produce `lanes-ambiguous` drift and no selected branch/PR. Sorting is stable.

## quality-ledger v1

The dedicated `quality-ledger` fence is authoritative when present. Exactly
one closed fence is required. JSON is parsed as unknown and validated by
the strict zod schema before use; malformed JSON, wrong versions, unknown
fields, unsupported task/evidence words, duplicate JSON keys or ids and dangling
references produce located drift. The shape follows the vendored
`scripts/delivery/reader.py` and model, including the work, requirements,
acceptance, tasks, evidence, checkpoint and red-proof records. The vendored
change action is `create`; lane 0's frozen fixture also declares `add`, which
is accepted explicitly. Check commands are inert data, never executed.
Every reference is checked in its own id namespace, including requirement
and task `superseded_by` and checkpoint `verified_tasks`, using indexed ids.

The result retains the complete ledger, and projects its work/requirements
and acceptance into `PlanFacts`. Task states determine progress; each
acceptance item needs passing evidence of every declared kind to be marked
done. No absent Git ancestry is invented for ledger tasks. The ledger has
no status date, so that fact is the empty string rather than the current
clock or an invented observation.
