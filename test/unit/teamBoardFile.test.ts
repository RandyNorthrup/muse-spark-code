// A team's board on a real filesystem, for the ACP agent and a headless run
// (RVACPTEAM's open P3): every write carries the whole board, so a failed one must
// not poison the writes after it.
// The failures are the filesystem's own: a folder where the file goes.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { teamBoardFile } from '../../src/core/team/teamBoardFile'
import { ACP_TEAM_BOARD_FILE } from '../../src/shared/constants'

function scratch(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'acp-board-'))
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true })
  })
  return folder
}

describe('the team board file', () => {
  it('fails one write alone: the next one repairs the file and leaves no temporary', async () => {
    const folder = scratch()
    const target = path.join(folder, ACP_TEAM_BOARD_FILE)
    // The rename cannot replace a folder with a file in it, on any system.
    mkdirSync(path.join(target, 'in-the-way'), { recursive: true })
    const board = teamBoardFile(() => target)
    await expect(board.write('first')).rejects.toThrow()
    await expect(board.settled()).rejects.toThrow()
    expect(existsSync(`${target}.new`)).toBe(false)
    rmSync(target, { recursive: true })
    await board.write('second')
    await board.settled()
    expect(readFileSync(target, 'utf8')).toBe('second')
  })

  it('lets a write queued behind a failing one reach the file', async () => {
    const folder = scratch()
    const target = path.join(folder, ACP_TEAM_BOARD_FILE)
    mkdirSync(`${target}.new`, { recursive: true })
    const board = teamBoardFile(() => target)
    const first = board.write('first')
    const second = board.write('second')
    await expect(first).rejects.toThrow()
    // The first's failure removed what stood in its way, so the second goes through.
    await second
    expect(readFileSync(target, 'utf8')).toBe('second')
    expect(existsSync(`${target}.new`)).toBe(false)
  })

  it('replaces a temporary a crash left behind, and writes in order', async () => {
    const folder = scratch()
    const target = path.join(folder, ACP_TEAM_BOARD_FILE)
    writeFileSync(`${target}.new`, 'left by a crash')
    const board = teamBoardFile(() => target)
    await Promise.all([board.write('one'), board.write('two'), board.write('three')])
    expect(readFileSync(target, 'utf8')).toBe('three')
    expect(existsSync(`${target}.new`)).toBe(false)
  })
})
