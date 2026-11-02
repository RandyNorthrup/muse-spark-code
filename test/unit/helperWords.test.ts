// A shipped native helper that is missing, or that the system will not run,
// is said where each caller starts it, not read as a desktop with no portal,
// a group that is not private, or an engine failure (RLF-SMALLFIX2). Real
// folders, real files and real processes; the macOS helper is never started
// here (its dictation mode asks for the speech permission).
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLinuxRecorderPort } from '../../src/host/media/linuxRecorderPort'
import { prepareLocalJudgeHelper } from '../../src/runtime/judge/localHelper'
import { verifyTrustedExecutable } from '../../src/runtime/trustedPath'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { isNativeHelperError, type NativeHelperError } from '../../src/shared/nativeHelperError'

/** The test root, made once; real, so the judge peer's own realpath check sees the path it was given. */
const shared = { root: '' }
beforeAll(async () => {
  shared.root = await realpath(await mkdtemp(path.join(tmpdir(), 'helper-words-')))
})
afterAll(async () => {
  await rm(shared.root, { recursive: true, force: true })
})

/** A new folder under the test root. */
async function folder(name: string): Promise<string> {
  const made = path.join(shared.root, name)
  await mkdir(made, { recursive: true })
  return made
}

/** The rejection of `promise`, which must be a native helper's. */
async function helperFailure(promise: Promise<unknown>): Promise<NativeHelperError> {
  let failure: unknown
  try {
    await promise
  } catch (error: unknown) {
    failure = error
  }
  if (!isNativeHelperError(failure))
    throw new Error('expected a native helper error', { cause: failure })
  return failure
}

describe('the Linux portal recorder without its helper', () => {
  const MEBIBYTE = 1024 * 1024
  const portFor = (extensionPath: string) =>
    createLinuxRecorderPort({
      extensionPath,
      tempRoot: path.join(shared.root, 'recordings'),
      arch: 'x64',
      environment: { DISPLAY: ':0' },
      remoteName: undefined,
      signal: new AbortController().signal,
      l10n: { table: UI_TEXT, locale: 'en' },
      maxBytes: () => MEBIBYTE,
    })

  it('says the helper is missing, and to reinstall, not that there is no portal', async () => {
    // The second layout names the helper file even when a folder above the
    // product ends in `.app` (an install path, a test root).
    for (const name of ['portal-missing', path.join('Outer.app', 'portal-nested')]) {
      const product = await folder(name)
      const failure = await helperFailure(portFor(product).hasPortal())
      expect(failure.fault).toBe('missing')
      expect(failure.message).toBe(
        fill(UI_TEXT.nativeHelper.missingInstalled, { helper: 'muse-portal-record' }),
      )
    }
  })

  it('names the build command in a source checkout', async () => {
    const checkout = await folder('portal-checkout')
    await mkdir(path.join(checkout, 'scripts'), { recursive: true })
    await writeFile(path.join(checkout, 'scripts', 'build.mjs'), '')
    const failure = await helperFailure(portFor(checkout).hasPortal())
    expect(failure.message).toBe(
      fill(UI_TEXT.nativeHelper.missingSource, {
        helper: 'muse-portal-record',
        command: 'npm run build:dev',
      }),
    )
  })

  it.skipIf(process.platform === 'win32')(
    'says a helper the system will not run cannot be run',
    async () => {
      const product = await folder('portal-unrunnable')
      const helper = path.join(product, 'native', 'linux', 'x64', 'muse-portal-record')
      await mkdir(path.dirname(helper), { recursive: true })
      await writeFile(helper, 'not a program', { mode: 0o644 })
      // The reason is the trusted-path walk's own: a file nobody may execute.
      expect(await verifyTrustedExecutable(helper)).toMatchObject({ reason: 'not executable' })
      const failure = await helperFailure(portFor(product).hasPortal())
      expect(failure.fault).toBe('unloadable')
      expect(failure.message).toContain('muse-portal-record')
    },
  )

  it('opens no portal without its helper, saying so', async () => {
    const product = await folder('portal-open')
    const failure = await helperFailure(
      portFor(product).openPortal(
        { maxSeconds: 0, microphone: false, systemAudio: false },
        new AbortController().signal,
      ),
    )
    expect(failure.fault).toBe('missing')
  })
})

/** A folder with this mode holding an executable the trusted-path walk should admit. */
async function withProgram(name: string, mode: number): Promise<string> {
  const made = await folder(name)
  await chmod(made, mode)
  const program = path.join(made, 'tool')
  await copyFile('/usr/bin/true', program)
  await chmod(program, 0o755)
  return program
}

describe.skipIf(process.platform !== 'darwin')(
  'the trusted-path private-group check on a Mac',
  () => {
    it('walks a folder only the person can write without asking the helper', async () => {
      const program = await withProgram('private-0750', 0o750)
      const emptyProduct = await folder('private-0750-product')
      expect(await verifyTrustedExecutable(program, emptyProduct)).toMatchObject({ ok: true })
    })

    it('says the helper is missing when the walk needs it and it is not shipped', async () => {
      const program = await withProgram('private-0770', 0o770)
      const emptyProduct = await folder('private-0770-product')
      const verdict = await verifyTrustedExecutable(program, emptyProduct)
      expect(verdict).toMatchObject({ refused: true })
      const reason = 'reason' in verdict ? verdict.reason : ''
      expect(reason).toContain('muse-dictate-screen')
      expect(reason).toContain('Reinstall Muse Spark Code')
      expect(reason).not.toContain('group/other writable ancestor')
    })

    it('says the helper cannot be run when it is there without the right to run it', async () => {
      const program = await withProgram('private-0770-unrunnable', 0o770)
      const product = await folder('private-0770-unrunnable-product')
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
      const helper = path.join(
        product,
        'native',
        'darwin',
        `muse-dictate-screen-${arch}.app`,
        'Contents',
        'MacOS',
        'muse-dictate',
      )
      await mkdir(path.dirname(helper), { recursive: true })
      await writeFile(helper, 'not a program', { mode: 0o644 })
      const verdict = await verifyTrustedExecutable(program, product)
      expect(verdict).toMatchObject({ refused: true })
      expect('reason' in verdict ? verdict.reason : '').toContain('cannot run it')
    })
  },
)

const judgeStorage = (): string => path.join(shared.root, 'judge-storage')

describe('the macOS local judge peer', () => {
  it('says the peer is missing and to reinstall, in an installed product', async () => {
    const product = await folder('judge-product')
    const failure = await helperFailure(
      prepareLocalJudgeHelper({ packageRoot: product, storageRoot: judgeStorage() }, 'darwin'),
    )
    expect(failure.fault).toBe('missing')
    expect(failure.message).toBe(
      fill(UI_TEXT.nativeHelper.missingInstalled, { helper: 'muse-local-judge-peer' }),
    )
  })

  it('names its own build script in a source checkout', async () => {
    const checkout = await folder('judge-checkout')
    await mkdir(path.join(checkout, 'native', 'darwin'), { recursive: true })
    await writeFile(path.join(checkout, 'native', 'darwin', 'build-local-judge.sh'), '')
    const failure = await helperFailure(
      prepareLocalJudgeHelper({ packageRoot: checkout, storageRoot: judgeStorage() }, 'darwin'),
    )
    expect(failure.message).toBe(
      fill(UI_TEXT.nativeHelper.missingSource, {
        helper: 'muse-local-judge-peer',
        command: 'bash native/darwin/build-local-judge.sh',
      }),
    )
  })

  it.skipIf(process.platform !== 'darwin')(
    'says a peer this Mac will not trust (an unsigned file) cannot be run',
    async () => {
      const product = await folder('judge-unsigned')
      const peer = path.join(product, 'native', 'darwin', 'muse-local-judge-peer')
      await mkdir(path.dirname(peer), { recursive: true })
      await writeFile(peer, 'not a signed program')
      const failure = await helperFailure(
        prepareLocalJudgeHelper({ packageRoot: product, storageRoot: judgeStorage() }, 'darwin'),
      )
      expect(failure.fault).toBe('unloadable')
    },
  )

  it('leaves another platform’s missing source as the plain failure it is', async () => {
    const product = await folder('judge-linux')
    await expect(
      prepareLocalJudgeHelper({ packageRoot: product, storageRoot: judgeStorage() }, 'linux'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
