// M97 lane R: the headless run's exit codes, contract shape and stdout
// purity. The scanner is a fake behind the lane-0 contract; fetch is a loud
// stub unless a test needs it; the file write lands in a map. No backend, no
// auth, no network without `--registry`.

import { describe, expect, it, vi } from 'vitest'
import {
  LEGAL_EXIT,
  LEGAL_RESULT_VERSION,
  LEGAL_TEXT_MAX_CHARS,
  UI_TEXT,
} from '../../src/shared/constants'
import { requestUrl } from './helpers/legalRequest'
import type { LegalRegistryTarget } from '../../src/runtime/legal/legalRegistry'
import { loadLegalScanner, type LegalScanHandle } from '../../src/runtime/legal/legalScanner'
import {
  legalReportEnvelopeSchema,
  runLegalCommand,
  type LegalReportEnvelope,
  type RunLegalDeps,
  type RunLegalResult,
} from '../../src/runtime/legal/runLegal'
import {
  legalScanResultSchema,
  type LegalFinding,
  type LegalScanResult,
} from '../../src/shared/legal'

function finding(overrides?: Partial<LegalFinding>): LegalFinding {
  return {
    id: 'rule/test/1',
    severity: 'advice',
    category: 'license',
    evidenceSource: 'LICENSE file',
    confidence: 1,
    explanation: 'The project declares its license.',
    recommendation: 'Keep the declaration.',
    fixable: false,
    ...overrides,
  }
}

function scanResult(overrides?: Partial<LegalScanResult>): LegalScanResult {
  return {
    version: LEGAL_RESULT_VERSION,
    ruleVersion: 'test-rules-1',
    dataVersion: 'test-data-1',
    scope: '',
    distribution: 'Assumes the packaged extension ships.',
    exclusions: [],
    incompleteChecks: [],
    findings: [],
    ...overrides,
  }
}

function loudFetch(requested: string[]): typeof fetch {
  const spy = (input: string | URL | Request): Promise<Response> => {
    requested.push(requestUrl(input))
    throw new Error('network without --registry')
  }
  return spy
}

interface LegalTestDeps extends RunLegalDeps {
  readonly requested: string[]
  readonly written: Map<string, string>
}

function fakeScan(
  result: LegalScanResult,
  registryTargets: readonly LegalRegistryTarget[] = [],
): RunLegalDeps['scan'] {
  return () => Promise.resolve({ result, registryTargets })
}

async function runJsonScan(scan: RunLegalDeps['scan']): Promise<{
  outcome: RunLegalResult
  envelope: LegalReportEnvelope
}> {
  const context = deps({ scan })
  const outcome = await runLegalCommand({
    options: { format: 'json', out: undefined, registry: false },
    deps: context,
  })
  const body: unknown = JSON.parse(outcome.out)
  return { outcome, envelope: legalReportEnvelopeSchema.parse(body) }
}

function deps(input?: {
  readonly scan?: RunLegalDeps['scan']
  readonly fetch?: typeof fetch
  readonly writeFile?: RunLegalDeps['writeFile']
}): LegalTestDeps {
  const requested: string[] = []
  const written = new Map<string, string>()
  return {
    requested,
    written,
    scan: input?.scan ?? (() => Promise.resolve({ result: scanResult(), registryTargets: [] })),
    fetch: input?.fetch ?? loudFetch(requested),
    writeFile:
      input?.writeFile ??
      vi.fn((file: string, data: string): Promise<void> => {
        written.set(file, data)
        return Promise.resolve()
      }),
  }
}

describe('M97 legal run (lane R)', () => {
  it('exits 0 on a clean scan with text and json reports', async () => {
    for (const format of ['text', 'json'] as const) {
      const context = deps()
      const outcome = await runLegalCommand({
        options: { format, out: undefined, registry: false },
        deps: context,
      })
      expect(outcome.exitCode).toBe(LEGAL_EXIT.ok)
      expect(outcome.err).toBe('')
      expect(context.requested).toEqual([])
      if (format === 'json') {
        const body: unknown = JSON.parse(outcome.out)
        const envelope: LegalReportEnvelope = legalReportEnvelopeSchema.parse(body)
        expect(legalScanResultSchema.parse(envelope.result)).toEqual(envelope.result)
        expect(envelope.registry).toMatchObject({ enabled: false, queried: [] })
      } else {
        expect(outcome.out).toContain(UI_TEXT.legalScanTitle)
        expect(outcome.out).toContain(UI_TEXT.legalScanDisclaimer)
        expect(outcome.out).toContain(UI_TEXT.legalScanEmpty)
        expect(outcome.out).toContain(UI_TEXT.legalRegistryOff)
      }
    }
  })
  it('exits 0 on advice alone and renders every finding field', async () => {
    const context = deps({
      scan: fakeScan(
        scanResult({
          findings: [
            finding({
              id: 'rule/headers/3',
              severity: 'advice',
              category: 'copyrightHeader',
              file: 'src/index.ts',
              line: 1,
              endLine: 2,
              packageName: 'left-pad',
              packageVersion: '1.3.0',
              licenseExpression: 'WTFPL',
              evidenceSource: 'the header block',
              evidenceExcerpt: '// Copyright 2026',
              confidence: 0.5,
              fixable: true,
            }),
          ],
        }),
      ),
    })
    const outcome = await runLegalCommand({
      options: { format: 'text', out: undefined, registry: false },
      deps: context,
    })
    expect(outcome.exitCode).toBe(LEGAL_EXIT.ok)
    for (const part of [
      'rule/headers/3',
      'src/index.ts:1-2',
      'left-pad@1.3.0',
      'WTFPL',
      '// Copyright 2026',
      UI_TEXT.legalFixable,
    ]) {
      expect(outcome.out).toContain(part)
    }
  })
  it.each(['blocker', 'should-fix'] as const)('exits 1 on a %s finding', async (severity) => {
    const { outcome, envelope } = await runJsonScan(
      fakeScan(scanResult({ findings: [finding({ severity })] })),
    )
    expect(outcome.exitCode).toBe(LEGAL_EXIT.findings)
    expect(envelope.result.findings).toHaveLength(1)
  })
  it('exits 2 on incomplete coverage, even with blockers beside it', async () => {
    const context = deps({
      scan: fakeScan(
        scanResult({
          incompleteChecks: ['the lockfile is missing, so transitive versions are unknown'],
          findings: [finding({ severity: 'blocker' })],
        }),
      ),
    })
    const outcome = await runLegalCommand({
      options: { format: 'text', out: undefined, registry: false },
      deps: context,
    })
    expect(outcome.exitCode).toBe(LEGAL_EXIT.incomplete)
    expect(outcome.out).toContain('the lockfile is missing')
  })
  it('reports an unavailable scanner as incomplete with a parseable envelope', async () => {
    const { outcome, envelope } = await runJsonScan(() =>
      Promise.reject(new Error('legalScan.js could not be loaded')),
    )
    expect(outcome.exitCode).toBe(LEGAL_EXIT.incomplete)
    expect(envelope.result.incompleteChecks).toHaveLength(1)
    expect(outcome.err).toContain(UI_TEXT.legalScanFailed.split('{', 2)[0] ?? 'failed')
  })
  it('reports a contract-breaking scanner result as incomplete', async () => {
    const { outcome, envelope } = await runJsonScan(
      fakeScan(scanResult({ incompleteChecks: ['x'.repeat(LEGAL_TEXT_MAX_CHARS + 1)] })),
    )
    expect(outcome.exitCode).toBe(LEGAL_EXIT.incomplete)
    expect(envelope.result.incompleteChecks).toHaveLength(1)
  })
  it('never leaks a scanner secret through stdout or stderr', async () => {
    const { outcome } = await runJsonScan(secretBundleScan)
    expect(outcome.exitCode).toBe(LEGAL_EXIT.incomplete)
    expect(outcome.out).not.toContain('hunter2')
    expect(outcome.err).not.toContain('hunter2')
  })
  it('writes --out to the file and leaves stdout empty, keeping the exit code', async () => {
    const context = deps({
      scan: fakeScan(scanResult({ findings: [finding({ severity: 'blocker' })] })),
    })
    const outcome = await runLegalCommand({
      options: { format: 'json', out: 'report/legal.json', registry: false },
      deps: context,
    })
    expect(outcome.exitCode).toBe(LEGAL_EXIT.findings)
    expect(outcome.out).toBe('')
    expect(context.written.get('report/legal.json')).toContain('"severity": "blocker"')
    expect(outcome.err).toContain('report/legal.json')
  })
  it('exits 2 when the file cannot be written', async () => {
    const context = deps({
      writeFile: () => Promise.reject(new Error('EACCES: permission denied')),
    })
    const outcome = await runLegalCommand({
      options: { format: 'text', out: 'report/legal.txt', registry: false },
      deps: context,
    })
    expect(outcome.exitCode).toBe(LEGAL_EXIT.incomplete)
    expect(outcome.out).toBe('')
  })
  it('asks nothing of the network without --registry, even with targets waiting', async () => {
    const context = deps({
      scan: fakeScan(scanResult(), [{ ecosystem: 'npm', name: 'is-even', version: '1.0.0' }]),
    })
    const outcome = await runLegalCommand({
      options: { format: 'json', out: undefined, registry: false },
      deps: context,
    })
    expect(outcome.exitCode).toBe(LEGAL_EXIT.ok)
    expect(context.requested).toEqual([])
  })
  it('stops before scanning when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const scan = vi.fn(() => Promise.resolve({ result: scanResult(), registryTargets: [] }))
    const context: RunLegalDeps = { ...deps({ scan }), signal: controller.signal }
    const outcome = await runLegalCommand({
      options: { format: 'text', out: undefined, registry: false },
      deps: context,
    })
    expect(outcome.exitCode).toBe(LEGAL_EXIT.incomplete)
    expect(outcome.out).toBe('')
    expect(outcome.err).toBe(UI_TEXT.execInterrupted)
    expect(scan).not.toHaveBeenCalled()
  })
})

const secretBundleScan: RunLegalDeps['scan'] = () =>
  loadLegalScanner({
    distDir: 'missing',
    loadBundle: () => ({
      runLegalScan: () => Promise.resolve({ result: { secret: 'hunter2' }, registryTargets: [] }),
    }),
  }).scan({ workspaceRoot: 'workspace', input: {} })

describe('M97 legal scanner loading (lane R)', () => {
  it('loads the bundle beside the running one and filters bad targets', async () => {
    const handle: LegalScanHandle = {
      result: scanResult(),
      registryTargets: [{ ecosystem: 'npm', name: 'is-even', version: '1.0.0' }],
    }
    const loadBundle = vi.fn(() => ({
      runLegalScan: () =>
        Promise.resolve({
          result: handle.result,
          registryTargets: [...handle.registryTargets, 'nope'],
        }),
    }))
    const scanner = loadLegalScanner({ distDir: 'dist', loadBundle })
    const seen = await scanner.scan({ workspaceRoot: 'workspace', input: {} })
    expect(seen).toEqual(handle)
    expect(loadBundle).toHaveBeenCalledWith(expect.stringContaining('legalScan.js'))
  })
  it('refuses a missing bundle with fixed words', async () => {
    const scanner = loadLegalScanner({
      distDir: 'dist',
      loadBundle: () => {
        throw new Error('ENOENT')
      },
    })
    await expect(scanner.scan({ workspaceRoot: 'workspace', input: {} })).rejects.toThrow(
      'legalScan.js could not be loaded',
    )
  })
  it('refuses a bundle without the scan export', async () => {
    const scanner = loadLegalScanner({ distDir: 'dist', loadBundle: () => ({}) })
    await expect(scanner.scan({ workspaceRoot: 'workspace', input: {} })).rejects.toThrow(
      'unexpected shape',
    )
  })
})
