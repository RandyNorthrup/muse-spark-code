import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// RVCM1062H: the shared confirmed-dispatch helper (assertConfirmedAllowed in
// src/core/backends/modelapi/transport.ts) is the only code allowed to accept
// or refuse a ConfirmedModelRequest. This test inventories every
// ConfirmedModelRequest / confirmed-parameter site in src and fails when any
// site other than the helper throws, returns a refusal, or builds a refusal
// message for one. A new site fails first: extend the allowlist below only
// after reading it, and route its decision through the helper.
const SRC_ROOT = path.resolve('src')
const WINDOW = 10

const DISPATCH_VOCAB =
  /streamResponse|admitAttempt|onRequestStarted|isStillAllowed|keyDigest|runKind|providerId|onRetry/
const CONFIRMED = /ConfirmedModelRequest|\bconfirmed\b/
const REFUSAL =
  /\bthrow\b|return fail\(\)|modelsPanelUnavailable|failureText\(|confirmation-expired|requestStaleHookModel|scheduleConfirmationExpired|staleConfirmedError\s*\(/

interface AllowEntry {
  readonly file: string
  readonly match: RegExp
  readonly why: string
}

// Every flagged line below was read: none decides a ConfirmedModelRequest.
// The helper (transport.ts) throws the run's own sentence; adapter-internal,
// budget, abort and ScheduleRunConfirmation-admission refusals keep theirs.
const ALLOWLIST: readonly AllowEntry[] = [
  {
    file: 'src/core/backends/modelapi/ModelApiHost.ts',
    match: /team runtime was not prepared/,
    why: 'team-runtime readiness; the schedule run port only threads its confirmation through',
  },
  {
    file: 'src/core/backends/modelapi/ModelApiHost.ts',
    match: /throw new AbortedError\(\)/,
    why: 'retry-loop revision fence; unrelated to the confirmed request it threads',
  },
  {
    file: 'src/core/backends/modelapi/ModelApiHost.ts',
    match: /sideChatPlanOnly|scheduleConfirmationExpired|schedulePaidOff|scheduleBusy/,
    why: 'runSchedule admission on ScheduleRunConfirmation (a different type), before any ConfirmedModelRequest exists',
  },
  {
    file: 'src/core/backends/modelapi/ModelApiHost.ts',
    match: /throw error/,
    why: 'rethrow after lease cleanup; the decision happened upstream',
  },
  {
    file: 'src/core/backends/modelapi/ModelApiHost.ts',
    match: /TURN_NOT_RUNNING/,
    why: 'steer admission on turn identity; the confirmation factory is only threaded',
  },
  {
    file: 'src/core/backends/modelapi/client.ts',
    match: /throw error/,
    why: 'rethrows the shared helper refusal unchanged after media finish',
  },
  {
    file: 'src/core/backends/modelapi/client.ts',
    match: /The response had no body/,
    why: 'provider failure after dispatch; the confirmation gate already passed',
  },
  {
    file: 'src/core/backends/modelapi/client.ts',
    match: /outputTokenMinimumMessage\(MODEL_API_MIN_OUTPUT_TOKENS\)/,
    why: 'output-cap minimum (MINOUT) for every request, confirmed or not; it decides no confirmation and the helper runs right after it',
  },
  {
    file: 'src/core/backends/modelapi/hookModelEntry.ts',
    match: /throw error/,
    why: 'rethrow; the hook confirmation is only forwarded to the client',
  },
  {
    file: 'src/core/backends/modelapi/hookModelEntry.ts',
    match: /abortError/,
    why: 'cancellation; not a confirmation decision',
  },
  {
    file: 'src/core/backends/modelapi/reviewerEntry.ts',
    match: /throw error/,
    why: 'rethrow; the review confirmation is only forwarded to the client',
  },
  {
    file: 'src/core/backends/modelapi/reviewerEntry.ts',
    match: /abortError/,
    why: 'cancellation; not a confirmation decision',
  },
  {
    file: 'src/core/backends/modelapi/schedulesEntry.ts',
    match:
      /sideChatPlanOnly|scheduleConfirmationExpired|schedulePaidOff|scheduleBusy|scheduleNotDue|scheduleAlreadyRun/,
    why: 'admission on ScheduleRunConfirmation (a different type), before any ConfirmedModelRequest exists',
  },
  {
    file: 'src/core/backends/modelapi/transport.ts',
    match: /staleConfirmedError\(/,
    why: 'the helper itself throws the run guidance sentence',
  },
  {
    file: 'src/core/backends/modelapi/transport.ts',
    match: /requestStaleHookModel|scheduleConfirmationExpired/,
    why: 'the helper sentence table and its stale-error recogniser',
  },
  {
    file: 'src/core/backends/modelapi/transport.ts',
    match: /throw new ModelApiError\('cancelled'|throw error|sessionBudgetSearchUnavailable/,
    why: 'abort, rethrow and budget fences around the transport gate; stale refusals keep the helper sentence',
  },
  {
    file: 'src/core/backends/modelapi/transport.ts',
    match: /throw new ModelApiError\($/,
    why: 'transport failure mapping after dispatch; the confirmation gate already passed',
  },
  {
    file: 'src/core/providers/configured.ts',
    match: /if \(body\.model !== ref\) return fail\(\)/,
    why: 'wrong-client fence; a confirmed mismatch refuses first in the shared helper above it',
  },
  {
    file: 'src/core/providers/configured.ts',
    match: /isStaleConfirmedError\(error\)\) throw error/,
    why: 'the rethrow guard: a lapsed confirmation keeps the helper sentence',
  },
  {
    file: 'src/core/providers/configured.ts',
    match: /return fail\(\)$/,
    why: 'non-stale dispatch failures keep the provider unavailable text',
  },
  {
    file: 'src/core/providers/configured.ts',
    match: /outputTokenMinimumMessage\(minimum\)/,
    why: 'the provider output-cap minimum (MINOUT) for every request, confirmed or not; the confirmed gate is the helper below it',
  },
  {
    file: 'src/core/providers/subscriptions/registry.ts',
    match: /adapter === undefined/,
    why: 'missing Copilot adapter; unrelated to the confirmation it forwards',
  },
  {
    file: 'src/core/providers/subscriptions/registry.ts',
    match: /throw signal\.reason/,
    why: 'abort rethrow after the helper re-check; not a confirmation decision',
  },
  {
    file: 'src/core/providers/subscriptions/registry.ts',
    match: /^throw error$/,
    why: 'the ChatGPT idle limit (0.17.2): the awaited fetch or read is rethrown after a silent stream is aborted; it decides no confirmation',
  },
  {
    file: 'src/host/providers/copilotClient.ts',
    match: /failureText\(code\)/,
    why: 'failure-text factory; no dispatch decision',
  },
  {
    file: 'src/host/providers/copilotClient.ts',
    match: /confirmation-expired/,
    why: 'pre-existing adapter mapping blessed in RVCM1062H: a lapse keeps the adapter refusal like every direct call before it',
  },
  {
    file: 'src/host/providers/copilotClient.ts',
    match: /this\.fail\('(confidential|consent-required|unavailable|cancelled)'\)/,
    why: 'adapter-internal fences; the confirmation gate runs through the shared helper',
  },
  {
    file: 'src/host/providers/copilotClient.ts',
    match: /a throw here needs no cleanup/,
    why: 'RVCM1054D P2 builder comment: describes the typed codec refusal below, decides no confirmation',
  },
  {
    file: 'src/host/providers/copilotClient.ts',
    match: /tool\.type !== 'function'\) throw this\.fail\('unsupported-content'\)/,
    why: 'RVCM1054D P2 message builders before resource acquisition: a non-function tool keeps the adapter refusal; the confirmation gate is assertConfirmed above',
  },
  {
    file: 'src/runtime/runtimeAccountingEntry.ts',
    match: /execModelUnpriced/,
    why: 'exec pricing fence; the confirmation is forwarded untouched',
  },
  {
    file: 'src/runtime/runtimeAccountingEntry.ts',
    match: /throw error/,
    why: 'rethrow after noting a rate limit for settlement (M101 admission); the confirmation is forwarded untouched',
  },
]

// The candidate files known today. A new file that names ConfirmedModelRequest
// or threads a confirmed dispatch parameter fails this test first.
const KNOWN_CANDIDATES: readonly string[] = [
  'src/core/backends/modelapi/ModelApiHost.ts',
  'src/core/backends/modelapi/client.ts',
  'src/core/backends/modelapi/hookModelEntry.ts',
  'src/core/backends/modelapi/providerClient.ts',
  'src/core/backends/modelapi/reviewerEntry.ts',
  'src/core/backends/modelapi/schedulesEntry.ts',
  'src/core/backends/modelapi/transport.ts',
  'src/core/providers/configured.ts',
  'src/core/providers/subscriptions/registry.ts',
  'src/host/providers/copilotClient.ts',
  'src/runtime/runtimeAccountingEntry.ts',
]

function listSourceFiles(root: string): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (/\.tsx?$/.test(entry.name)) out.push(full)
    }
  }
  visit(root)
  return out
}

function normalise(full: string): string {
  return path.relative(path.resolve('.'), full).split(path.sep).join('/')
}

function readLines(full: string): string[] {
  return readFileSync(full, 'utf8').split('\n')
}

function byString(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function hasConfirmedNearby(lines: string[], low: number, high: number): boolean {
  for (let near = low; near < high; near += 1) {
    if (CONFIRMED.test(lines[near] ?? '')) return true
  }
  return false
}

function candidateFiles(): string[] {
  return listSourceFiles(SRC_ROOT)
    .filter((full) => {
      const lines = readLines(full)
      return lines.some(
        (line) =>
          line.includes('ConfirmedModelRequest') ||
          (CONFIRMED.test(line) && DISPATCH_VOCAB.test(line)),
      )
    })
    .map((full) => normalise(full))
    .toSorted(byString)
}

interface FlaggedSite {
  readonly file: string
  readonly line: number
  readonly text: string
}

function flaggedSites(candidates: ReadonlySet<string>): FlaggedSite[] {
  const sites: FlaggedSite[] = []
  for (const full of listSourceFiles(SRC_ROOT)) {
    const file = normalise(full)
    if (!candidates.has(file)) continue
    const lines = readLines(full)
    for (const [index, line] of lines.entries()) {
      if (!REFUSAL.test(line)) continue
      const low = Math.max(0, index - WINDOW)
      const high = Math.min(lines.length, index + WINDOW + 1)
      if (hasConfirmedNearby(lines, low, high))
        sites.push({ file, line: index + 1, text: line.trim() })
    }
  }
  return sites.toSorted((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  )
}

function staleSentenceBuilders(): string[] {
  const builders: string[] = []
  for (const full of listSourceFiles(SRC_ROOT)) {
    const file = normalise(full)
    for (const [index, line] of readLines(full).entries()) {
      if (
        /staleConfirmedError\s*\(/.test(line) &&
        !line.includes('function staleConfirmedError') &&
        !line.trimStart().startsWith('import') &&
        !line.trimStart().startsWith('*')
      )
        builders.push(`${file}:${String(index + 1)}: ${line.trim()}`)
    }
  }
  return builders
}

describe('confirmed-dispatch inventory (RVCM1062H)', () => {
  // Collected once: the walk is shared instead of re-reading src per test.
  const candidates = candidateFiles()
  const sites = flaggedSites(new Set(candidates))
  const builders = staleSentenceBuilders()
  it('knows every file that references a confirmed dispatch', () => {
    expect(candidates).toEqual(KNOWN_CANDIDATES.toSorted(byString))
  })
  it('lets no site but the helper refuse a confirmed dispatch', () => {
    const unknown = sites.filter((site) =>
      ALLOWLIST.every((entry) => entry.file !== site.file || !entry.match.test(site.text)),
    )
    expect(
      unknown.map((site) => `${site.file}:${String(site.line)}: ${site.text}`),
      'unlisted confirmed-dispatch refusal site: the list below gives file, line and source text. Read each decision; route confirmation decisions through assertConfirmedAllowed. For a release-train merge only, add separate file/match/why entries for its two output-minimum refusals (model-output validation) and its throw error after a rate-limit notice (unchanged upstream rethrow). Those lines are absent on this branch; do not add broad matches here.',
    ).toEqual([])
  })
  it('builds the stale refusal sentence only in the helper module', () => {
    expect(
      builders.filter((site) => !site.startsWith('src/core/backends/modelapi/transport.ts')),
      'stale refusal sentence built outside the helper: route the decision through assertConfirmedAllowed',
    ).toEqual([])
    // The two RVCM1062H violations stay fixed: the codec routes its
    // provider/origin check through the helper, and the bound client
    // rethrows a stale refusal instead of mapping it to unavailable text.
    const providerClient = readLines(
      path.join(SRC_ROOT, 'core/backends/modelapi/providerClient.ts'),
    )
    expect(providerClient.some((line) => line.includes('assertConfirmedAllowed'))).toBe(true)
    expect(
      providerClient.some(
        (line) =>
          line.includes('confirmed.origin !==') || line.includes('confirmed.providerId !=='),
      ),
    ).toBe(false)
    const configured = readLines(path.join(SRC_ROOT, 'core/providers/configured.ts'))
    expect(configured.some((line) => line.includes('assertConfirmedAllowed'))).toBe(true)
    expect(configured.some((line) => line.includes('isStaleConfirmedError'))).toBe(true)
  })
})
