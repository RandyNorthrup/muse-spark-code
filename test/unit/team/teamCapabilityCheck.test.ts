// Lane R (M96, PLAN.md D75): the capability check.

import { describe, expect, it } from 'vitest'
import {
  checkRoleCapability,
  type TeamCapabilitySource,
  type TeamModelCapabilities,
} from '../../../src/core/team/capabilityCheck'

const sourceFor = (
  models: Readonly<Record<string, TeamModelCapabilities>>,
): TeamCapabilitySource => ({
  capabilitiesOf: (model) => models[model],
})

const CAPABLE = {
  toolCalling: true,
  contextWindow: 200_000,
  imageInput: true,
  reasoning: true,
} satisfies TeamModelCapabilities

const RESEARCH = { id: 'research', groups: ['read', 'report'] } as const
const ENGINEERING = { id: 'engineering', groups: ['read', 'write', 'report'] } as const

describe('checkRoleCapability', () => {
  it('refuses a model without tool calling', () => {
    const verdict = checkRoleCapability(
      'chat-only',
      RESEARCH,
      sourceFor({ 'chat-only': { ...CAPABLE, toolCalling: false } }),
    )
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain('research')
  })

  it('refuses a model below the minimum window, and allows exactly it', () => {
    const source = sourceFor({
      small: { ...CAPABLE, contextWindow: 16_384 },
      exact: { ...CAPABLE, contextWindow: 32_768 },
    })
    const refused = checkRoleCapability('small', RESEARCH, source)
    expect(refused.allowed).toBe(false)
    expect(refused.reason).toContain('32')
    expect(checkRoleCapability('exact', ENGINEERING, source).allowed).toBe(true)
  })

  it('warns below the role recommendation, per role', () => {
    const source = sourceFor({ mid: { ...CAPABLE, contextWindow: 100_000 } })
    const research = checkRoleCapability('mid', RESEARCH, source)
    expect(research.allowed).toBe(true)
    expect(research.warnings.map((warning) => warning.code)).toEqual(['window'])
    const engineering = checkRoleCapability('mid', ENGINEERING, source)
    expect(engineering.warnings).toEqual([])
  })

  it('warns without image input for design and the image roles, and without reasoning for builders', () => {
    const source = sourceFor({
      blind: { ...CAPABLE, imageInput: false },
      plain: { ...CAPABLE, reasoning: false },
    })
    expect(
      checkRoleCapability(
        'blind',
        { id: 'design', groups: ['read', 'report'] },
        source,
      ).warnings.map((warning) => warning.code),
    ).toEqual(['images'])
    expect(
      checkRoleCapability('blind', RESEARCH, source).warnings.map((warning) => warning.code),
    ).toEqual([])
    expect(
      checkRoleCapability('plain', ENGINEERING, source).warnings.map((warning) => warning.code),
    ).toEqual(['reasoning'])
    expect(
      checkRoleCapability('plain', RESEARCH, source).warnings.map((warning) => warning.code),
    ).toEqual([])
  })

  it('warns on an unknown model or field, and never refuses for them', () => {
    const source = sourceFor({})
    const unknown = checkRoleCapability('stranger', RESEARCH, source)
    expect(unknown.allowed).toBe(true)
    expect(unknown.warnings.map((warning) => warning.code)).toEqual(['unknown'])
    expect(unknown.warnings[0]?.message).toContain('stranger')
    const partial = checkRoleCapability(
      'half',
      ENGINEERING,
      sourceFor({ half: { toolCalling: true } }),
    )
    expect(partial.allowed).toBe(true)
    expect(partial.warnings.map((warning) => warning.code)).toEqual(['unknown'])
  })
})
