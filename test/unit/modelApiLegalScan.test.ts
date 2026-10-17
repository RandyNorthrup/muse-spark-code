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
import { MODEL_API_TOOLS } from '../../src/shared/constants'

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
  it('names an unoffered tool as unknown, running nothing', async () => {
    const outcome = await runLegalScanCall({}, undefined, true, new AbortController().signal)
    expect(outcome).toEqual({
      ok: false,
      reason: `unknown tool ${MODEL_API_TOOLS.legalScan}`,
      isRestricted: false,
    })
  })
})
