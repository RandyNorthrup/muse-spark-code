import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { requireLocalExecutable } from '../../src/core/judge/local/executable'
import { hostLocalModelPullAction } from '../../src/host/judge/local'
import { pullLocalJudgeModel } from '../../src/core/judge/local/recommendations'

async function fixture() {
  await mkdir(path.resolve('temp'), { recursive: true })
  const root = await mkdtemp(path.resolve('temp/local-judge-exe-'))
  const executable = path.join(root, 'ollama')
  const content = Buffer.from('synthetic runtime fixture, never executed')
  await writeFile(executable, content)
  return { root, executable, executableDigest: createHash('sha256').update(content).digest('hex') }
}
describe('M98 J2 vetted executable and real pull implementation (fake executor)', () => {
  it('verifies exact bytes then invokes only the consented model without credential environment', async () => {
    const f = await fixture()
    const run = vi.fn((_file: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      expect(Object.keys(options.env).toSorted((a, b) => a.localeCompare(b))).toEqual([
        'HOME',
        'OLLAMA_HOST',
        'SystemRoot',
        'USERPROFILE',
      ])
      return Promise.resolve({ stdout: '', stderr: '' })
    })
    const consent = vi.fn(() => Promise.resolve(true))
    const action = hostLocalModelPullAction({
      isExplicitUserAction: () => true,
      nativeScope: () => 'native',
      installation: () => f,
      consent,
      run,
    })
    try {
      await expect(
        pullLocalJudgeModel('tev1:4b', action, new AbortController().signal),
      ).resolves.toBe('pulled')
      expect(run).toHaveBeenCalledTimes(1)
      expect(run.mock.calls[0]).toMatchObject([
        f.executable,
        ['pull', 'tev1:4b'],
        { windowsHide: true, env: { OLLAMA_HOST: '127.0.0.1:11434' } },
      ])
      expect(consent).toHaveBeenCalledExactlyOnceWith('tev1:4b', 4_482_415_847)
    } finally {
      await rm(f.root, { recursive: true, force: true })
    }
  })
  it.each(['digest', 'cancelled', 'remote', 'missing'])(
    'does not start a pull after %s refusal',
    async (fault) => {
      const f = await fixture()
      const controller = new AbortController()
      const run = vi.fn(() => Promise.resolve({ stdout: '', stderr: '' }))
      const action = hostLocalModelPullAction({
        isExplicitUserAction: () => true,
        nativeScope: () => (fault === 'remote' ? 'remote' : 'native'),
        installation: () =>
          fault === 'missing'
            ? undefined
            : { ...f, executableDigest: fault === 'digest' ? 'invalid' : f.executableDigest },
        consent: () => Promise.resolve(true),
        run,
      })
      if (fault === 'cancelled') controller.abort()
      try {
        await expect(pullLocalJudgeModel('tev1:4b', action, controller.signal)).rejects.toThrow()
        expect(run).not.toHaveBeenCalled()
      } finally {
        await rm(f.root, { recursive: true, force: true })
      }
    },
  )
  it('refuses an executable reached through a redirected directory', async () => {
    const f = await fixture()
    const moved = `${f.root}-real`
    try {
      await rename(f.root, moved)
      await symlink(moved, f.root, 'junction')
      await expect(
        requireLocalExecutable(f.executable, f.executableDigest, new AbortController().signal),
      ).rejects.toThrow('unverified-runtime-path')
    } finally {
      await rm(f.root, { recursive: true, force: true })
      await rm(moved, { recursive: true, force: true })
    }
  })
})
