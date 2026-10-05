// The Model API backend's native `legal_scan` (M97, lane B): offered only
// with a scanner behind it, classed as a read, strict arguments, trust and
// cancellation enforced, and a validated result.

import { describe, expect, it } from 'vitest'
import {
  LEGAL_SCAN_DESCRIPTION,
  LEGAL_SCAN_PARAMETERS,
  runLegalScanCall,
} from '../../src/core/backends/modelapi/legalScanTool'
import { classifyTool, toolDefinitions } from '../../src/core/backends/modelapi/tools'
import {
  UI_TEXT,
  LEGAL_RESULT_VERSION,
  MODEL_API_MODEL_TEXT,
  MODEL_API_TOOLS,
} from '../../src/shared/constants'
import type { LegalScanResult, LegalScanRunner } from '../../src/shared/legal'

function result(): LegalScanResult {
  return {
    version: LEGAL_RESULT_VERSION,
    ruleVersion: 'r1',
    dataVersion: 'd1',
    scope: '',
    distribution: 'The workspace ships as a VS Code extension.',
    exclusions: [],
    incompleteChecks: [],
    findings: [],
  }
}

function runner(): { run: LegalScanRunner; calls: unknown[] } {
  const calls: unknown[] = []
  return {
    run: (input) => {
      calls.push(input)
      return Promise.resolve(result())
    },
    calls,
  }
}

const SIGNAL = new AbortController().signal

const failingScan: LegalScanRunner = () => Promise.reject(new Error('disk went away'))

describe('legal_scan definition', () => {
  it('is offered only with a scanner behind it, as a strict read', () => {
    expect(toolDefinitions('linux').map((tool) => tool.name)).not.toContain(
      MODEL_API_TOOLS.legalScan,
    )
    const offered = toolDefinitions('linux', {
      hasShell: true,
      hasSkills: false,
      hasLegalScan: true,
    })
    const definition = offered.find((tool) => tool.name === MODEL_API_TOOLS.legalScan)
    expect(definition).toMatchObject({
      description: LEGAL_SCAN_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: LEGAL_SCAN_PARAMETERS,
        required: [],
        additionalProperties: false,
      },
      strict: false,
    })
    expect(classifyTool(MODEL_API_TOOLS.legalScan)).toBe('read')
  })
})

describe('runLegalScanCall', () => {
  it('runs the scan and answers its validated JSON', async () => {
    const { run, calls } = runner()
    const outcome = await runLegalScanCall({ paths: ['package.json'] }, run, true, SIGNAL)
    expect(calls).toEqual([{ paths: ['package.json'] }])
    expect(outcome).toEqual({
      ok: true,
      json: JSON.stringify({ ...result(), disclaimer: UI_TEXT.legalScanDisclaimer }),
    })
  })

  it('scans the whole workspace on empty arguments', async () => {
    const { run, calls } = runner()
    const outcome = await runLegalScanCall({}, run, true, SIGNAL)
    expect(outcome.ok).toBe(true)
    expect(calls).toEqual([{}])
  })

  // Read-only enforcement: the tool exposes no write operation, so a write,
  // a command, a fix or an install arrives only as an unknown key — refused
  // by the strict schema before the scanner is asked.
  it.each([[{ write: true }], [{ command: 'make fix' }], [{ fix: true }], [{ install: true }]])(
    'refuses a write/exec attempt without running the scan: %j',
    async (args) => {
      const { run, calls } = runner()
      const outcome = await runLegalScanCall(args, run, true, SIGNAL)
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.reason).toContain('invalid arguments')
      }
      expect(calls).toEqual([])
    },
  )

  it('names an unoffered tool as unknown, running nothing', async () => {
    const outcome = await runLegalScanCall({}, undefined, true, SIGNAL)
    expect(outcome).toEqual({
      ok: false,
      reason: `unknown tool ${MODEL_API_TOOLS.legalScan}`,
      isRestricted: false,
    })
  })

  it('refuses in an untrusted workspace before reading anything', async () => {
    const { run, calls } = runner()
    const outcome = await runLegalScanCall({}, run, false, SIGNAL)
    expect(outcome).toEqual({
      ok: false,
      reason: MODEL_API_MODEL_TEXT.legalScanRestrictedMode,
      isRestricted: true,
    })
    expect(calls).toEqual([])
  })

  it('starts nothing for a stopped turn', async () => {
    const { run, calls } = runner()
    const controller = new AbortController()
    controller.abort()
    await expect(runLegalScanCall({}, run, true, controller.signal)).rejects.toThrow('cancelled')
    expect(calls).toEqual([])
  })

  it('lets a scan failure through', async () => {
    await expect(runLegalScanCall({}, failingScan, true, SIGNAL)).rejects.toThrow('disk went away')
  })

  it('refuses an invalid result', async () => {
    const broken = (() =>
      Promise.resolve({ version: 1, findings: 'nope' })) as unknown as LegalScanRunner
    const outcome = await runLegalScanCall({}, broken, true, SIGNAL)
    expect(outcome).toEqual({
      ok: false,
      reason: 'the legal scan returned an invalid result',
      isRestricted: false,
    })
  })
})
