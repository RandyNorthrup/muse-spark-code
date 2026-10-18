// The report command's failure rules: a journal that cannot be read
// degrades the report instead of failing it, while a build or write failure
// answers internal with its own sentence and writes nothing.
import { describe, expect, it } from 'vitest'
import { runReportCommand, type RunReportDeps } from '../../src/runtime/reportCommand'
import { EXEC_EXIT } from '../../src/shared/constants'

/** An error sink the passing paths never touch. */
function ignoreError(): void {
  // Nothing to report on these paths.
}

function unusedPrintError(_line: string): void {
  ignoreError()
}

function deps(overrides: Partial<RunReportDeps>): RunReportDeps {
  return {
    version: '0.0.0-test',
    nodeVersion: process.version,
    platform: process.platform,
    pathEntries: [],
    homeDir: 'home-dir-for-test',
    localAppData: undefined,
    xdgConfigHome: undefined,
    museBinaryPath: '',
    fileExists: () => false,
    readTextFile: () => undefined,
    listDirectory: () => [],
    hasEnvironmentApiKey: false,
    options: { description: 'test report', includeFacts: true, includeEvents: true },
    readStoredKeyPresence: () => Promise.resolve(false),
    nowMs: Date.now(),
    readJournal: () => Promise.resolve({ entries: [], recordingUnavailable: false }),
    writeStdout: () => {
      throw new Error('unexpected stdout write')
    },
    writeOutFile: () => Promise.resolve(),
    printError: unusedPrintError,
    ...overrides,
  }
}

describe('runReportCommand failure rules', () => {
  it('degrades a journal that cannot be read instead of failing', async () => {
    const written: string[] = []
    const exit = await runReportCommand(
      deps({
        readJournal: () => Promise.reject(new Error('journal locked')),
        writeStdout: (text) => {
          written.push(text)
        },
      }),
    )
    expect(exit).toBe(EXEC_EXIT.ok)
    expect(written).toHaveLength(1)
  })

  it('answers internal with its sentence when the build fails, writing nothing', async () => {
    const errors: string[] = []
    const exit = await runReportCommand(
      deps({
        readStoredKeyPresence: () => Promise.reject(new Error('store locked')),
        printError: (line) => {
          errors.push(line)
        },
      }),
    )
    expect(exit).toBe(EXEC_EXIT.internal)
    expect(errors).toEqual(['The report could not be built.'])
  })

  it('answers internal with its sentence when the save fails', async () => {
    const errors: string[] = []
    const exit = await runReportCommand(
      deps({
        options: {
          description: 'test report',
          includeFacts: true,
          includeEvents: true,
          out: 'report.txt',
        },
        writeOutFile: () => Promise.reject(new Error('disk denied')),
        printError: (line) => {
          errors.push(line)
        },
      }),
    )
    expect(exit).toBe(EXEC_EXIT.internal)
    expect(errors).toEqual(['The report could not be saved.'])
  })
})
