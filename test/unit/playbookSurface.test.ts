import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import { acpPlaybook, type AcpPlaybookBundle } from '../../src/acp/playbook'
import {
  FilePlaybookJournal,
  PlaybookHistoryLostError,
} from '../../src/core/orchestration/playbook/journal'
import { requireFile } from '../../src/host/lazyBundle'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  parsePlaybookCommand,
  runPlaybookCli,
  runPlaybookCommand,
} from '../../src/runtime/playbook/command'
import {
  parsePlaybookCommand as entryParsePlaybookCommand,
  runPlaybookCommand as entryRunPlaybookCommand,
} from '../../src/runtime/playbook/playbookEntry'
import { createPlaybookSurface } from '../../src/runtime/playbook/surface'
import { UI_TEXT } from '../../src/shared/constants'

/** A scratch workspace/data pair, removed when the test finishes. */
function scratchFolders(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  const workspaceFolder = path.join(directory, 'workspace')
  mkdirSync(workspaceFolder, { recursive: true })
  return { workspaceFolder, agentDataFolder: path.join(directory, 'data') }
}

function surface() {
  const { workspaceFolder, agentDataFolder } = scratchFolders('m116w-surface-')
  return createPlaybookSurface({
    agentDataFolder,
    workspaceFolder,
    teamId: 'panel',
    laneId: 'surface',
  })
}

/** The shipped bundle entry with production's adapter shape
 * (`playbookBundle` in `src/runtime/main.ts`): the entry's own parse, locale
 * installation and command wiring all run, not a hand-built double. */
function entryBundle(): AcpPlaybookBundle {
  return {
    parsePlaybookCommand: (argv) => entryParsePlaybookCommand(argv),
    runPlaybookCommand: (command, surfacePort) =>
      entryRunPlaybookCommand(command, surfacePort, UI_TEXT, 'en'),
  }
}

describe('M116 playbook surface adapter (W)', () => {
  it('reads defaults and persists user-initiated changes durably', async () => {
    const port = surface()
    const first = await port.read()
    const snapshot = first as { settings: { teamId: string }; records: readonly unknown[] }
    expect(snapshot.settings.teamId).toBe('panel')
    expect(snapshot.records).toEqual([])
    const changed = (await port.change({
      rule: 'offload',
      enabled: false,
      reason: 'Owner decision.',
    })) as { settings: { rules: { offload: { enabled: boolean; actor: string } } } }
    expect(changed.settings.rules.offload.enabled).toBe(false)
    // The adapter stamps the trusted actor, never a request body.
    expect(changed.settings.rules.offload.actor).toBe('owner')
    const reread = (await port.read()) as typeof changed
    expect(reread.settings.rules.offload.enabled).toBe(false)
  })

  it('sets and clears the fallback reviewer through the authority path', async () => {
    const port = surface()
    const set = await runPlaybookCommand(
      { view: 'settings', change: { fallbackReviewer: 'r1', reason: 'Owner names.' } },
      port,
    )
    expect(set.ok).toBe(true)
    expect(set.text).toContain('r1')
    const cleared = await runPlaybookCommand(
      { view: 'settings', change: { fallbackReviewer: 'off' } },
      port,
    )
    expect(cleared.ok).toBe(true)
    expect(cleared.text).toContain('No fallback reviewer named')
  })

  it('routes the CLI playbook command and reports usage for bad syntax', async () => {
    expect(parseCommandLine(['playbook', 'status'])).toEqual({
      command: 'playbook',
      argv: ['status'],
    })
    const port = surface()
    const lines: string[] = []
    const errors: string[] = []
    expect(
      await runPlaybookCli(['status'], {
        port,
        writeStdout: (text) => {
          lines.push(text)
        },
        printError: (line) => {
          errors.push(line)
        },
      }),
    ).toBe(0)
    expect(lines.join('\n')).toContain('Playbook Settings')
    expect(
      await runPlaybookCli(['frobnicate'], {
        port,
        writeStdout: (text) => {
          lines.push(text)
        },
        printError: (line) => {
          errors.push(line)
        },
      }),
    ).toBe(2)
    expect(errors.join('\n')).toContain('playbook')
  })

  it('a loaded playbook whose write fails says the command failed, never unavailable', async () => {
    const { workspaceFolder, agentDataFolder } = scratchFolders('m116w-writefail-')
    const port = createPlaybookSurface({
      agentDataFolder,
      workspaceFolder,
      teamId: 'panel',
      laneId: 'surface',
    })
    // A reachable command: the public parser accepts it.
    const command = parsePlaybookCommand(['settings', 'offload', 'off', 'Owner turns it off.'])
    if (command === undefined) throw new Error('the reachable playbook command did not parse')
    // The journal file becomes a directory (the portable form of the drilled
    // read-only write case): the loaded playbook's write genuinely fails on
    // every platform, with no invented payload.
    const journalFile = new FilePlaybookJournal(agentDataFolder, workspaceFolder).file
    const established = await runPlaybookCommand(command, port)
    expect(established.ok).toBe(true)
    rmSync(journalFile, { force: true })
    mkdirSync(journalFile, { recursive: true })
    const failed = await runPlaybookCommand(command, port)
    expect(failed.ok).toBe(false)
    expect(failed.text).toBe(UI_TEXT.playbookCommandFailed)
    expect(failed.text).not.toBe(UI_TEXT.playbookUnavailable)
  })

  it('a surface that cannot bind stays unavailable at the ACP layer', async () => {
    const { workspaceFolder, agentDataFolder } = scratchFolders('m116w-corrupt-')
    const deps = { agentDataFolder, workspaceFolder, teamId: 'panel', laneId: 'surface' }
    // Establish a real journal with a change, then corrupt it with trailing
    // garbage: the next bind reads the journal and throws, the
    // corrupt-journal drill.
    const port = createPlaybookSurface(deps)
    const established = await runPlaybookCommand(
      { view: 'settings', change: { rule: 'offload', enabled: true } },
      port,
    )
    expect(established.ok).toBe(true)
    appendFileSync(new FilePlaybookJournal(agentDataFolder, workspaceFolder).file, '{\n')
    // Without the surface-construction catch this rejects at the transport
    // level instead of answering unavailable (proven: reverting playbook.ts
    // fails this test with the rejection).
    const answer = await acpPlaybook(
      [{ type: 'text' as const, text: '/playbook status' }],
      () => createPlaybookSurface(deps),
      () => entryBundle(),
    )
    expect(answer).toEqual({ ok: false, text: UI_TEXT.playbookUnavailable })
  })

  it('a missing surface stays unavailable', async () => {
    expect(await runPlaybookCommand({ view: 'status' }, undefined)).toEqual({
      ok: false,
      text: UI_TEXT.playbookUnavailable,
    })
  })

  it('the ACP command carries the loaded playbook answer through', async () => {
    const port = surface()
    const status = await acpPlaybook(
      [{ type: 'text' as const, text: '/playbook status' }],
      () => port,
      entryBundle,
    )
    expect(status?.ok).toBe(true)
    // No surface bound: the loaded playbook answers unavailable, and the ACP
    // layer carries that answer instead of replacing it.
    const noSurface = await acpPlaybook(
      [{ type: 'text' as const, text: '/playbook status' }],
      () => undefined,
      entryBundle,
    )
    expect(noSurface).toEqual({ ok: false, text: UI_TEXT.playbookUnavailable })
  })

  it('a bundle that cannot load stays unavailable', async () => {
    // The real Node loader on a missing file: the bundle genuinely fails to
    // load, so the person reads unavailable.
    const missing = await acpPlaybook(
      [{ type: 'text' as const, text: '/playbook status' }],
      () => undefined,
      () => requireFile('/nonexistent/acpPlaybook.js') as AcpPlaybookBundle,
    )
    expect(missing).toEqual({ ok: false, text: UI_TEXT.playbookUnavailable })
  })

  it('rejects invalid changes without persisting them', async () => {
    const port = surface()
    // Hostile wire value: no typed test can spell a rule outside
    // PLAYBOOK_CONFIGURABLE_RULES, so the cast feeds one in; the surface
    // re-parses every change through the zod schema before persisting.
    await expect(
      port.change({ rule: 'neverAround', enabled: false, reason: 'No.' } as never),
    ).rejects.toThrow()
    const reread = (await port.read()) as {
      settings: { rules: Record<string, { enabled: boolean }> }
    }
    expect(reread.settings.rules['offload']?.enabled).toBe(true)
    expect(reread.settings.rules['neverAround']).toBe(undefined)
  })
})

/** The throw a journal read ends in, or undefined when it resolves. */
function readFailure(journal: FilePlaybookJournal): unknown {
  try {
    journal.read()
  } catch (error) {
    return error
  }
  return undefined
}

describe('FilePlaybookJournal read failures', () => {
  it('reads a missing journal as empty, and as lost once its marker stands', () => {
    const { workspaceFolder, agentDataFolder } = scratchFolders('m116j-missing-')
    const journal = new FilePlaybookJournal(agentDataFolder, workspaceFolder)
    expect(journal.read()).toEqual([])
    // A healthy read establishes the marker; the journal vanishing after
    // that is history lost, and the missing-file failure stays as its cause.
    mkdirSync(path.dirname(journal.file), { recursive: true })
    writeFileSync(journal.file, '{}\n')
    expect(journal.read()).toEqual([{}])
    rmSync(journal.file)
    const failure = readFailure(journal)
    expect(failure).toBeInstanceOf(PlaybookHistoryLostError)
    expect(failure).toMatchObject({ message: UI_TEXT.playbookUnavailable })
    expect((failure as Error).cause).toMatchObject({ code: 'ENOENT' })
  })

  it('keeps an unreadable journal failure as the cause of the lost history', () => {
    const { workspaceFolder, agentDataFolder } = scratchFolders('m116j-unreadable-')
    const journal = new FilePlaybookJournal(agentDataFolder, workspaceFolder)
    // The journal path becomes a directory (the portable unreadable case):
    // the listing succeeds but is not a file, so the read genuinely fails
    // on every platform with no invented payload.
    mkdirSync(journal.file, { recursive: true })
    const failure = readFailure(journal)
    expect(failure).toBeInstanceOf(PlaybookHistoryLostError)
    expect(failure).toMatchObject({ message: UI_TEXT.playbookUnavailable })
    expect((failure as Error).cause).toBeInstanceOf(Error)
  })

  it('answers a malformed journal line as unavailable, never its text', () => {
    const { workspaceFolder, agentDataFolder } = scratchFolders('m116j-malformed-')
    const journal = new FilePlaybookJournal(agentDataFolder, workspaceFolder)
    mkdirSync(path.dirname(journal.file), { recursive: true })
    writeFileSync(journal.file, '{\n')
    expect(() => journal.read()).toThrow(UI_TEXT.playbookUnavailable)
  })
})
