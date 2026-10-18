import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import {
  FilePlaybookJournal,
  PlaybookHistoryLostError,
} from '../../src/core/orchestration/playbook/journal'
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
    try {
      journal.read()
    } catch (error) {
      expect(error).toBeInstanceOf(PlaybookHistoryLostError)
      expect(error).toMatchObject({ message: UI_TEXT.playbookUnavailable })
      expect((error as Error).cause).toMatchObject({ code: 'ENOENT' })
      return
    }
    throw new Error('a journal lost after its marker stood did not throw')
  })

  it('keeps an unreadable journal failure as the cause of the lost history', () => {
    const { workspaceFolder, agentDataFolder } = scratchFolders('m116j-unreadable-')
    const journal = new FilePlaybookJournal(agentDataFolder, workspaceFolder)
    // The journal path becomes a directory (the portable unreadable case):
    // the listing succeeds but is not a file, so the read genuinely fails
    // on every platform with no invented payload.
    mkdirSync(journal.file, { recursive: true })
    try {
      journal.read()
    } catch (error) {
      expect(error).toBeInstanceOf(PlaybookHistoryLostError)
      expect(error).toMatchObject({ message: UI_TEXT.playbookUnavailable })
      expect((error as Error).cause).toBeInstanceOf(Error)
      return
    }
    throw new Error('an unreadable journal did not throw')
  })

  it('answers a malformed journal line as unavailable, never its text', () => {
    const { workspaceFolder, agentDataFolder } = scratchFolders('m116j-malformed-')
    const journal = new FilePlaybookJournal(agentDataFolder, workspaceFolder)
    mkdirSync(path.dirname(journal.file), { recursive: true })
    writeFileSync(journal.file, '{\n')
    expect(() => journal.read()).toThrow(UI_TEXT.playbookUnavailable)
  })
})
