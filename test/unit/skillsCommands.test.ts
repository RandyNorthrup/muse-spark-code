// The skills commands' unreadable CLI output
// (src/host/commands/skillsCommands.ts): a catalog or import report that is
// not JSON, or not the documented shape, is said in fixed words (the CLI's
// text can name paths) with the failure's kind kept in the log.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { Logger } from '../../src/host/logger'
import {
  importSkills,
  type ImportSkillsDeps,
  manageSkills,
  type ManageSkillsDeps,
} from '../../src/host/commands/skillsCommands'

function recordLog() {
  const warnings: string[] = []
  const log: Logger = {
    trace: () => undefined,
    info: () => undefined,
    warn: (message) => {
      warnings.push(message)
    },
    error: () => undefined,
  }
  return { log, warnings }
}

function base() {
  const errors: string[] = []
  return {
    errors,
    workspaceRoot: undefined,
    isWorkspaceTrusted: () => true,
    showInformation: () => undefined,
    showError: (message: string) => {
      errors.push(message)
    },
    confirmRestart: () => Promise.resolve(false),
    restart: () => Promise.resolve(),
  }
}

describe('manageSkills', () => {
  it('says an unreadable catalog in fixed words, keeping the kind', async () => {
    const { log, warnings } = recordLog()
    const seen = base()
    const deps: ManageSkillsDeps = {
      ...seen,
      log,
      runCli: () => Promise.resolve({ exitCode: 0, stdout: '{nope', stderr: '' }),
      pickSkills: () => Promise.resolve(undefined),
    }
    await manageSkills(deps)
    expect(seen.errors).toEqual([UI_TEXT.skillsListFailed])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Error')
    expect(warnings[0]).not.toContain('{nope')
  })
})

describe('importSkills', () => {
  it('says an unreadable import report in fixed words, keeping the kind', async () => {
    const { log, warnings } = recordLog()
    const seen = base()
    const deps: ImportSkillsDeps = {
      ...seen,
      log,
      runCli: () => Promise.resolve({ exitCode: 0, stdout: '{"report":1}', stderr: '' }),
      pickSource: () => Promise.resolve('claude'),
      confirmImport: () => Promise.resolve(true),
    }
    await importSkills(deps)
    expect(seen.errors).toEqual([UI_TEXT.importFailed])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Error')
  })
})
