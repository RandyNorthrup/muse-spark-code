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
import { scanLegal } from '../../src/core/legal/scan'
import { LEGAL_SCAN_TOOL_MODEL_TEXT, MODEL_API_TOOLS, UI_TEXT } from '../../src/shared/constants'
import type { LegalScanRunner } from '../../src/shared/legal'
import { countingSnapshot } from './legal/helpers'

const PROJECT = {
  LICENSE: 'MIT License\n\nCopyright (c) 2026 Example Corp\n',
  'package.json': JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
  'src/ok.ts':
    '// Copyright (c) 2026 Example Corp\n// SPDX-License-Identifier: MIT\nexport const value = 1\n',
}

/** The real deterministic scanner over a counted snapshot, as lane B calls it. */
function realScanner(): { run: LegalScanRunner; reads: () => number } {
  const counted = countingSnapshot(PROJECT)
  return {
    run: (input, signal) =>
      Promise.resolve(
        scanLegal(counted.snapshot, {
          headerPolicy: input.headerPolicy ?? 'optional',
          ...(input.paths && { paths: input.paths }),
          signal,
        }),
      ),
    reads: counted.reads,
  }
}

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
    const { run, reads } = realScanner()
    const outcome = await runLegalScanCall({ paths: ['package.json'] }, run, true, SIGNAL)
    expect(reads()).toBeGreaterThan(0)
    if (!outcome.ok) throw new Error(outcome.reason)
    const parsed: unknown = JSON.parse(outcome.json)
    expect(parsed).toMatchObject({
      version: 1,
      findings: [],
      disclaimer: UI_TEXT.legalScanDisclaimer,
    })
  })

  it('uses the caller’s installed disclaimer when the adapter is shared', async () => {
    const { run } = realScanner()
    const disclaimer = 'Technický přehled. Nejde o právní radu.'
    const outcome = await runLegalScanCall({}, run, true, SIGNAL, disclaimer)
    if (!outcome.ok) throw new Error(outcome.reason)
    const parsed: unknown = JSON.parse(outcome.json)
    expect(parsed).toMatchObject({ disclaimer })
  })

  // Read-only enforcement: the tool exposes no write operation, so a write,
  // a command, a fix or an install arrives only as an unknown key — refused
  // by the strict schema before the scanner reads anything.
  it.each([[{ write: true }], [{ command: 'make fix' }], [{ fix: true }], [{ install: true }]])(
    'refuses a write/exec attempt without running the scan: %j',
    async (args) => {
      const { run, reads } = realScanner()
      const outcome = await runLegalScanCall(args, run, true, SIGNAL)
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.reason).toContain('invalid arguments')
      }
      expect(reads()).toBe(0)
    },
  )

  it('refuses in an untrusted workspace before reading anything', async () => {
    const { run, reads } = realScanner()
    const outcome = await runLegalScanCall({}, run, false, SIGNAL)
    expect(outcome).toEqual({
      ok: false,
      reason: LEGAL_SCAN_TOOL_MODEL_TEXT.legalScanRestrictedMode,
      isRestricted: true,
    })
    expect(reads()).toBe(0)
  })

  it('starts nothing for a stopped turn', async () => {
    const { run, reads } = realScanner()
    const controller = new AbortController()
    controller.abort()
    await expect(runLegalScanCall({}, run, true, controller.signal)).rejects.toThrow('cancelled')
    expect(reads()).toBe(0)
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
