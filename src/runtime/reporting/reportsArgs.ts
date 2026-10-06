import { parseArgs } from 'node:util'
import * as z from 'zod/mini'
import {
  ACP_AGENT_NAME,
  REPORT_FAIL_ON,
  REPORT_FORMATS,
  REPORT_KINDS,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { reportOptionsSchema, type ReportKind, type ReportOptions } from '../../shared/reportSchema'

export interface ReportsRequest {
  readonly kind: ReportKind | undefined
  readonly history: boolean
  readonly options: Omit<ReportOptions, 'kind' | 'asOf'>
  readonly asOf: string | undefined
  readonly format: (typeof REPORT_FORMATS)[number]
  readonly locale: string | undefined
  readonly out: string | undefined
  readonly from: string | undefined
  readonly diff: string | undefined
  readonly save: boolean
}

export function reportsUsage(table: Pick<UiText, 'reportCliUsage'> = UI_TEXT): string {
  return fill(table.reportCliUsage, { command: ACP_AGENT_NAME })
}

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  const strings: readonly string[] = values
  return strings.includes(value)
}

/** Pure parser, loaded with the reports engine rather than ACP startup. */
export function parseReportsArguments(argv: readonly string[]): ReportsRequest {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      format: { type: 'string' },
      out: { type: 'string' },
      'as-of': { type: 'string' },
      lang: { type: 'string' },
      network: { type: 'boolean' },
      from: { type: 'string' },
      diff: { type: 'string' },
      full: { type: 'boolean' },
      strict: { type: 'boolean' },
      'fail-on': { type: 'string', multiple: true },
      by: { type: 'string' },
      session: { type: 'string' },
      module: { type: 'string' },
      milestone: { type: 'string' },
      fleet: { type: 'string' },
      repo: { type: 'string' },
      save: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help === true) throw new Error(reportsUsage())
  if (Object.values(values).includes('')) throw new Error(reportsUsage())
  const [verb, ...args] = positionals
  const isHistory = verb === 'history'
  const selected = isHistory ? args.shift() : verb
  if (selected !== undefined && !isOneOf(REPORT_KINDS, selected)) throw new Error(reportsUsage())
  const kind = selected
  if (kind === undefined && !isHistory && values.from === undefined) throw new Error(reportsUsage())
  const format = values.format ?? (isHistory ? 'text' : 'md')
  if (!isOneOf(REPORT_FORMATS, format)) throw new Error(reportsUsage())
  if (values.lang !== undefined) Intl.getCanonicalLocales(values.lang)
  const failOn = (values['fail-on'] ?? []).flatMap((value) => value.split(','))
  if (values.strict === true) failOn.push('unavailable', 'drift')
  if (failOn.some((value) => !isOneOf(REPORT_FAIL_ON, value))) throw new Error(reportsUsage())
  let scope = args.join(' ')
  let by: string | undefined = values.by
  let deadline: string | undefined
  if (isHistory) {
    if (args.length > 0) throw new Error(reportsUsage())
  } else if (kind === 'estimate') {
    deadline = by === undefined ? undefined : `${by}T23:59:59+00:00`
    by = undefined
    if (scope === '') throw new Error(reportsUsage())
  } else if (kind === 'changes' && args.length > 0) {
    if (args.length !== 2 || args[0] !== 'since') throw new Error(reportsUsage())
    scope = args[1] ?? ''
  } else if (kind === 'usage') {
    if (
      args.length > 1 ||
      (scope !== '' &&
        !/^(?:today|7d|30d|90d|week|month|\d{4}-\d{2}|\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2})$/.test(
          scope,
        ))
    )
      throw new Error(reportsUsage())
  } else if (kind === 'milestone' || kind === 'release') {
    if (args.length !== 1 && values.from === undefined) throw new Error(reportsUsage())
    if (args.length > 1) throw new Error(reportsUsage())
  } else if (args.length > 0) throw new Error(reportsUsage())
  if (
    (kind !== 'usage' && kind !== 'estimate' && values.by !== undefined) ||
    (kind !== 'session' && values.session !== undefined) ||
    (kind !== 'playbook' && (values.module !== undefined || values.milestone !== undefined)) ||
    (kind !== 'estimate' && values.fleet !== undefined) ||
    (kind !== 'issues' && values.repo !== undefined)
  )
    throw new Error(reportsUsage())
  if (values.repo !== undefined) {
    if (!/^[\w][\w.-]*\/[\w][\w.-]*$/.test(values.repo)) throw new Error(reportsUsage())
    scope = values.repo
  }
  if (
    isHistory &&
    (format === 'html' ||
      args.length > 0 ||
      values.from !== undefined ||
      values.diff !== undefined ||
      values.save === true ||
      values.network === true ||
      values['as-of'] !== undefined ||
      values.full === true ||
      values.by !== undefined ||
      values.session !== undefined ||
      values.module !== undefined ||
      values.milestone !== undefined ||
      values.fleet !== undefined ||
      values.repo !== undefined ||
      failOn.length > 0)
  )
    throw new Error(reportsUsage())
  // --from is rendering only: changing collection options must never silently do nothing.
  if (
    (scope !== '' ||
      by !== undefined ||
      deadline !== undefined ||
      values.network === true ||
      values['as-of'] !== undefined ||
      values.full === true ||
      values.session !== undefined ||
      values.module !== undefined ||
      values.milestone !== undefined ||
      values.fleet !== undefined) &&
    values.from !== undefined
  )
    throw new Error(reportsUsage())
  const { kind: _kindSchema, asOf: asOfSchema, ...optionFields } = reportOptionsSchema.shape
  if (values['as-of'] !== undefined) asOfSchema.parse(values['as-of'])
  const options = z.strictObject(optionFields).parse({
    scope,
    full: values.full === true,
    ...(by !== undefined && { by }),
    ...(values.session !== undefined && { sessionId: values.session }),
    ...(values.module !== undefined && { module: values.module }),
    ...(values.milestone !== undefined && { milestone: values.milestone }),
    ...(deadline !== undefined && { deadline }),
    ...(values.fleet !== undefined && { fleet: values.fleet }),
    network: values.network === true,
    failOn: [...new Set(failOn)],
  })
  return {
    kind,
    history: isHistory,
    options,
    asOf: values['as-of'],
    format,
    locale: values.lang,
    out: values.out,
    from: values.from,
    diff: values.diff,
    save: values.save === true,
  }
}

/** Shell-like quotes without expansion, substitution, or starting a shell. */
export function reportArguments(text: string): string[] {
  const args: string[] = []
  let token = ''
  let quote = ''
  let isStarted = false
  for (const char of text) {
    if (quote !== '') {
      if (char === quote) quote = ''
      else token += char
    } else if (char === '"' || char === "'") {
      quote = char
      isStarted = true
    } else if (/\s/.test(char)) {
      if (isStarted) args.push(token)
      token = ''
      isStarted = false
    } else {
      token += char
      isStarted = true
    }
  }
  if (quote !== '') throw new Error(reportsUsage())
  if (isStarted) args.push(token)
  return args
}
