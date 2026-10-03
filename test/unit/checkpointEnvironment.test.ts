import { execFileSync } from 'node:child_process'
import { chmod, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeEnvironment } from '../../src/host/backend/environment'
import { withCheckpointEdit } from '../../src/host/checkpoints/checkpointHost'
import { processGitRunner } from '../../src/host/git'
import { posixQuoted } from '../../src/core/shellQuote'
import {
  GIT_FILTER_NAME_MAX_CHARS,
  GIT_FILTER_NAMES_MAX,
  UI_TEXT,
} from '../../src/shared/constants'
import {
  changedFileTurn,
  checkpointPort,
  type Harness,
  harness,
  isPresent,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreOutcome,
  holdRestoreRef,
  runGit,
  write,
} from './helpers/checkpointHarness'
import { fakeMuseCodeManager } from './helpers/museCodeManager'

afterEach(removeCheckpointFolders)
const realGit = processGitRunner()

function factsOver(h: Harness, signal = new AbortController().signal, trusted = () => true) {
  const manager = fakeMuseCodeManager({ workspaceRoot: h.root, isWorkspaceTrusted: trusted })
  const port = checkpointPort(h)
  const check = manager.workspaceActionGuard(signal, h.root)
  const process = vi.fn(
    async (args: readonly string[], cwd: string) => await realGit(args, cwd, undefined, check),
  )
  const facts = () =>
    describeEnvironment({
      workspaceRoot: h.root,
      runGit: async (args, cwd) =>
        await withCheckpointEdit(port, h.log, check, async () => await process(args, cwd)),
      isWorkspaceTrusted: trusted,
      now: () => Date.now(),
      log: h.log,
    })
  return { facts, manager, port, process, check }
}

async function committedWorkspace() {
  const h = await harness()
  await write(h.root, 'a.txt', 'old\n')
  runGit(h.root, ['add', 'a.txt'])
  runGit(h.root, ['commit', '-q', '-m', 'owned fixture'])
  return h
}

type Program = 'clean' | 'process' | 'fsmonitor' | 'signature'

function programWord(file: string): string {
  return posixQuoted(file.replaceAll('\\', '/'))
}

function programBehavior(kind: Program): string {
  if (kind === 'clean') {
    return 'process.stdin.pipe(process.stdout)'
  }
  return kind === 'fsmonitor'
    ? String.raw`process.stdout.write(process.argv[3] === '2' ? 'facts-token\0/\0' : '/\0')`
    : 'process.exitCode = 1'
}

function configuredProgramKey(kind: Program): string {
  if (kind === 'fsmonitor') {
    return 'core.fsmonitor'
  }
  return kind === 'signature' ? 'gpg.program' : `filter.factsProbe.${kind}`
}

async function helperProgram(h: Harness, kind: Program) {
  const folder = path.dirname(h.top)
  const script = path.join(folder, `${kind}.cjs`)
  const marker = path.join(folder, `${kind}-marker`)
  const behavior = programBehavior(kind)
  await writeFile(script, `require('node:fs').writeFileSync(process.argv[2], 'ran')\n${behavior}\n`)
  const command = [process.execPath, script, marker].map((file) => programWord(file)).join(' ')
  if (kind !== 'signature') {
    return { marker, command }
  }
  const launcher = path.join(folder, 'signature-helper')
  await writeFile(launcher, `#!/bin/sh\nexec ${command} "$@"\n`)
  await chmod(launcher, 0o755)
  return { marker, command: launcher }
}

async function configureProgram(
  h: Harness,
  kind: Program,
  command: string,
  driver = 'factsProbe',
): Promise<void> {
  if (kind === 'clean' || kind === 'process') {
    await write(h.root, '.gitattributes', `a.txt filter=${driver}\n`)
    runGit(h.root, ['add', '.gitattributes'])
    runGit(h.root, ['commit', '-q', '-m', 'attributes'])
    runGit(h.root, ['config', `filter.${driver}.${kind}`, command])
    runGit(h.root, ['config', `filter.${driver}.required`, 'true'])
    // Same size makes status compare content through the configured filter,
    // rather than declaring the file changed from its size alone.
    await write(h.root, 'a.txt', 'new\n')
    const changedAt = new Date(Date.now() + 1000)
    await utimes(path.join(h.root, 'a.txt'), changedAt, changedAt)
    return
  }
  if (kind === 'fsmonitor') {
    runGit(h.root, ['config', 'core.fsmonitor', command])
    runGit(h.root, ['update-index', '--fsmonitor'])
    return
  }
  const tree = runGit(h.root, ['rev-parse', 'HEAD^{tree}']).trim()
  const parent = runGit(h.root, ['rev-parse', 'HEAD']).trim()
  // Test-owned signed object asks Git to verify a deliberately invalid signature.
  const object = `tree ${tree}\nparent ${parent}\nauthor fixture <fixture@example.invalid> 1 +0000\ncommitter fixture <fixture@example.invalid> 1 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n fixture\n -----END PGP SIGNATURE-----\n\nsigned fixture\n`
  const oid = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
    cwd: h.root,
    input: object,
    encoding: 'utf8',
  }).trim()
  runGit(h.root, ['update-ref', 'HEAD', oid])
  runGit(h.root, ['config', 'gpg.program', command])
  runGit(h.root, ['config', 'log.showSignature', 'true'])
}

describe('automatic prompt Git helper exclusion (M72)', () => {
  it(
    'refuses an actual equal-name driver before metadata can invoke its ordinary clean helper',
    async () => {
      const h = await committedWorkspace()
      const helper = await helperProgram(h, 'clean')
      await configureProgram(h, 'clean', helper.command, 'equal=driver')
      await rm(helper.marker, { force: true })
      runGit(h.root, ['status', '--porcelain'])
      expect(await readFile(helper.marker, 'utf8')).toBe('ran')
      await rm(helper.marker)
      const fixture = factsOver(h)
      expect(await fixture.facts()).toEqual({ git: undefined })
      expect(fixture.process).toHaveBeenCalledOnce()
      expect(fixture.process.mock.calls[0]?.[0]).toContain('--name-only')
      expect(await isPresent(path.dirname(h.top), path.basename(helper.marker))).toBe(false)
      expect(h.log.info).toHaveBeenCalledWith('No git facts for the prompt: Error')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each<Program>(['clean', 'process', 'fsmonitor', 'signature'])(
    'suppresses a real %s helper which ordinary metadata invokes, and preserves its config',
    async (kind) => {
      const h = await committedWorkspace()
      const helper = await helperProgram(h, kind)
      await configureProgram(h, kind, helper.command)
      // Seeding fsmonitor can invoke it too; only the subsequent metadata call counts here.
      await rm(helper.marker, { force: true })
      try {
        runGit(
          h.root,
          kind === 'signature' ? ['log', '--oneline', '-1'] : ['status', '--porcelain'],
        )
        if (kind === 'fsmonitor') {
          runGit(h.root, ['status', '--porcelain'])
        }
      } catch {
        // Deliberately invalid process/signature helpers may make ordinary Git fail.
      }
      expect(await readFile(helper.marker, 'utf8')).toBe('ran')
      await rm(helper.marker)
      const fixture = factsOver(h)
      const result = await fixture.facts()
      expect(result.git?.branch).toBe('main')
      expect(await isPresent(path.dirname(h.top), path.basename(helper.marker))).toBe(false)
      expect(h.store.isNativeUnsafe).toBe(false)
      const key = configuredProgramKey(kind)
      expect(runGit(h.root, ['config', '--get', key]).trim()).toBe(helper.command)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps plain file restore available after admitted helper-free prompt metadata',
    async () => {
      const h = await committedWorkspace()
      await changedFileTurn(h)
      const facts = await factsOver(h).facts()
      expect(facts.git?.changedFiles).toBeGreaterThan(0)
      expect(h.store.isNativeUnsafe).toBe(false)
      const restored = await restoreOutcome(h.reopen(), 't1')
      expect(restored.ok).toBe(true)
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'starts no metadata process under a real restore reservation',
    async () => {
      const h = await committedWorkspace()
      await holdRestoreRef(h)
      const fixture = factsOver(h)
      expect(await fixture.facts()).toEqual({ git: undefined })
      expect(fixture.process).not.toHaveBeenCalled()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses an unrelated metadata cwd at the actual process entry',
    async () => {
      const h = await committedWorkspace()
      const other = await committedWorkspace()
      const manager = fakeMuseCodeManager({ workspaceRoot: h.root })
      const check = manager.workspaceActionGuard(new AbortController().signal, other.root)
      await expect(
        realGit(['rev-parse', '--show-toplevel'], other.root, undefined, check),
      ).rejects.toThrow(UI_TEXT.checkpointFailed)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'starts no subsequent metadata process when its captured owner is disposed after discovery',
    async () => {
      const h = await committedWorkspace()
      const fixture = factsOver(h)
      fixture.process.mockImplementationOnce(async (args, cwd) => {
        const result = await realGit(args, cwd, undefined, fixture.check)
        await fixture.manager.dispose()
        return result
      })
      expect(await fixture.facts()).toEqual({ git: undefined })
      expect(fixture.process).toHaveBeenCalledOnce()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['trust revoked', 'window closed', 'manager disposed'])(
    'starts no metadata process after %s while admission waits',
    async (reason) => {
      const h = await committedWorkspace()
      let isTrusted = true
      const lifetime = new AbortController()
      const fixture = factsOver(h, lifetime.signal, () => isTrusted)
      const entered = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      const mark = fixture.port.markTurn.bind(fixture.port)
      vi.spyOn(fixture.port, 'markTurn').mockImplementation(async (key, running) => {
        if (running) {
          entered.resolve(undefined)
          await resume.promise
        }
        await mark(key, running)
      })
      const reading = fixture.facts()
      try {
        await entered.promise
        if (reason === 'trust revoked') {
          isTrusted = false
        } else if (reason === 'window closed') {
          lifetime.abort()
        } else {
          await fixture.manager.dispose()
        }
      } finally {
        resume.resolve(undefined)
      }
      expect(await reading).toEqual({ git: undefined })
      expect(fixture.process).not.toHaveBeenCalled()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each([
    'filter.bad=name.clean\u{0}',
    `filter.${'x'.repeat(GIT_FILTER_NAME_MAX_CHARS)}.clean\u{0}`,
    Array.from(
      { length: GIT_FILTER_NAMES_MAX + 1 },
      (_, index) => `filter.p${String(index)}.clean\u{0}`,
    ).join(''),
    Object.assign(new Error('unreadable /arbitrary/profile/path'), { code: 'EACCES' }),
  ])(
    'refuses malformed/excessive/unreadable names without status or raw error logs',
    async (names) => {
      const h = await harness()
      const run = vi.fn(() =>
        names instanceof Error ? Promise.reject(names) : Promise.resolve(names),
      )
      expect(
        await describeEnvironment({
          workspaceRoot: h.root,
          runGit: run,
          isWorkspaceTrusted: () => true,
          log: h.log,
          now: () => 0,
        }),
      ).toEqual({ git: undefined })
      expect(run).toHaveBeenCalledOnce()
      expect(h.log.info).toHaveBeenCalledWith('No git facts for the prompt: Error')
    },
  )
})
