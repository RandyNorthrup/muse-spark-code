// The read-only legal scan's tool, offered and refused (M97, lane B):
// listed only in a trusted workspace, strict arguments, trust and
// cancellation rechecked per call, and a validated result.

import { describe, expect, it, vi } from 'vitest'
import type { LegalFinding, LegalScanResult } from '../../src/shared/legal'
import { LEGAL_RESULT_VERSION } from '../../src/shared/constants'
import { ideLegalScanTools, type IdeLegalScanDeps } from '../../src/host/ide/legalScanTool'

function finding(): LegalFinding {
  return {
    id: 'license/package',
    severity: 'should-fix',
    category: 'dependencyLicense',
    packageName: 'left-pad',
    packageVersion: '1.3.0',
    licenseExpression: 'WTFPL',
    evidenceSource: 'The bundled license table.',
    confidence: 1,
    explanation: 'The dependency declares a license outside the allowlist.',
    recommendation: 'Replace the dependency or add an exception.',
    fixable: false,
  }
}

function result(): LegalScanResult {
  return {
    version: LEGAL_RESULT_VERSION,
    ruleVersion: 'r1',
    dataVersion: 'd1',
    scope: '',
    distribution: 'The workspace ships as a VS Code extension.',
    exclusions: [],
    incompleteChecks: [],
    findings: [finding()],
  }
}

function deps(overrides?: Partial<IdeLegalScanDeps>): {
  deps: IdeLegalScanDeps
  calls: unknown[]
} {
  const calls: unknown[] = []
  return {
    deps: {
      isOffered: () => true,
      runScan: (input) => {
        calls.push(input)
        return Promise.resolve(result())
      },
      log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ...overrides,
    },
    calls,
  }
}

async function call(deps: IdeLegalScanDeps, args: Record<string, unknown>, signal?: AbortSignal) {
  const tools = ideLegalScanTools(deps)
  expect(tools).toHaveLength(1)
  return await tools[0]?.call(args, signal ?? new AbortController().signal)
}

describe('ideLegalScanTools', () => {
  it('lists one read-only tool in a trusted workspace, none untrusted', () => {
    const { deps: offered } = deps()
    const tools = ideLegalScanTools(offered)
    expect(tools.map((tool) => tool.name)).toEqual(['legalScan'])
    expect(tools[0]?.annotations).toMatchObject({ readOnlyHint: true })
    expect(tools[0]?.inputSchema).toMatchObject({ additionalProperties: false })
    const { deps: refused } = deps({ isOffered: () => false })
    expect(ideLegalScanTools(refused)).toEqual([])
  })

  it('runs the scan and returns its validated result as JSON', async () => {
    const { deps: offered, calls } = deps()
    const text = await call(offered, { paths: ['package.json'] })
    expect(calls).toEqual([{ paths: ['package.json'] }])
    expect(JSON.parse(String(text))).toEqual(result())
  })

  it('scans the whole workspace on empty arguments', async () => {
    const { deps: offered, calls } = deps()
    await call(offered, {})
    expect(calls).toEqual([{}])
  })

  // Read-only enforcement: the tool exposes no write operation, so a write,
  // a command, a fix or an install arrives only as an unknown key — refused
  // by the strict schema before the scanner is asked.
  it.each([
    [{ write: true }],
    [{ command: 'rm -rf out' }],
    [{ fix: true }],
    [{ install: true }],
    [{ paths: ['a.ts'], applyFixes: true }],
  ])('refuses a write/exec attempt without running the scan: %j', async (args) => {
    const { deps: offered, calls } = deps()
    await expect(call(offered, args)).rejects.toThrow('invalid arguments')
    expect(calls).toEqual([])
  })

  it('lists no tool after trust went away, and a stale handle refuses', async () => {
    let isTrusted = true
    const { deps: offered, calls } = deps({ isOffered: () => isTrusted })
    const tools = ideLegalScanTools(offered)
    expect(tools).toHaveLength(1)
    isTrusted = false
    expect(ideLegalScanTools(offered)).toEqual([])
    await expect(tools[0]?.call({}, new AbortController().signal)).rejects.toThrow('untrusted')
    expect(calls).toEqual([])
  })

  it('refuses evidence after trust is revoked during the scan', async () => {
    let isTrusted = true
    const { deps: offered } = deps({
      isOffered: () => isTrusted,
      runScan: () => {
        isTrusted = false
        return Promise.resolve(result())
      },
    })
    await expect(call(offered, {})).rejects.toThrow('untrusted')
  })

  it('starts nothing for a caller that already stopped waiting', async () => {
    const { deps: offered, calls } = deps()
    const controller = new AbortController()
    controller.abort()
    await expect(call(offered, {}, controller.signal)).rejects.toThrow('cancelled')
    expect(calls).toEqual([])
  })

  it('reports a scan cancelled in flight instead of answering late', async () => {
    const controller = new AbortController()
    const { deps: offered } = deps({
      runScan: () => {
        controller.abort()
        return Promise.resolve(result())
      },
    })
    await expect(call(offered, {}, controller.signal)).rejects.toThrow('cancelled')
  })

  it('lets a scan failure through as the tool error', async () => {
    const { deps: offered } = deps({
      runScan: () => Promise.reject(new Error('disk went away')),
    })
    await expect(call(offered, {})).rejects.toThrow('disk went away')
  })

  it('refuses an invalid result and logs its shape, never the raw value', async () => {
    const errors: unknown[] = []
    const { deps: offered } = deps({
      log: {
        trace: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: (...args: unknown[]) => void errors.push(args),
      },
      runScan: () =>
        Promise.resolve({ version: 1, findings: 'nope' } as unknown as LegalScanResult),
    })
    await expect(call(offered, {})).rejects.toThrow('invalid result')
    expect(errors).toHaveLength(1)
  })
})
