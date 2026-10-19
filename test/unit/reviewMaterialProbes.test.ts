// The review material's git probes (D119): any git failure is a negative
// answer, never a throw — driven by the real git binary.
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  commitMaterial,
  uncommittedMaterial,
  type ReviewGit,
} from '../../src/core/review/reviewMaterial'
import { fixtureGitEnvironment } from './helpers/fixtureGit'

const runGit = promisify(execFile)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string): ReviewGit {
  return async (args: readonly string[]) => {
    const { stdout } = await runGit('git', [...args], {
      cwd,
      env: fixtureGitEnvironment(process.env),
    })
    return stdout
  }
}

async function freshRepo(): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-review-probes-'))
  roots.push(root)
  await runGit('git', ['init'], { cwd: root, env: fixtureGitEnvironment(process.env) })
  return root
}

describe('review material git probes', () => {
  it('refuses outside a repository', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'muse-review-probes-'))
    roots.push(root)
    writeFileSync(path.join(root, 'note.txt'), 'hello')
    expect(await uncommittedMaterial(git(root))).toEqual({
      ok: false,
      refusal: 'notRepository',
    })
  })

  it('reports no changes in a clean repository', async () => {
    const root = await freshRepo()
    expect(await uncommittedMaterial(git(root))).toEqual({
      ok: false,
      refusal: 'noChanges',
    })
  })

  it('reports an unknown revision instead of throwing', async () => {
    const root = await freshRepo()
    expect(await commitMaterial(git(root), '0000000000000000000000000000000000000000')).toEqual({
      ok: false,
      refusal: 'unknownRevision',
    })
  })
})
