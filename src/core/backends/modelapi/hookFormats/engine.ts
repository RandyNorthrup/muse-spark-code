// The one interpreter of every vendor contract table (contract.ts). Vendor
// modules hold data; the invariants live here once and the property suite
// proves them over every row:
// - a documented veto is scanned on the raw output before strict validation,
//   so an invalid or unsupported sibling field never turns it into failed;
// - a veto keeps the answer's independent user warning and context;
// - nothing here ever produces an allow grant (approvalDecision/permission allow);
// - failClosed upgrades failures only on rows that declare it;
// - stdin values come only from named transforms; missing required data refuses.
import { HOOK_TOOL_OUTPUT_PREVIEW_CHARS } from '../../../../shared/constants'
import {
  type AdapterOptions,
  type EventRow,
  type FieldSpec,
  type ForeignHookAnswer,
  type InputCondition,
  type OutputMatch,
  type ResultRule,
  type ResultSpec,
  type VendorContract,
} from './contract'
import {
  type AdapterEvent,
  type ForeignStdinResult,
  blockReason,
  isRecord,
  jsonOutput,
  textField,
} from './core'
import { applyTransform, toolClassOf, type TransformResult } from './transforms'

const EVENT_NAME_SOURCE = '@event'

export function pathValue(root: unknown, dotted: string): unknown {
  let current: unknown = root
  for (const key of dotted.split('.')) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

function setPath(target: Record<string, unknown>, dotted: string, item: unknown): void {
  const keys = dotted.split('.')
  const last = keys.pop()
  if (last === undefined) return
  let current = target
  for (const key of keys) {
    const next = current[key]
    if (isRecord(next)) current = next
    else {
      const created: Record<string, unknown> = {}
      current[key] = created
      current = created
    }
  }
  current[last] = item
}

export type RowSelection =
  { readonly ok: true; readonly row: EventRow } | { readonly ok: false; readonly reason: string }

/**
 * The row for this event: same flavor; the imported source event when the
 * record names one (else a default row); then the row that translates the
 * call's tool. A named source event whose row does not fit the tool refuses,
 * and a build for tool-specific rows refuses a call without a tool name.
 */
export function selectRow(
  contract: VendorContract,
  event: AdapterEvent,
  options: AdapterOptions | undefined,
  tool: string | undefined,
  requiresTool = false,
): RowSelection {
  const flavor = options?.flavor ?? contract.defaultFlavor
  const source = options?.sourceEvent
  const rows = contract.rows.filter(
    (row) =>
      row.muse === event &&
      (row.flavor ?? contract.defaultFlavor) === flavor &&
      (source === undefined
        ? row.selection === 'default'
        : row.vendor === source || row.aliases?.includes(source) === true),
  )
  const first = rows[0]
  if (first === undefined)
    return {
      ok: false,
      reason: `${contract.vendor}: ${event} has no ${source ?? 'default'} event${flavor === undefined ? '' : ` (${flavor})`}`,
    }
  if (tool === undefined)
    return requiresTool && first.tools !== undefined
      ? { ok: false, reason: `${contract.vendor}: ${first.vendor} needs a tool name` }
      : { ok: true, row: first }
  const toolClass = toolClassOf(tool)
  const fit = rows.find((row) => row.tools === undefined || row.tools.includes(toolClass))
  return fit === undefined
    ? { ok: false, reason: `${contract.vendor}: ${first.vendor} does not translate ${tool}` }
    : { ok: true, row: fit }
}

function sourceValue(
  spec: FieldSpec,
  row: EventRow,
  payload: Readonly<Record<string, unknown>>,
): unknown {
  if (spec.value !== undefined) return spec.value
  const sources = typeof spec.from === 'string' ? [spec.from] : (spec.from ?? [spec.to])
  for (const source of sources) {
    const found = source === EVENT_NAME_SOURCE ? row.vendor : pathValue(payload, source)
    if (found !== undefined) return found
  }
  return undefined
}

function fieldResult(
  spec: FieldSpec,
  row: EventRow,
  payload: Readonly<Record<string, unknown>>,
  options: AdapterOptions | undefined,
): TransformResult {
  const candidate = sourceValue(spec, row, payload)
  return applyTransform(spec.transform ?? 'copy', candidate, {
    payload,
    options,
    toolNames: row.toolNames,
  })
}

export function buildStdin(
  contract: VendorContract,
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
  options: AdapterOptions | undefined,
): ForeignStdinResult {
  const refusedKey = contract.refusedPayloadKeys?.find((key) => payload[key] !== undefined)
  if (refusedKey !== undefined)
    return { outcome: 'refused', reason: `${contract.vendor}: ${refusedKey} is refused` }
  const selection = selectRow(contract, event, options, textField(payload, 'tool_name'), true)
  if (!selection.ok) return { outcome: 'refused', reason: selection.reason }
  const gated = contract.gate?.(payload, options)
  if (gated !== undefined) return gated
  const { row } = selection
  const stdin: Record<string, unknown> = {}
  for (const spec of [...contract.common, ...row.fields]) {
    const result = fieldResult(spec, row, payload, options)
    const where = `${contract.vendor} ${row.vendor}: ${spec.to}`
    if (result.kind === 'refused')
      return { outcome: 'refused', reason: `${where}: ${result.reason}` }
    if (result.kind === 'absent') {
      if (spec.required === true) return { outcome: 'refused', reason: `${where} is required` }
    } else setPath(stdin, spec.to, result.value)
  }
  return { outcome: 'run', stdin: JSON.stringify(stdin) }
}

function isMatched(match: OutputMatch, output: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(match).every(([key, expected]) => {
    const actual = pathValue(output, key)
    return typeof expected === 'object'
      ? typeof actual === 'string' && expected.includes(actual)
      : actual === expected
  })
}

function inputHolds(condition: InputCondition | undefined, options: AdapterOptions | undefined) {
  if (condition === undefined) return true
  const input = options?.input
  if (input === undefined) return false
  if ('toolClass' in condition) {
    const tool = textField(input, 'tool_name')
    return tool !== undefined && toolClassOf(tool) === condition.toolClass
  }
  return pathValue(input, condition.path) === condition.equals
}

function nonEmptyText(output: unknown, key: string): string | undefined {
  const found = pathValue(output, key)
  return typeof found === 'string' && found.trim() !== '' ? found.trim() : undefined
}

/** User warnings and context survive every outcome, a veto included. */
function observations(
  rules: readonly ResultRule[],
  output: Readonly<Record<string, unknown>>,
): Partial<ForeignHookAnswer> {
  let context: string | undefined
  let systemMessage: string | undefined
  for (const rule of rules) {
    if (rule.kind === 'context') context ??= nonEmptyText(output, rule.field)
    else if (rule.kind === 'message') systemMessage ??= nonEmptyText(output, rule.field)
  }
  return {
    ...(context !== undefined && { context }),
    ...(systemMessage !== undefined && { systemMessage }),
  }
}

function vetoOf(
  spec: ResultSpec,
  output: Readonly<Record<string, unknown>>,
  options: AdapterOptions | undefined,
  stderr: string,
): ForeignHookAnswer | undefined {
  for (const rule of spec.rules) {
    if (rule.kind !== 'veto' || !isMatched(rule.match, output) || !inputHolds(rule.when, options))
      continue
    const followup = rule.nonEmpty === undefined ? undefined : nonEmptyText(output, rule.nonEmpty)
    if (followup === undefined && rule.nonEmpty !== undefined) continue
    const fromOutput = rule.reason.map((key) => nonEmptyText(output, key)).find(Boolean)
    const fromStderr = spec.ignoreStderr === true ? '' : stderr.trim()
    const reason = followup ?? fromOutput ?? (fromStderr === '' ? rule.fallback : fromStderr)
    const isStops =
      rule.stop === true || (rule.interrupt !== undefined && output[rule.interrupt] === true)
    return {
      ...observations(spec.rules, output),
      status: 'blocked',
      reason,
      ...(isStops && { stopReason: reason }),
      ...(rule.approval === 'deny' && { approvalDecision: 'deny' }),
    }
  }
  return undefined
}

function invalid(spec: ResultSpec, isFailClosed: boolean): ForeignHookAnswer {
  if (spec.invalid === 'ignore') return { status: 'completed' }
  return isFailClosed || spec.invalid === 'block'
    ? { status: 'blocked', reason: `${spec.label}: invalid response` }
    : { status: 'failed', reason: `${spec.label}: invalid or unsupported output` }
}

function collect(
  spec: ResultSpec,
  output: Readonly<Record<string, unknown>>,
  options: AdapterOptions | undefined,
): ForeignHookAnswer {
  let answer: ForeignHookAnswer = { status: 'completed', ...observations(spec.rules, output) }
  for (const rule of spec.rules) {
    if (rule.kind === 'ask' && isMatched(rule.match, output))
      answer = { ...answer, permissionDecision: 'ask' }
    else if (rule.kind === 'updatedInput') {
      const updated = pathValue(output, rule.field)
      if (isRecord(updated)) answer = { ...answer, updatedInput: updated }
    } else if (rule.kind === 'replacement' && inputHolds(rule.when, options)) {
      const found = pathValue(output, rule.field)
      const replaced = rule.textPath === undefined ? found : pathValue(found, rule.textPath)
      if (typeof replaced === 'string' || isRecord(replaced))
        answer = { ...answer, replacement: { target: rule.target, value: replaced } }
    } else if (rule.kind === 'custom') {
      const result = rule.apply(output)
      if (!result.ok) return { status: 'failed', reason: `${spec.label}: ${result.reason}` }
      answer = { ...answer, ...result.answer }
    }
  }
  return answer
}

function failure(spec: ResultSpec, isFailClosed: boolean, exit: number | null, stderr: string) {
  const reason = stderr.trim()
  return isFailClosed || spec.otherExit === 'block'
    ? { status: 'blocked' as const, reason: reason === '' ? `${spec.label}: hook failed` : reason }
    : {
        status: 'failed' as const,
        reason: reason === '' ? `${spec.label}: hook exited ${String(exit)}` : reason,
      }
}

function isBlockExit(spec: ResultSpec, exitCode: number | null): boolean {
  return (
    exitCode !== null &&
    (spec.blockCodes.includes(exitCode) ||
      (spec.blockFrom !== undefined && exitCode >= spec.blockFrom))
  )
}

/** Drop single-line progress objects (gh/copilot_reference_hooks-configuration.md:154). */
function withoutProgress(stdout: string): string {
  return stdout
    .split('\n')
    .filter((line) => {
      const parsed = jsonOutput(line.trim())
      return !(isRecord(parsed) && parsed['type'] === 'progress')
    })
    .join('\n')
}

export function parseResult(
  contract: VendorContract,
  event: AdapterEvent,
  exitCode: number | null,
  rawStdout: string,
  stderr: string,
  options: AdapterOptions | undefined,
): ForeignHookAnswer {
  const input = options?.input
  const selection = selectRow(
    contract,
    event,
    options,
    input === undefined ? undefined : textField(input, 'tool_name'),
  )
  if (!selection.ok) return { status: 'failed', reason: selection.reason }
  const spec = selection.row.result
  const isFailClosed = spec.failClosed === true && options?.failClosed === true
  const stdout = spec.progressLines === true ? withoutProgress(rawStdout) : rawStdout
  if (isBlockExit(spec, exitCode)) {
    const parsed = jsonOutput(stdout)
    if (spec.blockMerge !== undefined || spec.blockScansStdout === true) {
      const merged = { ...(isRecord(parsed) && parsed), ...spec.blockMerge }
      const veto = vetoOf(spec, merged, options, stderr)
      if (veto !== undefined) return veto
    }
    const reason =
      spec.stdoutFirst === true
        ? blockReason(stdout, stderr, spec.label)
        : blockReason(stderr, spec.stderrOnly === true ? '' : stdout, spec.label)
    return { status: 'blocked', reason }
  }
  if (exitCode !== null && spec.contextCodes?.includes(exitCode) === true) {
    const text = stdout.trim()
    return text === '' ? { status: 'completed' } : { status: 'completed', context: text }
  }
  if (exitCode !== 0) return failure(spec, isFailClosed, exitCode, stderr)
  if (spec.stdout === 'ignore') return { status: 'completed' }
  const trimmed = stdout.trim()
  if (trimmed === '') {
    if (isFailClosed) return { status: 'blocked', reason: `${spec.label}: no output (failClosed)` }
    return spec.emptyIsInvalid === true ? invalid(spec, isFailClosed) : { status: 'completed' }
  }
  if (spec.stdout === 'text')
    return { status: 'completed', context: trimmed.slice(0, HOOK_TOOL_OUTPUT_PREVIEW_CHARS) }
  const value = jsonOutput(stdout)
  if (value === undefined && spec.textIsMessage === true)
    return { status: 'completed', systemMessage: trimmed.slice(0, HOOK_TOOL_OUTPUT_PREVIEW_CHARS) }
  if (!isRecord(value))
    return spec.unparseableIsEmpty === true ? { status: 'completed' } : invalid(spec, isFailClosed)
  const veto = vetoOf(spec, value, options, '')
  if (veto !== undefined) return veto
  return spec.schema !== undefined && !spec.schema.safeParse(value).success
    ? invalid(spec, isFailClosed)
    : collect(spec, value, options)
}
