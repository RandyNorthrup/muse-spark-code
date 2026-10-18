// The Model API backend's native `legal_scan` (M97, lane B): offered only
// with a scanner behind it, classed as a read, strict arguments, trust and
// cancellation enforced, and a validated result.

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LEGAL_SCAN_DESCRIPTION,
  LEGAL_SCAN_PARAMETERS,
  runLegalScanCall,
} from '../../src/core/backends/modelapi/legalScanTool'
import { classifyTool, toolDefinitions } from '../../src/core/backends/modelapi/tools'
import { runLegalScan } from '../../src/core/legal/entry'
import { LEGAL_SCAN_TOOL_MODEL_TEXT, MODEL_API_TOOLS, UI_TEXT } from '../../src/shared/constants'
import { legalScanResultSchema } from '../../src/shared/legal'
import type { LegalScanRunner } from '../../src/shared/legal'

// The committed offline fixture workspaces, read through the production
// filesystem snapshot: every scan below exercises the shipped entry's input
// parsing, workspace reading and paths/policy forwarding.
const CLEAN_ROOT = fileURLToPath(new URL('../fixtures/legal/clean/', import.meta.url))
// The hazardous tree (also scanned by legalGuards.test.ts, which pins that
// its prompt payloads never reach a report): its headerless source makes the
// header policy observable.
const TREE_ROOT = fileURLToPath(new URL('../fixtures/legal/tree/', import.meta.url))

/** The production scan entry behind the `LegalScanRunner` contract. */
function productionRunner(workspaceRoot: string): LegalScanRunner {
  return async (input, signal) => {
    const handle = await runLegalScan({ workspaceRoot, input, signal })
    return handle.result
  }
}

// A root the production snapshot refuses: any runner invocation throws, so a
// refusal outcome proves the adapter never reached the scanner.
const MISSING_ROOT = fileURLToPath(new URL('../fixtures/legal/no-such-workspace/', import.meta.url))

const SIGNAL = new AbortController().signal

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
  it('runs the real scan and answers its validated JSON with the disclaimer', async () => {
    const outcome = await runLegalScanCall(
      { paths: ['package.json'] },
      productionRunner(CLEAN_ROOT),
      true,
      SIGNAL,
    )
    if (!outcome.ok) throw new Error(outcome.reason)
    const parsed = legalScanResultSchema.safeParse(JSON.parse(outcome.json))
    expect(parsed.success).toBe(true)
    if (!parsed.success) throw new Error('legal_scan JSON failed its schema')
    expect(parsed.data).toMatchObject({
      version: 1,
      scope: 'package.json',
      findings: [],
      disclaimer: UI_TEXT.legalScanDisclaimer,
    })
    const evidence = (parsed.data.evidenceFiles ?? []).map((entry) => entry.path)
    expect(evidence).toContain('package.json')
  })

  it('uses the caller’s installed disclaimer when the adapter is shared', async () => {
    const disclaimer = 'Technický přehled. Nejde o právní radu.'
    const outcome = await runLegalScanCall(
      {},
      productionRunner(CLEAN_ROOT),
      true,
      SIGNAL,
      disclaimer,
    )
    if (!outcome.ok) throw new Error(outcome.reason)
    const parsed = legalScanResultSchema.safeParse(JSON.parse(outcome.json))
    expect(parsed.success).toBe(true)
    if (!parsed.success) throw new Error('legal_scan JSON failed its schema')
    expect(parsed.data).toMatchObject({ version: 1, disclaimer })
    expect((parsed.data.evidenceFiles ?? []).length).toBeGreaterThan(0)
  })

  it('forwards the header policy to the production scan', async () => {
    const outcome = await runLegalScanCall(
      { headerPolicy: 'required' },
      productionRunner(TREE_ROOT),
      true,
      SIGNAL,
    )
    if (!outcome.ok) throw new Error(outcome.reason)
    const parsed = legalScanResultSchema.safeParse(JSON.parse(outcome.json))
    expect(parsed.success).toBe(true)
    if (!parsed.success) throw new Error('legal_scan JSON failed its schema')
    expect(parsed.data.findings).toContainEqual(
      expect.objectContaining({
        category: 'copyrightHeader',
        file: 'src/noheader.js',
        severity: 'should-fix',
      }),
    )
  })

  // Read-only enforcement: the tool exposes no write operation, so a write,
  // a command, a fix or an install arrives only as an unknown key — refused
  // by the strict schema before the scanner runs (any run would throw on the
  // missing root instead of refusing).
  it.each([[{ write: true }], [{ command: 'make fix' }], [{ fix: true }], [{ install: true }]])(
    'refuses a write/exec attempt without running the scan: %j',
    async (args) => {
      const outcome = await runLegalScanCall(args, productionRunner(MISSING_ROOT), true, SIGNAL)
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.reason).toContain('invalid arguments')
      }
    },
  )

  it('refuses in an untrusted workspace before reaching the scanner', async () => {
    const outcome = await runLegalScanCall({}, productionRunner(MISSING_ROOT), false, SIGNAL)
    expect(outcome).toEqual({
      ok: false,
      reason: LEGAL_SCAN_TOOL_MODEL_TEXT.legalScanRestrictedMode,
      isRestricted: true,
    })
  })

  it('starts nothing for a stopped turn', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runLegalScanCall({}, productionRunner(MISSING_ROOT), true, controller.signal),
    ).rejects.toThrow('cancelled')
  })

  it('names an unoffered tool as unknown, running nothing', async () => {
    const outcome = await runLegalScanCall({}, undefined, true, new AbortController().signal)
    expect(outcome).toEqual({
      ok: false,
      reason: `unknown tool ${MODEL_API_TOOLS.legalScan}`,
      isRestricted: false,
    })
  })
})
