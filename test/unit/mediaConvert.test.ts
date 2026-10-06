import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import type * as ChildProcess from 'node:child_process'
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import {
  convertToMp4 as convertWithPlatformDefault,
  locateMediaConverter,
  type MediaConverter,
  type MediaConversionOptions,
} from '../../src/core/media/convert'
import { HOOK_FORBIDDEN_ENV_NAMES, SHELL_MAX_TIMEOUT_MS, UI_TEXT } from '../../src/shared/constants'
import { videoFixture } from './helpers/media/fixtures'

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof ChildProcess>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

const fake: MediaConverter = { kind: 'ffmpeg', command: process.execPath }
const fixture = { workspace: '', input: '' }
const directories: string[] = []

beforeAll(async () => {
  fixture.workspace = await mkdtemp(path.join(tmpdir(), 'm105-convert-test-'))
  fixture.input = path.join(fixture.workspace, 'clip ; $(never-run).webm')
  await writeFile(fixture.input, videoFixture())
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
afterAll(async () => {
  await rm(fixture.workspace, { recursive: true, force: true })
})

function outputPath(args: readonly string[]): string {
  const output = args.at(-1)
  if (output === undefined) throw new Error('Missing output')
  directories.push(path.dirname(output))
  return output
}

function alignedSymlinkTarget(): string {
  const padding = videoFixture().length - Buffer.byteLength(fixture.input)
  if (padding < 0) throw new Error('Fixture path exceeds its clip size')
  // Match the symlink's byte size to the clip, so another size guard cannot
  // hide a missing file-type guard in the red drill.
  return `${path.dirname(fixture.input)}/${'./'.repeat(Math.floor(padding / 2))}${padding % 2 === 0 ? '' : '/'}${path.basename(fixture.input)}`
}

const writeConverted: NonNullable<MediaConversionOptions['run']> = (_command, args, _options) =>
  writeFile(outputPath(args), videoFixture())

function convertToMp4(
  input: string,
  converter: MediaConverter,
  options: MediaConversionOptions = {},
) {
  return convertWithPlatformDefault(input, converter, {
    ...(process.platform === 'win32' && {
      createPrivateDirectory: () => mkdtemp(path.join(tmpdir(), 'm105-private-fake-')),
    }),
    ...options,
  })
}

describe('M105 converter discovery', () => {
  it('offers conversion only for an installed converter on an absolute PATH', () => {
    const fileExists = vi.fn(() => true)
    expect(
      locateMediaConverter({ platform: 'linux', pathVariable: ':.:relative', fileExists }),
    ).toEqual({ ok: false, reason: UI_TEXT.media.converterUnavailable })
    expect(fileExists).not.toHaveBeenCalled()
    expect(
      locateMediaConverter({ platform: 'linux', pathVariable: '.:/usr/bin', fileExists }),
    ).toEqual({ ok: true, converter: { kind: 'ffmpeg', command: '/usr/bin/ffmpeg' } })
    expect(
      locateMediaConverter({ platform: 'darwin', pathVariable: '/opt/bin', fileExists }),
    ).toEqual({ ok: true, converter: { kind: 'avconvert', command: '/usr/bin/avconvert' } })
    expect(
      locateMediaConverter({
        platform: 'win32',
        pathVariable: String.raw`.;C:\Tools`,
        fileExists: (file) => file.replaceAll('\\', '/') === 'C:/Tools/ffmpeg.exe',
      }),
    ).toEqual({ ok: true, converter: { kind: 'ffmpeg', command: String.raw`C:\Tools\ffmpeg.exe` } })
    expect(
      locateMediaConverter({ platform: 'linux', pathVariable: '/missing', fileExists: () => false })
        .ok,
    ).toBe(false)
  })
})

describe('M105 private local conversion', () => {
  it('uses an argument array, private directory/file, and verifies mp4 metadata before success', async () => {
    const run: NonNullable<MediaConversionOptions['run']> = async (command, args, options) => {
      expect(command).toBe(process.execPath)
      expect(args[args.indexOf('-i') + 1]).toBe(fixture.input)
      expect(args).toContain('-nostdin')
      expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('file')
      expect(args[args.indexOf('-f') + 1]).toBe('mov')
      expect(args[args.indexOf('-enable_drefs') + 1]).toBe('0')
      expect(args[args.indexOf('-use_absolute_path') + 1]).toBe('0')
      const output = outputPath(args)
      expect(options.cwd).toBe(path.dirname(output))
      expect(options.timeoutMs).toBe(SHELL_MAX_TIMEOUT_MS)
      if (process.platform !== 'win32') {
        const directoryStat = await lstat(options.cwd)
        expect(directoryStat.mode & 0o777).toBe(0o700)
        const outputStat = await lstat(output)
        expect(outputStat.mode & 0o777).toBe(0o600)
      }
      await writeFile(output, videoFixture({ durationSeconds: 134 }))
      await chmod(output, 0o644)
    }
    const result = await convertToMp4(fixture.input, fake, { run })
    expect(result).toMatchObject({
      ok: true,
      info: { mediaType: 'video/mp4', durationSeconds: 134 },
    })
    if (!result.ok) throw new Error('Expected conversion')
    expect(await readFile(result.path)).toEqual(Buffer.from(videoFixture({ durationSeconds: 134 })))
    const resultStat = await lstat(result.path)
    if (process.platform !== 'win32') expect(resultStat.mode & 0o777).toBe(0o600)
    await result.dispose()
    await result.dispose()
    await expect(lstat(result.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses avconvert only through its explicit source/output arguments', async () => {
    const run: NonNullable<MediaConversionOptions['run']> = async (_command, args) => {
      expect(args[args.indexOf('--source') + 1]).toBe(fixture.input)
      const output = args[args.indexOf('--output') + 1]
      if (output === undefined) throw new Error('Missing output')
      directories.push(path.dirname(output))
      await writeFile(output, videoFixture())
    }
    const result = await convertToMp4(
      fixture.input,
      { kind: 'avconvert', command: path.resolve(fixture.workspace, 'avconvert') },
      { run },
    )
    expect(result.ok).toBe(true)
    if (result.ok) await result.dispose()
  })

  it('drops every credential variable, including mixed-case names, without changing the host', async () => {
    const names = ['META_API_KEY', 'another_api_key', ...HOOK_FORBIDDEN_ENV_NAMES]
    for (const name of names) vi.stubEnv(name, 'test-only-env-canary')
    const run: NonNullable<MediaConversionOptions['run']> = async (_command, args, options) => {
      const childNames = Object.keys(options.env).map((name) => name.toUpperCase())
      for (const name of names) expect(childNames).not.toContain(name.toUpperCase())
      await writeConverted(_command, args, options)
    }
    const result = await convertToMp4(fixture.input, fake, { run })
    expect(result.ok).toBe(true)
    for (const name of names) expect(process.env[name] === 'test-only-env-canary').toBe(true)
    if (result.ok) await result.dispose()
  })

  it('removes output after failure and never surfaces stderr, private paths or arguments', async () => {
    const result = await convertToMp4(fixture.input, fake, {
      run: (_command, args) => {
        outputPath(args)
        return Promise.reject(new Error('PRIVATE PATH /account/person; private stderr'))
      },
    })
    expect(result).toEqual({ ok: false, reason: 'Conversion failed: ffmpeg' })
    await expect(lstat(directories[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses malformed/wrong-format output and deletes it', async () => {
    for (const bytes of [
      new Uint8Array(),
      Uint8Array.from([1, 2, 3]),
      videoFixture({ brand: 'qt  ' }),
    ]) {
      const result = await convertToMp4(fixture.input, fake, {
        run: (_command, args) => writeFile(outputPath(args), bytes),
      })
      expect(result.ok).toBe(false)
      await expect(lstat(directories.at(-1)!)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('refuses audio-only MP4 output from a conversion advertised as video', async () => {
    const audio = Buffer.from(videoFixture())
    audio.write('free', audio.indexOf('trak'))
    const result = await convertToMp4(fixture.input, fake, {
      run: (_command, args) => writeFile(outputPath(args), audio),
      limits: { acceptedMediaTypes: ['video/mp4'] },
    })
    expect(result.ok).toBe(false)
    await expect(lstat(directories.at(-1)!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enforces output size/duration limits and removes refused conversions', async () => {
    for (const limits of [{ maxUploadBytes: 1 }, { maxDurationSeconds: 9 }]) {
      expect(
        await convertToMp4(fixture.input, fake, { run: writeConverted, limits }),
      ).toMatchObject({ ok: false, reason: expect.stringContaining('exceeds') })
      await expect(lstat(directories.at(-1)!)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('refuses relative commands/inputs, directories and invalid timeouts before launch', async () => {
    const run = vi.fn(writeConverted)
    for (const timeoutMs of [0, -1, 1.5, NaN, SHELL_MAX_TIMEOUT_MS + 1])
      expect(await convertToMp4(fixture.input, fake, { timeoutMs, run })).toMatchObject({
        ok: false,
      })
    expect(
      await convertToMp4(fixture.input, { kind: 'ffmpeg', command: 'ffmpeg' }, { run }),
    ).toMatchObject({ ok: false })
    expect(await convertToMp4('relative.webm', fake, { run })).toMatchObject({ ok: false })
    expect(
      await convertToMp4(path.relative(process.cwd(), fixture.input), fake, { run }),
    ).toMatchObject({ ok: false })
    expect(await convertToMp4(fixture.workspace, fake, { run })).toMatchObject({ ok: false })
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses unrecognized input before launching a decoder or creating output', async () => {
    const playlist = path.join(fixture.workspace, 'playlist.webm')
    await writeFile(playlist, '#EXTM3U\nfile:///private/should-not-read\n')
    const run = vi.fn((_command: string, args: readonly string[]) => {
      const output = args[args.indexOf('--output') + 1]
      if (output === undefined) throw new Error('Missing output')
      directories.push(path.dirname(output))
      return writeFile(output, videoFixture())
    })
    expect(
      await convertToMp4(playlist, { kind: 'avconvert', command: process.execPath }, { run }),
    ).toMatchObject({ ok: false })
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses a symbolic-link source before launching a converter', async () => {
    const linked = path.join(fixture.workspace, 'linked.webm')
    await symlink(
      process.platform === 'win32' ? fixture.workspace : alignedSymlinkTarget(),
      linked,
      process.platform === 'win32' ? 'junction' : 'file',
    )
    const run = vi.fn(writeConverted)
    expect(await convertToMp4(linked, fake, { run })).toMatchObject({ ok: false })
    expect(run).not.toHaveBeenCalled()
  })

  it('requires the Windows private-directory port and refuses relative factory results safely', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    if (descriptor === undefined) throw new Error('Missing platform descriptor')
    const run = vi.fn(writeConverted)
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      expect(await convertWithPlatformDefault(fixture.input, fake, { run })).toEqual({
        ok: false,
        reason: 'Conversion failed: permissions',
      })
      expect(run).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', descriptor)
    }
    const privateDirectory = await mkdtemp(path.join(fixture.workspace, 'private-factory-'))
    expect(
      await convertToMp4(fixture.input, fake, {
        run,
        createPrivateDirectory: () =>
          Promise.resolve(path.relative(process.cwd(), privateDirectory)),
      }),
    ).toMatchObject({ ok: false })
    expect(await readFile(fixture.input)).toEqual(Buffer.from(videoFixture()))
  })

  it('refuses symbolic-link output and cleans the private directory', async () => {
    // Windows symlink creation needs a privilege; junctions need none and are
    // equally invalid as an output file. POSIX exercises a file symlink.
    const run: NonNullable<MediaConversionOptions['run']> = async (_command, args) => {
      const output = outputPath(args)
      await rm(output)
      await symlink(
        process.platform === 'win32' ? fixture.workspace : alignedSymlinkTarget(),
        output,
        process.platform === 'win32' ? 'junction' : 'file',
      )
    }
    expect(await convertToMp4(fixture.input, fake, { run })).toMatchObject({ ok: false })
    await expect(lstat(directories.at(-1)!)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(fixture.input)).toEqual(Buffer.from(videoFixture()))
  })

  it('returns a stopped refusal before launch and after in-flight cancellation', async () => {
    const controller = new AbortController()
    const run = vi.fn(writeConverted)
    controller.abort()
    expect(
      await convertToMp4(fixture.input, fake, { signal: controller.signal, run }),
    ).toMatchObject({ ok: false })
    expect(run).not.toHaveBeenCalled()
    const during = new AbortController()
    const result = await convertToMp4(fixture.input, fake, {
      signal: during.signal,
      run: async (command, args, options) => {
        await writeConverted(command, args, options)
        during.abort()
      },
    })
    expect(result.ok).toBe(false)
    await expect(lstat(directories.at(-1)!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('waits for process close after timeout/Stop and suppresses process output', async () => {
    const actual = await vi.importActual<typeof ChildProcess>('node:child_process')
    for (const stop of ['timeout', 'abort']) {
      const controller = new AbortController()
      let child: ReturnType<typeof spawn> | undefined
      vi.mocked(spawn).mockImplementation((_command, args, options) => {
        expect(options).toMatchObject({ stdio: 'ignore', windowsHide: true })
        writeFileSync(outputPath(args), videoFixture())
        child = actual.spawn(
          process.execPath,
          ['-e', 'setTimeout(() => process.exit(0), 200)'],
          options,
        )
        if (stop === 'abort')
          queueMicrotask(() => {
            controller.abort()
          })
        return child
      })
      expect(
        await convertToMp4(fixture.input, fake, {
          signal: controller.signal,
          timeoutMs: stop === 'timeout' ? 25 : 1000,
        }),
      ).toMatchObject({ ok: false })
      expect(child?.killed).toBe(true)
    }
  })

  it('honors cancellation during final output admission', async () => {
    const controller = new AbortController()
    const result = await convertToMp4(fixture.input, fake, {
      signal: controller.signal,
      run: writeConverted,
      limits: {
        get maxUploadBytes() {
          controller.abort()
          return 1024
        },
      },
    })
    expect(result.ok).toBe(false)
    await expect(lstat(directories.at(-1)!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cancels during preflight without starting a process', async () => {
    const controller = new AbortController()
    vi.mocked(spawn).mockClear()
    const converting = convertToMp4(fixture.input, fake, { signal: controller.signal })
    queueMicrotask(() => {
      controller.abort()
    })
    expect(await converting).toMatchObject({ ok: false })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('handles an unavailable executable and successful real process completion', async () => {
    vi.mocked(spawn).mockReset()
    const actual = await vi.importActual<typeof ChildProcess>('node:child_process')
    vi.mocked(spawn).mockImplementation(actual.spawn)
    expect(
      await convertToMp4(fixture.input, {
        kind: 'ffmpeg',
        command: path.join(fixture.workspace, 'missing-executable'),
      }),
    ).toMatchObject({ ok: false })
    vi.mocked(spawn).mockImplementation((_command, args, options) => {
      const output = outputPath(args)
      return actual.spawn(
        process.execPath,
        [
          '-e',
          'require("node:fs").copyFileSync(process.argv[1], process.argv[2])',
          fixture.input,
          output,
        ],
        options,
      )
    })
    const result = await convertToMp4(fixture.input, fake)
    expect(result.ok).toBe(true)
    if (result.ok) await result.dispose()
  })
})
