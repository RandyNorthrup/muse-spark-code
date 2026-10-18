import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileImportIo } from '../../src/host/importIo'

/** A scratch repository with one file: the probes run against real git. */
function scratchRepo(): { root: string; file: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'import-probe-'))
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: root, stdio: 'ignore' })
  const file = path.join(root, 'MUSE.md')
  writeFileSync(file, '# rules\n')
  return { root, file }
}

describe('import git probes (PR #214 review)', () => {
  it('classifies a scratch repository file with no signal', async () => {
    const { root, file } = scratchRepo()
    await expect(fileImportIo.isIgnored(file, root)).resolves.toBe(false)
  })

  it('a closing window ends the probe instead of waiting on git', async () => {
    const { root, file } = scratchRepo()
    const closing = new AbortController()
    closing.abort()
    await expect(fileImportIo.isIgnored(file, root, closing.signal)).rejects.toThrow(
      'was not started',
    )
  })
})
