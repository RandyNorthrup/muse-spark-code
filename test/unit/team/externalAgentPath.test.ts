import { describe, expect, it } from 'vitest'
import { isExternalAgentProtectedWrite } from '../../../src/host/team/externalOrchestrator'

describe('an external agent write of a protected path', () => {
  it('names a protected segment whichever separator the resolved path uses', () => {
    expect(isExternalAgentProtectedWrite(String.raw`C:\repo\.git\config`)).toBe(true)
    expect(isExternalAgentProtectedWrite('C:/repo/.github/workflows/ci.yml')).toBe(true)
    expect(isExternalAgentProtectedWrite(String.raw`C:\repo\src\a.ts`)).toBe(false)
    expect(isExternalAgentProtectedWrite('/work/app/src/a.ts')).toBe(false)
    expect(isExternalAgentProtectedWrite('/work/app/AGENTS.md')).toBe(true)
  })
})
