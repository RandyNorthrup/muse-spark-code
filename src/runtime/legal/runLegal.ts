// The headless `legal` command's run (M97 lane R, PLAN.md D76): scan through
// the injected scanner, optionally enrich from the public registries, render
// the report as text or JSON, and answer with the documented exit code:
// 0 is a complete scan with no blockers, 1 a complete scan with blockers,
// 2 incomplete coverage, bad input or an operational failure. Advice alone
// never fails CI: only `blocker` and `should-fix` findings take exit 1.
//
// No backend, no auth, no model: every dependency (scan, fetch, file write)
// is injected, so the tests pin the exit codes, the lane-0 contract shape,
// the network-off default and stdout purity without touching either.

import * as z from 'zod/mini'
import { redactSecrets } from '../../core/redact'
import {
  HTTP_STATUS_MAX,
  LEGAL_EXIT,
  LEGAL_REPORT_MAX_BYTES,
  LEGAL_RESULT_VERSION,
  LEGAL_TEXT_MAX_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatBytes, formatNumber, formatPercent, plural } from '../../shared/l10n/text'
import {
  legalScanResultSchema,
  type LegalFinding,
  type LegalScanInput,
  type LegalScanResult,
} from '../../shared/legal'
import type { LegalOptions } from './legalArgs'
import { enrichFromRegistries, type LegalRegistryReport } from './legalRegistry'
import { defaultScanPolicy, type LegalScanHandle } from './legalScanner'

export type LegalExitCode =
  typeof LEGAL_EXIT.ok | typeof LEGAL_EXIT.findings | typeof LEGAL_EXIT.incomplete

export interface RunLegalDeps {
  /** Lane S's scanner behind the interface (a fake in tests). */
  readonly scan: (input: LegalScanInput) => Promise<LegalScanHandle>
  readonly fetch: typeof fetch
  readonly writeFile: (path: string, data: string) => Promise<void>
  readonly signal?: AbortSignal
}

export interface RunLegalResult {
  readonly exitCode: LegalExitCode
  /** The report, or '' when `--out` takes it or nothing could be said. */
  readonly out: string
  /** Fixed user words only: never a secret, a file body, or a thrown stack. */
  readonly err: string
}

const registryLicenseSchema = z.strictObject({
  target: z.strictObject({
    ecosystem: z.enum(['npm', 'pypi']),
    name: z.string(),
    version: z.string(),
  }),
  status: z.enum(['found', 'unknown', 'refused', 'error']),
  license: z.optional(z.string()),
  httpStatus: z.optional(z.number().check(z.int(), z.gte(100), z.lte(HTTP_STATUS_MAX))),
  bytes: z.number().check(z.int(), z.gte(0)),
})

const registrySectionSchema = z.strictObject({
  enabled: z.boolean(),
  hosts: z.array(z.string()),
  queried: z.array(z.string()),
  licenses: z.array(registryLicenseSchema),
  skipped: z.array(
    z.strictObject({
      target: z.strictObject({
        ecosystem: z.enum(['npm', 'pypi']),
        name: z.string(),
        version: z.string(),
      }),
      reason: z.string(),
    }),
  ),
  isTruncated: z.boolean(),
  bytesReceived: z.number().check(z.int(), z.gte(0)),
})

/** The JSON surface: lane 0's contract result beside the registry disclosure. */
export const legalReportEnvelopeSchema = z.strictObject({
  disclaimer: z.string().check(z.minLength(1)),
  result: legalScanResultSchema,
  registry: registrySectionSchema,
})
export type LegalReportEnvelope = z.infer<typeof legalReportEnvelopeSchema>

function disabledRegistry(): LegalRegistryReport {
  return {
    enabled: false,
    hosts: [],
    queried: [],
    licenses: [],
    skipped: [],
    isTruncated: false,
    bytesReceived: 0,
  }
}

function degradedResult(reason: string): LegalScanResult {
  return {
    version: LEGAL_RESULT_VERSION,
    ruleVersion: 'unavailable',
    dataVersion: 'unavailable',
    scope: '',
    distribution: UI_TEXT.legalScanNoDistribution,
    exclusions: [],
    incompleteChecks: [reason],
    findings: [],
  }
}

function shortReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return redactSecrets(message).slice(0, LEGAL_TEXT_MAX_CHARS)
}

function exitOf(result: LegalScanResult): LegalExitCode {
  if (result.incompleteChecks.length > 0) return LEGAL_EXIT.incomplete
  const hasActionable = result.findings.some((finding) => finding.severity === 'blocker')
  return hasActionable ? LEGAL_EXIT.findings : LEGAL_EXIT.ok
}

function fileWhere(finding: LegalFinding): string | undefined {
  if (finding.file === undefined) return undefined
  if (finding.line === undefined) return finding.file
  return finding.endLine === undefined || finding.endLine === finding.line
    ? `${finding.file}:${String(finding.line)}`
    : `${finding.file}:${String(finding.line)}-${String(finding.endLine)}`
}

function packageWhere(finding: LegalFinding): string | undefined {
  if (finding.packageName === undefined) return undefined
  return finding.packageVersion === undefined
    ? finding.packageName
    : `${finding.packageName}@${finding.packageVersion}`
}

function whereOf(finding: LegalFinding): string {
  const parts = [fileWhere(finding), packageWhere(finding), finding.licenseExpression].filter(
    (part) => part !== undefined,
  )
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`
}

function severityOf(finding: LegalFinding): string {
  if (finding.severity === 'blocker') return UI_TEXT.legalSeverities.blocker
  return finding.severity === 'should-fix'
    ? UI_TEXT.legalSeverities['should-fix']
    : UI_TEXT.legalSeverities.advice
}

function findingLines(finding: LegalFinding): string[] {
  const fixable = finding.fixable ? UI_TEXT.legalFixable : UI_TEXT.legalNotFixable
  return [
    `[${severityOf(finding)}] ${finding.id}${whereOf(finding)}`,
    finding.explanation,
    finding.recommendation,
    fill(UI_TEXT.legalEvidenceLabel, {
      evidence: finding.evidenceExcerpt ?? finding.evidenceSource,
    }),
    `${fill(UI_TEXT.legalConfidenceLabel, { confidence: formatPercent(finding.confidence * 100) })} - ${fixable}`,
  ]
}

function registryLine(registry: LegalRegistryReport): string {
  if (!registry.enabled) return UI_TEXT.legalRegistryOff
  const found = registry.licenses.filter((license) => license.status === 'found').length
  return fill(UI_TEXT.legalRegistryLine, {
    hosts: registry.hosts.join(', '),
    queried: formatNumber(registry.queried.length),
    found: formatNumber(found),
    skipped: formatNumber(registry.skipped.length),
    bytes: formatBytes(registry.bytesReceived),
  })
}

function renderText(result: LegalScanResult, registry: LegalRegistryReport): string {
  const head = [
    UI_TEXT.legalScanTitle,
    UI_TEXT.legalScanDisclaimer,
    fill(UI_TEXT.legalDistributionLine, { distribution: result.distribution }),
  ]
  const exclusions =
    result.exclusions.length === 0
      ? []
      : [fill(UI_TEXT.legalExclusionsLine, { exclusions: result.exclusions.join('; ') })]
  const findings =
    result.findings.length === 0
      ? [UI_TEXT.legalScanEmpty]
      : [
          plural(UI_TEXT.legalFindingsCount, result.findings.length),
          ...result.findings.flatMap((finding) => findingLines(finding)),
        ]
  const incomplete =
    result.incompleteChecks.length === 0
      ? []
      : [fill(UI_TEXT.legalScanIncomplete, { checks: result.incompleteChecks.join('; ') })]
  const body = [...head, ...exclusions, ...findings, ...incomplete, registryLine(registry)]
  return `${body.join('\n')}\n`
}

/**
 * Runs the read-only scan with no backend and no auth. stdout carries only
 * the rendered report (or nothing with `--out`); every other word goes to
 * stderr in the display language.
 */
export async function runLegalCommand(input: {
  readonly options: LegalOptions
  readonly deps: RunLegalDeps
}): Promise<RunLegalResult> {
  const { options, deps } = input
  const signal = deps.signal
  try {
    signal?.throwIfAborted()
    const handle = await deps.scan({ headerPolicy: defaultScanPolicy() })
    let result: LegalScanResult
    try {
      result = legalScanResultSchema.parse(handle.result)
    } catch {
      throw new Error('the scanner returned an invalid result')
    }
    signal?.throwIfAborted()
    const registry = options.registry
      ? await enrichFromRegistries({ targets: handle.registryTargets, fetch: deps.fetch, signal })
      : disabledRegistry()
    return await finish({ options, deps, result, registry, err: '' })
  } catch (error: unknown) {
    if (signal?.aborted === true) {
      return { exitCode: LEGAL_EXIT.incomplete, out: '', err: UI_TEXT.execInterrupted }
    }
    return await finish({
      options,
      deps,
      result: degradedResult(shortReason(error)),
      registry: disabledRegistry(),
      err: fill(UI_TEXT.legalScanFailed, { reason: shortReason(error) }),
    })
  }
}

async function finish(input: {
  readonly options: LegalOptions
  readonly deps: RunLegalDeps
  readonly result: LegalScanResult
  readonly registry: LegalRegistryReport
  readonly err: string
}): Promise<RunLegalResult> {
  const { options, deps, result, registry } = input
  const envelopeBody = { disclaimer: UI_TEXT.legalScanDisclaimer, result, registry }
  const rendered =
    options.format === 'json'
      ? `${JSON.stringify(envelopeBody, null, 2)}\n`
      : renderText(result, registry)
  try {
    const envelope: unknown = options.format === 'json' ? JSON.parse(rendered) : envelopeBody
    legalReportEnvelopeSchema.parse(envelope)
  } catch {
    return { exitCode: LEGAL_EXIT.incomplete, out: '', err: UI_TEXT.execFileTooLarge }
  }
  if (Buffer.byteLength(rendered, 'utf8') > LEGAL_REPORT_MAX_BYTES) {
    return { exitCode: LEGAL_EXIT.incomplete, out: '', err: UI_TEXT.execFileTooLarge }
  }
  if (options.out !== undefined) {
    try {
      await deps.writeFile(options.out, rendered)
    } catch (error: unknown) {
      return {
        exitCode: LEGAL_EXIT.incomplete,
        out: '',
        err: fill(UI_TEXT.legalScanFailed, { reason: shortReason(error) }),
      }
    }
    return {
      exitCode: exitOf(result),
      out: '',
      err: fill(UI_TEXT.legalWroteFile, { path: options.out }),
    }
  }
  return { exitCode: exitOf(result), out: rendered, err: input.err }
}
