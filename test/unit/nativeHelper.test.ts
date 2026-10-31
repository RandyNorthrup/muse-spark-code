// A shipped native helper that is not there, or that this computer will not
// start, says what is missing and what to do (RLF-SMALLFIX1). Real files and
// real child processes only: the helper is a real executable (Node itself where
// a helper that runs is needed), a real missing path, a real file without the
// execute bit, and on a Mac a real binary built for the other processor.
import { execFile } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { startFailureText } from '../../src/acp/startText'
import { createdPathCommands } from '../../src/core/resources/resourceGovernorEntry'
import {
  createdHelperFile,
  isNativeHelperSentence,
  runNativeHelper,
} from '../../src/core/nativeHelper'
import { UI_TEXT, darwinDictationApp } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { isNativeHelperError, NativeHelperError } from '../../src/shared/nativeHelperError'

const run = promisify(execFile)
const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

/** A product folder of its own, with or without the platform's build script a source checkout holds. */
async function product(buildScript?: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'native-helper-'))
  folders.push(root)
  await mkdir(path.join(root, 'native', 'darwin'), { recursive: true })
  if (buildScript !== undefined) {
    await mkdir(path.dirname(path.join(root, buildScript)), { recursive: true })
    await writeFile(path.join(root, buildScript), '')
  }
  return root
}

async function failure(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt
  } catch (error: unknown) {
    return error
  }
  throw new Error('the start did not fail')
}

const APP = 'muse-dictate-screen-x64.app'
const BUILT = (root: string) =>
  path.join(root, 'native', 'darwin', APP, 'Contents', 'MacOS', 'muse-dictate')

describe('a native helper that is missing', () => {
  it.each([
    ['darwin', undefined, UI_TEXT.nativeHelper.missingInstalled, ''],
    [
      'darwin',
      'native/darwin/build.sh',
      UI_TEXT.nativeHelper.missingSource,
      'bash native/darwin/build.sh',
    ],
    ['linux', 'scripts/build.mjs', UI_TEXT.nativeHelper.missingSource, 'npm run build:dev'],
  ] as const)(
    'on %s, with the build script %s, says it and what to do',
    async (platform, buildScript, template, command) => {
      const root = await product(buildScript)
      const helper = BUILT(root)
      const error = await failure(runNativeHelper(helper, () => Promise.resolve('never'), platform))
      expect(isNativeHelperError(error)).toBe(true)
      expect(error).toBeInstanceOf(NativeHelperError)
      expect(error).toMatchObject({
        fault: 'missing',
        message: fill(template, { helper: APP, command }),
      })
    },
  )

  it.each(['darwin', 'linux'] as const)(
    'is said by the %s created-path commands, never as a bare spawn error',
    async (platform) => {
      const root = await product()
      const commands = createdPathCommands(path.join(root, 'native'), undefined, platform)
      const error = await failure(commands(['probe']))
      expect(error).toMatchObject({
        name: 'NativeHelperError',
        fault: 'missing',
        message: fill(UI_TEXT.nativeHelper.missingInstalled, {
          helper: platform === 'darwin' ? darwinDictationApp(process.arch) : 'muse-created',
        }),
      })
      expect(startFailureText(new Error('start failed', { cause: error }), 'session')).toBe(
        error instanceof Error ? error.message : '',
      )
    },
  )

  it('is said for the Windows job helper and for a platform that ships none', async () => {
    const windows = await failure(createdPathCommands('unused', undefined, 'win32')(['probe']))
    expect(windows).toMatchObject({ fault: 'missing', message: UI_TEXT.nativeHelper.windowsJob })
    const other = await failure(createdPathCommands('unused', undefined, 'freebsd')(['probe']))
    expect(other).toMatchObject({
      fault: 'missing',
      message: fill(UI_TEXT.nativeHelper.unsupported, { platform: 'freebsd', arch: process.arch }),
    })
  })
})

describe.skipIf(process.platform === 'win32')('a native helper that is there', () => {
  it('runs and answers, untouched', async () => {
    const output = await runNativeHelper(process.execPath, async () => {
      const { stdout } = await run(process.execPath, ['-e', 'process.stdout.write("answered")'])
      return stdout
    })
    expect(output).toBe('answered')
  })

  it('keeps its own refusal: a helper that ran and exited non-zero is not a missing helper', async () => {
    const error = await failure(
      runNativeHelper(process.execPath, () => run(process.execPath, ['-e', 'process.exit(3)'])),
    )
    expect(isNativeHelperError(error)).toBe(false)
    expect(error).toMatchObject({ code: 3 })
  })

  it.each([
    [undefined, UI_TEXT.nativeHelper.unloadableInstalled, ''],
    [
      'native/darwin/build.sh',
      UI_TEXT.nativeHelper.unloadableSource,
      'bash native/darwin/build.sh',
    ],
  ] as const)(
    'that the system will not run (no execute bit, build script %s) says so and what to do',
    async (buildScript, template, command) => {
      const root = await product(buildScript)
      const helper = BUILT(root)
      await mkdir(path.dirname(helper), { recursive: true })
      await writeFile(helper, '#!/bin/sh\nexit 0\n')
      await chmod(helper, 0o600)
      const error = await failure(
        runNativeHelper(helper, () => run(helper, ['--created-directory']), 'darwin'),
      )
      expect(error).toMatchObject({
        fault: 'unloadable',
        message: fill(template, { helper: APP, command }),
      })
    },
  )

  const other = process.arch === 'arm64' ? 'x64' : 'arm64'
  const otherBuild = path.join(
    process.cwd(),
    'native',
    'darwin',
    darwinDictationApp(other),
    'Contents',
    'MacOS',
    'muse-dictate',
  )
  it.skipIf(process.platform !== 'darwin' || !existsSync(otherBuild))(
    process.platform === 'darwin' && !existsSync(otherBuild)
      ? 'that is built for the other processor says so (SKIPPED: native/darwin/build.sh has not been run here)'
      : 'that is built for the other processor says so',
    async () => {
      const root = await product()
      const helper = path.join(
        root,
        'native',
        'darwin',
        darwinDictationApp(process.arch),
        'Contents',
        'MacOS',
        'muse-dictate',
      )
      await mkdir(path.dirname(helper), { recursive: true })
      await cp(otherBuild, helper)
      const error = await failure(
        runNativeHelper(helper, () => run(helper, ['--created-directory'])),
      )
      expect(error).toMatchObject({ fault: 'unloadable' })
      expect(error instanceof Error ? error.message : '').toContain(
        darwinDictationApp(process.arch),
      )
    },
  )
})

// The product's own native folder holds the helper its build makes (macOS: the
// signed app, built by native/darwin/build.sh; Linux: muse-created, built by the
// build). The created-path commands must find it where the build puts it.
const builtHelper = createdHelperFile(
  path.join(process.cwd(), 'native'),
  process.platform,
  process.arch,
)
const isBuilt = builtHelper !== undefined && existsSync(builtHelper)
describe('the helper the product ships', () => {
  it.skipIf(!isBuilt)(
    isBuilt
      ? 'is found where the build puts it and answers with its own refusal'
      : 'is found where the build puts it (SKIPPED: the native helper is not built here)',
    async () => {
      const error = await failure(
        createdPathCommands(path.join(process.cwd(), 'native'), undefined)(['not-an-operation']),
      )
      // It started and refused: no sentence about a missing or unrunnable helper.
      expect(isNativeHelperError(error)).toBe(false)
    },
  )
})

describe('the sentences that may leave the agent', () => {
  const filled = [
    fill(UI_TEXT.nativeHelper.missingInstalled, { helper: APP }),
    fill(UI_TEXT.nativeHelper.missingSource, {
      helper: APP,
      command: 'bash native/darwin/build.sh',
    }),
    fill(UI_TEXT.nativeHelper.unloadableInstalled, { helper: 'muse-created' }),
    fill(UI_TEXT.nativeHelper.unloadableSource, {
      helper: 'muse-created',
      command: 'npm run build:dev',
    }),
    fill(UI_TEXT.nativeHelper.unsupported, { platform: 'freebsd', arch: 'x64' }),
    UI_TEXT.nativeHelper.windowsJob,
  ]
  it.each(filled)('lets %s through', (sentence) => {
    expect(isNativeHelperSentence(sentence)).toBe(true)
  })

  it('refuses a slot that carries anything but a name, and any text around a sentence', () => {
    const planted = 'sk-'.padEnd(80, 'a')
    const sentence = fill(UI_TEXT.nativeHelper.missingInstalled, { helper: APP })
    for (const text of [
      fill(UI_TEXT.nativeHelper.missingInstalled, { helper: planted }),
      fill(UI_TEXT.nativeHelper.missingInstalled, { helper: 'a\nb' }),
      fill(UI_TEXT.nativeHelper.missingInstalled, { helper: String.raw`C:\Users\someone\x` }),
      fill(UI_TEXT.nativeHelper.missingInstalled, { helper: '' }),
      `${sentence} Also: ${planted}`,
      `Also: ${sentence}`,
      UI_TEXT.actionFailed,
    ])
      expect(isNativeHelperSentence(text)).toBe(false)
  })
})
