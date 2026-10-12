import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { instructionsFor } from '../../src/core/backends/modelapi/instructions'

const facts = {
  workspaceRoot: '/workspace',
  platform: 'linux' as const,
  shellToolName: 'bash',
  shellName: 'bash',
  hasShell: false,
  hasMemory: false,
  hasCodeIntel: false,
  today: '2026-10-11',
  environment: { git: undefined },
  context: { rules: undefined, skills: [], agents: [], memory: [] },
}
describe('ACPDOG host facts', () => {
  for (const hostKind of ['acp', 'cli', 'exec'] as const) {
    it.each(['meta', 'provider'] as const)(`keeps ${hostKind} facts truthful (%s)`, (identity) => {
      const input = Object.assign(
        {},
        facts,
        { hostKind },
        identity === 'meta'
          ? {}
          : { identity: { provider: 'anthropic', model: 'anthropic/claude' } },
      )
      const text = instructionsFor(input)
      expect(text).not.toMatch(/Visual Studio Code|VS Code|Restricted Mode/u)
      expect(text).toContain('no shell tool')
      expect(text).toBe(
        JSON.parse(
          readFileSync(
            new URL(
              `../fixtures/golden-requests/hosts/${hostKind}-${identity}.json`,
              import.meta.url,
            ),
            'utf8',
          ),
        ),
      )
    })
  }
  it('keeps VS Code’s default prefix byte-identical', () => {
    expect(instructionsFor(Object.assign({}, facts, { hostKind: 'vscode' as const }))).toBe(
      instructionsFor(facts),
    )
  })
  it('does not claim VS Code diagnostics or language services in another host', () => {
    const text = instructionsFor(
      Object.assign({}, facts, {
        hostKind: 'acp' as const,
        hasCodeIntel: true,
        verify: { isDiagnosticsOn: true, checks: [] },
      }),
    )
    expect(text).not.toContain('VS Code')
  })
})
