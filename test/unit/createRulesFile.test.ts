import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { rulesFileTemplate } from '../../src/core/context/rulesTemplate'
import { type CreateRulesFileDeps, createRulesFile } from '../../src/host/commands/createRulesFile'
import type { ProcessResult } from '../../src/host/backend/sandboxSetup'
import { FakeLogOutputChannel } from './helpers/fakes'

const ROOT = '/projects/demo'
const TARGET = path.join(ROOT, 'AGENTS.md')
const OK: ProcessResult = { exitCode: 0, stdout: '', stderr: '' }

function harness(
  options: {
    workspaceRoot?: string | undefined
    isTrusted?: boolean
    existing?: readonly string[]
    /** What `muse init` does; undefined means the CLI is absent. */
    init?: (files: Set<string>) => ProcessResult
  } = {},
) {
  const files = new Set(options.existing)
  const writes: [string, string][] = []
  const opened: string[] = []
  const information: string[] = []
  const warnings: string[] = []
  let initRuns = 0
  const log = new FakeLogOutputChannel()
  const deps: CreateRulesFileDeps = {
    workspaceRoot: 'workspaceRoot' in options ? options.workspaceRoot : ROOT,
    isWorkspaceTrusted: () => options.isTrusted ?? true,
    fileExists: (fsPath) => Promise.resolve(files.has(fsPath)),
    writeFile: (fsPath, content) => {
      files.add(fsPath)
      writes.push([fsPath, content])
      return Promise.resolve()
    },
    openFile: (fsPath) => {
      opened.push(fsPath)
      return Promise.resolve()
    },
    runInit: () => {
      if (options.init === undefined) {
        return undefined
      }
      initRuns += 1
      return Promise.resolve(options.init(files))
    },
    showInformation: (message) => {
      information.push(message)
    },
    showWarning: (message) => {
      warnings.push(message)
    },
    log,
  }
  return {
    deps,
    writes,
    opened,
    information,
    warnings,
    log,
    initRuns: () => initRuns,
  }
}

describe('createRulesFile', () => {
  it('warns without a workspace', async () => {
    const t = harness({ workspaceRoot: undefined })
    await createRulesFile(t.deps)
    expect(t.warnings).toEqual(['Open a folder first; AGENTS.md lives in the workspace root.'])
    expect(t.writes).toEqual([])
    expect(t.opened).toEqual([])
  })

  it('opens an existing file without touching it or the CLI', async () => {
    const t = harness({ existing: [TARGET], init: () => OK })
    await createRulesFile(t.deps)
    expect(t.information).toEqual(['AGENTS.md already exists in this workspace; opening it.'])
    expect(t.opened).toEqual([TARGET])
    expect(t.writes).toEqual([])
    expect(t.initRuns()).toBe(0)
  })

  it('runs muse init in a trusted workspace and opens the file it wrote', async () => {
    const t = harness({
      init: (files) => {
        files.add(TARGET)
        return OK
      },
    })
    await createRulesFile(t.deps)
    expect(t.initRuns()).toBe(1)
    expect(t.writes).toEqual([])
    expect(t.opened).toEqual([TARGET])
    expect(t.information).toEqual([
      'AGENTS.md created. Muse reads it as project rules from the next conversation.',
    ])
    expect(t.log.info).toHaveBeenCalledWith(`muse init wrote ${TARGET}`)
  })

  it('writes the template when muse init fails, logging the reason', async () => {
    const t = harness({ init: () => ({ exitCode: 1, stdout: '', stderr: 'boom\nmore' }) })
    await createRulesFile(t.deps)
    expect(t.writes).toEqual([[TARGET, rulesFileTemplate('demo')]])
    expect(t.opened).toEqual([TARGET])
    expect(t.log.warn).toHaveBeenCalledWith(
      'muse init exited 1 without writing AGENTS.md: boom; writing the template instead',
    )
  })

  it('writes the template when muse init exits 0 without a file', async () => {
    const t = harness({ init: () => OK })
    await createRulesFile(t.deps)
    expect(t.writes).toHaveLength(1)
    expect(t.log.warn).toHaveBeenCalledWith(
      'muse init exited 0 without writing AGENTS.md; writing the template instead',
    )
  })

  it('never runs the CLI in Restricted Mode and writes the template instead', async () => {
    const t = harness({ isTrusted: false, init: () => OK })
    await createRulesFile(t.deps)
    expect(t.initRuns()).toBe(0)
    expect(t.writes).toEqual([[TARGET, rulesFileTemplate('demo')]])
    expect(t.opened).toEqual([TARGET])
  })

  it('writes the template without the CLI', async () => {
    const t = harness()
    await createRulesFile(t.deps)
    expect(t.writes[0]?.[1]).toContain(
      'Muse Code reads this file as project rules when it runs in this directory.',
    )
    expect(t.log.info).toHaveBeenCalledWith(`Wrote the AGENTS.md template to ${TARGET}`)
  })
})
