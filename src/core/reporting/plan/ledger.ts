import * as z from 'zod/mini'
import { REPORT_MAX_ROWS, REPORT_MAX_TEXT_CHARS } from '../../../shared/constants'
import type { PlanFacts, PlanMilestone } from '../sources/types'

const text = z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS))
const id = z.string().check(z.regex(/^[A-Za-z][A-Za-z\d_.:-]*$/))
const texts = z.array(text).check(z.maxLength(REPORT_MAX_ROWS))
const ids = z.array(id).check(z.maxLength(REPORT_MAX_ROWS))
const optionalText = z.nullable(text)
const count = z.number().check(z.int(), z.nonnegative())
const environment = z.strictObject({ platform: text, tools: z.record(text, text) })
const digest = z.string().check(z.regex(/^[a-f\d]{64}$/))
const fingerprint = z.strictObject({ path: text, sha256: z.nullable(digest) })
const fingerprints = z.array(fingerprint).check(z.maxLength(REPORT_MAX_ROWS))
const requirement = z.strictObject({
  id,
  statement: text,
  priority: text,
  acceptance: ids,
  superseded_by: z.nullable(id),
})
const acceptance = z.strictObject({
  id,
  requirement: id,
  given: text,
  when: text,
  // eslint-disable-next-line unicorn/no-thenable -- quality-ledger v1's declarative outcome field is a zod schema, never a promise callback (PLAN §8, M113-P).
  then: text,
  checks: z.array(z.enum(['behavior', 'red', 'manual', 'readiness'])),
  manual_reason: optionalText,
})
const task = z.strictObject({
  id,
  purpose: text,
  acceptance: ids,
  depends_on: ids,
  // "create" is the vendored v1 spelling; lane 0's frozen fixture uses "add".
  changes: z.array(
    z.strictObject({ path: text, action: z.enum(['create', 'add', 'modify', 'delete']) }),
  ),
  status: z.enum(['planned', 'active', 'blocked', 'implemented', 'verified', 'superseded']),
  evidence: ids,
  blocker: optionalText,
  superseded_by: z.nullable(id),
})
const evidence = z.strictObject({
  id,
  acceptance: ids,
  kind: z.enum(['behavior', 'red', 'manual', 'readiness']),
  status: z.enum(['pass', 'fail', 'deferred', 'stale']),
  command: texts,
  method: text,
  environment,
  exit_code: z.nullable(z.number().check(z.int())),
  artifact: z.nullable(fingerprint),
  inputs: fingerprints,
  scope_sha256: z.nullable(digest),
  reason: optionalText,
  red: z.nullable(
    z.strictObject({
      mutation: text,
      baseline_exit: count,
      mutated_exit: count,
      restored_exit: count,
      expected_diagnostic: text,
      observed_diagnostic: text,
      before: fingerprints,
      mutated: fingerprints,
      after: fingerprints,
    }),
  ),
})

/** v1's fields mirror the vendored delivery reader; commands remain inert data. */
const qualityLedgerSchema = z.strictObject({
  schema_version: z.literal(1),
  work: z.strictObject({
    id,
    title: text,
    scope_revision: z.number().check(z.int(), z.positive()),
    brief: optionalText,
    brief_reason: optionalText,
    rules: z.array(z.strictObject({ path: text, revision: text })),
    inputs: texts,
    environment,
  }),
  requirements: z.array(requirement).check(z.maxLength(REPORT_MAX_ROWS)),
  acceptance: z.array(acceptance).check(z.maxLength(REPORT_MAX_ROWS)),
  tasks: z.array(task).check(z.maxLength(REPORT_MAX_ROWS)),
  evidence: z.array(evidence).check(z.maxLength(REPORT_MAX_ROWS)),
  checkpoint: z.nullable(
    z.strictObject({
      scope_sha256: digest,
      inputs: fingerprints,
      environment,
      verified_tasks: ids,
      pending_operations: z.array(z.strictObject({ id, description: text, next_action: text })),
      next_action: text,
      source_revision: optionalText,
    }),
  ),
})
export type QualityLedger = z.infer<typeof qualityLedgerSchema>

// JSON.parse validates syntax first; this token walk refuses overwritten keys,
// including escaped spellings, before zod can see only the last value.
function hasDuplicateJsonKeys(json: string): boolean {
  const stack: (Set<string> | null)[] = []
  for (const token of json.matchAll(/"(?:\\.|[^"\\])*"|[{}[\]]/g)) {
    const word = token[0]
    if (word === '{') {
      stack.push(new Set())
      continue
    }
    if (word === '[') {
      stack.push(null)
      continue
    }
    if (word === '}' || word === ']') {
      stack.pop()
      continue
    }
    if (
      !json
        .slice(token.index + word.length)
        .trimStart()
        .startsWith(':')
    )
      continue
    const key: unknown = JSON.parse(word)
    const keys = stack.at(-1)
    if (typeof key !== 'string' || !keys) continue
    if (keys.has(key)) return true
    keys.add(key)
  }
  return false
}

const TASK_STATES: Record<QualityLedger['tasks'][number]['status'], PlanMilestone['status']> = {
  planned: 'planned',
  active: 'building',
  blocked: 'waiting',
  implemented: 'built',
  verified: 'complete',
  superseded: 'superseded',
}

export function readLedger(
  json: string,
  line: number,
): { ledger: QualityLedger | null; facts: PlanFacts } {
  const facts: PlanFacts = {
    format: 'quality-ledger-v1',
    milestones: [],
    questions: [],
    risks: [],
    residuals: [],
    releases: [],
    deliveryOrder: [],
    drift: [],
  }
  let value: unknown
  try {
    value = JSON.parse(json)
    if (hasDuplicateJsonKeys(json)) throw new Error('quality-ledger duplicate key')
  } catch {
    return {
      ledger: null,
      facts: { ...facts, drift: [{ code: 'ledger-json', line, detail: 'quality-ledger' }] },
    }
  }
  const parsed = qualityLedgerSchema.safeParse(value)
  if (!parsed.success)
    return {
      ledger: null,
      facts: {
        ...facts,
        drift: parsed.error.issues.map((issue) => ({
          code: 'ledger-schema',
          line,
          detail: issue.path.join('.'),
        })),
      },
    }
  const ledger = parsed.data
  const drift: { code: string; line: number; detail: string }[] = []
  const uniqueIds = (records: readonly { readonly id: string }[], field: string) => {
    if (new Set(records.map(({ id }) => id)).size !== records.length)
      drift.push({ code: 'ledger-duplicate', line, detail: field })
  }
  uniqueIds(ledger.requirements, 'requirements')
  uniqueIds(ledger.acceptance, 'acceptance')
  uniqueIds(ledger.tasks, 'tasks')
  uniqueIds(ledger.evidence, 'evidence')
  const references = (
    values: readonly string[],
    records: readonly { readonly id: string }[],
    field: string,
  ) => {
    for (const value of values)
      if (records.every(({ id }) => id !== value))
        drift.push({ code: 'ledger-reference', line, detail: `${field}: ${value}` })
  }
  for (const entry of ledger.requirements) references(entry.acceptance, ledger.acceptance, entry.id)
  for (const entry of ledger.acceptance)
    references([entry.requirement], ledger.requirements, entry.id)
  for (const entry of ledger.tasks) {
    references(entry.acceptance, ledger.acceptance, entry.id)
    references(entry.depends_on, ledger.tasks, entry.id)
    references(entry.evidence, ledger.evidence, entry.id)
  }
  for (const entry of ledger.evidence) references(entry.acceptance, ledger.acceptance, entry.id)
  let status: PlanMilestone['status'] = ledger.tasks.some(
    ({ status }) => status === 'implemented' || status === 'verified',
  )
    ? 'built'
    : 'planned'
  if (ledger.tasks.length > 0 && ledger.tasks.every(({ status }) => status === 'superseded'))
    status = 'superseded'
  if (ledger.tasks.length > 0 && ledger.tasks.every(({ status }) => status === 'verified'))
    status = 'complete'
  if (ledger.tasks.some(({ status }) => status === 'active')) status = 'building'
  if (ledger.tasks.some(({ status }) => status === 'blocked')) status = 'waiting'
  return {
    ledger,
    facts: {
      ...facts,
      drift,
      milestones: [
        {
          id: ledger.work.id,
          title: ledger.work.title,
          status,
          date: '',
          goal: ledger.requirements.map(({ id, statement }) => `${id}: ${statement}`).join('\n'),
          dependencies: [],
          requiredGates: [],
          checklist: ledger.acceptance.map((entry) => ({
            text: `${entry.id}: ${entry.given}; ${entry.when}; ${entry.then}`,
            done:
              entry.checks.length > 0 &&
              entry.checks.every((kind) =>
                ledger.evidence.some(
                  (proof) =>
                    proof.acceptance.includes(entry.id) &&
                    proof.kind === kind &&
                    proof.status === 'pass',
                ),
              ),
          })),
          lanes: ledger.tasks.map((task) => ({
            id: task.id,
            scope: `${TASK_STATES[task.status]}: ${task.purpose}`,
            branch: null,
            state:
              task.status === 'planned' || task.status === 'superseded' ? 'planned' : 'inProgress',
            pullRequest: null,
            certification: null,
            hours: null,
          })),
        },
      ],
    },
  }
}
