import { ESTIMATE_OPTIONS } from './options'
import {
  estimateRequestSchema,
  estimateSectionSchema,
  parseEstimateGoal,
  type CatalogPrice,
  type EstimateRequest,
  type EstimateSection,
} from '../../shared/estimate'
import {
  ACP_AGENT_NAME,
  MILLISECONDS_PER_SECOND,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '../../shared/constants'
import { fill, formatNumber, formatUnit, UI_TEXT, uiLocale } from '../../shared/l10n/text'

export interface EstimateCommandOptions {
  readonly goal: EstimateRequest['goal']
  readonly deadline?: string
  readonly fleet: EstimateRequest['fleet']
  readonly seed?: string
  readonly format: 'md' | 'html' | 'json' | 'text'
}

/** Bound inside W's lazy estimator bundle, never a model/backend fallback. */
export interface EstimateRunPort {
  estimate(request: EstimateRequest, signal: AbortSignal): Promise<unknown>
}
export interface EstimateContext {
  readonly asOf: string
  readonly optimize: EstimateRequest['optimize']
}
export interface EstimateFormatPort {
  /** W uses shared/usd.ts; R owns the exact money representation. */
  price(price: CatalogPrice): string
}

type ParsedOptions =
  | { readonly kind: 'estimate'; readonly options: EstimateCommandOptions }
  | { readonly kind: 'help' }
  | { readonly kind: 'invalid'; readonly reason: string }

/** Reject locale-dependent/rollover dates; a date-only deadline means midnight UTC. */
export function estimateDeadline(text: string): string | undefined {
  const instant = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text
  const parsed = estimateRequestSchema.shape.asOf.safeParse(instant)
  return parsed.success ? new Date(instant).toISOString() : undefined
}

/** Shared CLI/ACP grammar. No shell evaluation; labels can contain spaces. */
export function parseEstimateOptions(argv: readonly string[]): ParsedOptions {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { kind: 'help' }
  const invalid = (): ParsedOptions => ({ kind: 'invalid', reason: UI_TEXT.estimateUsage })
  const values = new Map<string, string>()
  const goalParts: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? ''
    if (!token.startsWith('-')) {
      if (values.size > 0) return invalid()
      goalParts.push(token)
      continue
    }
    const equals = token.indexOf('=')
    const flag = equals === -1 ? token : token.slice(0, equals)
    if (flag === '--help' || !Object.hasOwn(ESTIMATE_OPTIONS, flag.slice(2)) || values.has(flag))
      return invalid()
    const value = equals === -1 ? argv[++index] : token.slice(equals + 1)
    if (value === undefined || value === '' || value.startsWith('--')) return invalid()
    values.set(flag, value)
  }
  const goal = parseEstimateGoal(goalParts.join(' '))
  const deadlineText = values.get('--by')
  const deadline = deadlineText === undefined ? undefined : estimateDeadline(deadlineText)
  const fleet = values.get('--fleet') ?? 'current'
  const format = values.get('--format') ?? 'text'
  const seed = values.get('--seed')
  if (
    goal === undefined ||
    (deadlineText !== undefined && deadline === undefined) ||
    (fleet !== 'current' && fleet !== 'minimum' && fleet !== 'optimum') ||
    (format !== 'md' && format !== 'html' && format !== 'json' && format !== 'text') ||
    (seed !== undefined && !estimateRequestSchema.shape.seed.safeParse(seed).success)
  )
    return invalid()
  return {
    kind: 'estimate',
    options: { goal, fleet, format, ...(deadline && { deadline }), ...(seed && { seed }) },
  }
}

/** Quotes group words only; escapes, substitution and shell syntax have no special meaning. */
export function estimateSlashArguments(text: string): readonly string[] | undefined {
  const match = /^\/estimate(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return undefined
  const tokens: string[] = []
  let word = ''
  let quote: string | undefined
  let isActive = false
  const argumentsText = match[1] ?? ''
  for (const char of argumentsText) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      isActive = true
    } else if (/\s/.test(char)) {
      if (isActive) tokens.push(word)
      word = ''
      isActive = false
    } else {
      word += char
      isActive = true
    }
  }
  if (quote !== undefined) return []
  if (isActive) tokens.push(word)
  return tokens
}

/** M113's collector consumes this section; its report-v1 envelope stays with M113. */
export async function collectEstimate(
  options: EstimateCommandOptions,
  context: EstimateContext,
  port: EstimateRunPort,
  signal: AbortSignal,
): Promise<EstimateSection> {
  const request = estimateRequestSchema.parse({
    goal: options.goal,
    asOf: context.asOf,
    fleet: options.fleet,
    optimize: context.optimize,
    ...(options.deadline && { deadline: options.deadline }),
    ...(options.seed && { seed: options.seed }),
  })
  const expectedRequest = JSON.stringify(request)
  signal.throwIfAborted()
  const section = estimateSectionSchema.parse(await port.estimate(request, signal))
  signal.throwIfAborted()
  if (JSON.stringify(section.inputs.request) !== expectedRequest)
    throw new Error(fill(UI_TEXT.estimateFailed, { detail: 'request-mismatch' }))
  return section
}

const HOUR_MS = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR

export function estimateDrift(next: EstimateSection, previous: EstimateSection): EstimateSection {
  return estimateSectionSchema.parse({
    ...next,
    drift: {
      previousAsOf: previous.asOf,
      p50Hours: (Date.parse(next.p50) - Date.parse(previous.p50)) / HOUR_MS,
      p90Hours: (Date.parse(next.p90) - Date.parse(previous.p90)) / HOUR_MS,
    },
    disclosures: [
      ...next.disclosures.filter((row) => !row.path.startsWith('/drift/')),
      ...['/drift/p50Hours', '/drift/p90Hours'].map((path) => ({
        path,
        basis: 'assumption',
        samples: 0,
        uncertainty: { kind: 'unknown' },
      })),
    ],
  })
}

/** UTC makes terminal/report bytes independent of the process TZ. */
function date(value: string): string {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }
  if (value.includes('T')) options.timeStyle = 'short'
  return new Intl.DateTimeFormat(uiLocale(), options).format(Date.parse(value))
}
function setupLabel(kind: EstimateSection['setups'][number]['kind']): string {
  switch (kind) {
    case 'current': {
      return UI_TEXT.estimateCurrent
    }
    case 'minimumP50': {
      return `${UI_TEXT.estimateMinimum} · ${UI_TEXT.estimateP50}`
    }
    case 'minimumP90': {
      return `${UI_TEXT.estimateMinimum} · ${UI_TEXT.estimateP90}`
    }
    case 'optimumCost': {
      return `${UI_TEXT.estimateOptimum} · ${UI_TEXT.estimateCost}`
    }
    case 'optimumSpeed': {
      return `${UI_TEXT.estimateOptimum} · ${UI_TEXT.estimateSpeed}`
    }
  }
}
function limitingLabel(kind: EstimateSection['limitingResource']['kind']): string {
  switch (kind) {
    case 'machines': {
      return UI_TEXT.estimateMachines
    }
    case 'slots': {
      return UI_TEXT.estimateSlots
    }
    case 'accountRate': {
      return UI_TEXT.estimateAccounts
    }
    case 'ci': {
      return UI_TEXT.estimateCi
    }
    case 'disk': {
      return UI_TEXT.estimateDisk
    }
    case 'criticalPath': {
      return UI_TEXT.estimateCriticalPath
    }
  }
}
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
function escapeMarkdown(text: string): string {
  return text.replaceAll(/([\\`*_{}[\]<>#+.!|])/g, String.raw`\$1`).replaceAll('\n', ' ')
}

/** Complete evidence travels in every format, not just the appealing forecast. */
export function renderEstimate(
  input: unknown,
  format: EstimateCommandOptions['format'],
  money: EstimateFormatPort,
): string {
  const section = estimateSectionSchema.parse(input)
  if (format === 'json') return `${JSON.stringify(section, null, 2)}\n`
  const paragraphs = [
    [UI_TEXT.estimateP50, date(section.p50)],
    [UI_TEXT.estimateP90, date(section.p90)],
    [UI_TEXT.estimateBottleneck, limitingLabel(section.limitingResource.kind)],
    [UI_TEXT.estimateCriticalPath, section.criticalPath.join(' → ')],
    [UI_TEXT.estimateAsOf, date(section.asOf)],
    [UI_TEXT.estimateSeed, section.seed],
    ...section.calibration.map((row) => [
      `${UI_TEXT.estimateCalibration} (${row.kind} / ${row.machineClassId})`,
      `${row.basis === 'uncalibratedPrior' ? UI_TEXT.estimatePrior : UI_TEXT.estimateFitted}; ${UI_TEXT.estimateSampleSize}: ${formatNumber(row.samples)}`,
    ]),
    ...section.schedule.map((row) => [
      row.laneId,
      `${row.machineId}: ${date(row.start)} → ${date(row.end)}${row.critical ? ` · ${UI_TEXT.estimateCriticalPath}` : ''}`,
    ]),
    ...section.setups.flatMap((setup) => [
      [setupLabel(setup.kind), `${date(setup.p50)} → ${date(setup.p90)}`],
      ...setup.machines.map((machine) => [
        machine.classId,
        `${UI_TEXT.estimateMachines}: ${formatNumber(machine.count)}; ${UI_TEXT.estimateSlots}: ${formatNumber(machine.slots)}; ${UI_TEXT.estimateAccounts}: ${formatNumber(machine.accounts)}; ${UI_TEXT.estimateMarginal}: ${formatUnit(machine.marginalP50Hours, 'hour')} / ${formatUnit(machine.marginalP90Hours, 'hour')}; ${machine.price === undefined ? UI_TEXT.estimateNoPrice : `${UI_TEXT.estimateHourly}: ${money.price(machine.price)}; ${fill(UI_TEXT.estimateCatalog, { date: date(machine.price.catalogDate) })} ${machine.price.catalogUrl}`}`,
      ]),
      ...(setup.provisioning === 'adviceOnly'
        ? [[UI_TEXT.estimateSpinUp, UI_TEXT.estimateAdvice]]
        : []),
    ]),
    ...(section.drift === undefined
      ? []
      : [
          [
            UI_TEXT.estimateDrift,
            `${date(section.drift.previousAsOf)}: ${UI_TEXT.estimateP50}: ${formatUnit(section.drift.p50Hours, 'hour')}; ${UI_TEXT.estimateP90}: ${formatUnit(section.drift.p90Hours, 'hour')}`,
          ],
        ]),
  ]
  const evidence = JSON.stringify(section, null, 2)
  const critical =
    section.limitingResource.kind === 'criticalPath' ? UI_TEXT.estimateCriticalBound : ''
  if (format === 'html')
    return `<!doctype html><html lang="${escapeHtml(uiLocale())}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(UI_TEXT.estimateTitle)}</title><body><main><h1>${escapeHtml(UI_TEXT.estimateTitle)}</h1><p>${escapeHtml(critical)}</p><dl>${paragraphs.map(([label, value]) => `<dt>${escapeHtml(label ?? '')}</dt><dd>${escapeHtml(value ?? '')}</dd>`).join('')}</dl><h2>${escapeHtml(UI_TEXT.estimateInputs)}</h2><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(evidence)}</pre></main></body></html>\n`
  if (format === 'md')
    return `# ${escapeMarkdown(UI_TEXT.estimateTitle)}\n\n${escapeMarkdown(critical)}\n\n${paragraphs.map(([label, value]) => `- **${escapeMarkdown(label ?? '')}:** ${escapeMarkdown(value ?? '')}`).join('\n')}\n\n## ${escapeMarkdown(UI_TEXT.estimateInputs)}\n\n${evidence
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n')}\n`
  return `${UI_TEXT.estimateTitle}\n${critical}\n${paragraphs.map(([label, value]) => `${label ?? ''}: ${value ?? ''}`).join('\n')}\n${UI_TEXT.estimateInputs}\n${evidence}\n`
}

export async function runEstimateCommand(
  argv: readonly string[],
  deps: {
    context(): EstimateContext
    readonly runner: EstimateRunPort
    readonly money: EstimateFormatPort
    write(text: string): void
    error(text: string): void
    readonly signal: AbortSignal
  },
): Promise<number> {
  const parsed = parseEstimateOptions(argv)
  const usage = `${UI_TEXT.estimateUsage.replace('/estimate', () => `${ACP_AGENT_NAME} estimate`)} [--format md|html|json|text] [--seed <seed>]`
  if (parsed.kind === 'invalid') {
    deps.error(usage)
    return 2
  }
  if (parsed.kind === 'help') {
    deps.write(`${usage}\n${UI_TEXT.estimateCliHelp}\n`)
    return 0
  }
  try {
    const section = await collectEstimate(parsed.options, deps.context(), deps.runner, deps.signal)
    deps.write(renderEstimate(section, parsed.options.format, deps.money))
    return 0
  } catch {
    deps.error(fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' }))
    return 1
  }
}
