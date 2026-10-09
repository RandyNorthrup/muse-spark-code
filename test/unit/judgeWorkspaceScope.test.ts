// RVM98P2R2 6: the separate judge's scope check reads repository-controlled
// workspace settings files within bounds: regular files only (a directory, a
// FIFO or a link to one is refused without blocking), a per-file and an
// aggregate byte limit and a file-count limit. A skipped file is counted,
// never read in full or parsed.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isSeparateInWorkspace, readWorkspaceSettings } from '../../src/host/judge/workspaceScope'
import {
  WORKSPACE_SETTINGS_MAX_BYTES,
  WORKSPACE_SETTINGS_MAX_FILES,
  WORKSPACE_SETTINGS_TOTAL_BYTES,
} from '../../src/shared/constants'

const root = mkdtempSync(path.join(tmpdir(), 'muse-scope-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const SELECTING = '{ "museSpark.judge.engine": "separate" }'

function file(content: string | Buffer): string {
  const target = path.join(root, `settings-${randomUUID()}.json`)
  writeFileSync(target, content)
  return target
}

/** A settings text of exactly `bytes` bytes that selects C. */
function sized(bytes: number): string {
  const head = '{ "museSpark.judge.engine": "separate", "pad": "'
  const tail = '" }'
  return `${head}${'x'.repeat(bytes - head.length - tail.length)}${tail}`
}

describe('bounded workspace settings reads (RVM98P2R2 6)', () => {
  it('reads a regular file within the limit and an absent file reads as nothing', () => {
    const read = readWorkspaceSettings([file(SELECTING), path.join(root, 'absent.json')])
    expect(read).toEqual({ texts: [SELECTING], skipped: 0 })
    expect(isSeparateInWorkspace(read.texts)).toBe(true)
  })

  it('skips a file over the per-file limit without reading it in full', () => {
    const exact = file(sized(WORKSPACE_SETTINGS_MAX_BYTES))
    const over = file(sized(WORKSPACE_SETTINGS_MAX_BYTES + 1))
    const read = readWorkspaceSettings([over, exact])
    expect(read.skipped).toBe(1)
    expect(read.texts).toHaveLength(1)
    expect(read.texts[0]).toHaveLength(WORKSPACE_SETTINGS_MAX_BYTES)
  })

  it('skips a directory where a settings file is expected', () => {
    const folder = path.join(root, 'folder.json')
    mkdirSync(folder)
    expect(readWorkspaceSettings([folder])).toEqual({ texts: [], skipped: 1 })
  })

  it('stops at the aggregate limit across files', () => {
    const count = Math.ceil(WORKSPACE_SETTINGS_TOTAL_BYTES / WORKSPACE_SETTINGS_MAX_BYTES) + 1
    const files = Array.from({ length: count }, () => file(sized(WORKSPACE_SETTINGS_MAX_BYTES)))
    const read = readWorkspaceSettings(files)
    const total = read.texts.reduce((sum, text) => sum + text.length, 0)
    expect(total).toBeLessThanOrEqual(WORKSPACE_SETTINGS_TOTAL_BYTES)
    expect(read.skipped).toBe(count - read.texts.length)
    expect(read.skipped).toBeGreaterThan(0)
  })

  it('reads at most the file-count limit', () => {
    const files = Array.from({ length: WORKSPACE_SETTINGS_MAX_FILES + 2 }, () => file('{}'))
    const read = readWorkspaceSettings(files)
    expect(read.texts).toHaveLength(WORKSPACE_SETTINGS_MAX_FILES)
    expect(read.skipped).toBe(2)
  })

  it.runIf(process.platform !== 'win32')(
    'refuses a FIFO, and a settings link to one, without waiting for a writer',
    () => {
      const fifo = path.join(root, 'pipe')
      execFileSync('mkfifo', [fifo])
      const link = path.join(root, 'linked-settings.json')
      symlinkSync(fifo, link)
      const started = Date.now()
      expect(readWorkspaceSettings([fifo, link])).toEqual({ texts: [], skipped: 2 })
      // Returned at once: no read blocked on the pipe.
      expect(Date.now() - started).toBeLessThan(1000)
    },
  )
})
