// M105 lane V, seam 3: the converter is discovered only at a configured
// path or a documented install, verified through the shared TrustedPathVerifier
// port before every probe and encode, and launched at the verified canonical
// path. POSIX runs REDM104L3's StrictModes walk (its additive executable-file
// mode); Windows runs the owner/ACL verifier on the canonical target.
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import * as fileIdentity from '../../src/core/fs/fileIdentity'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as processTree from '../../src/host/processTree'
import {
  convertToWav16kMono,
  locateMediaConverter,
  type MediaConverter,
} from '../../src/core/media/convert'
import { converterTrustedPath } from '../../src/runtime/converterTrust'
import { verifyTrustedExecutable } from '../../src/runtime/trustedPath'
import { fill } from '../../src/shared/l10n/text'
import { UI_TEXT } from '../../src/shared/constants'

vi.mock('../../src/host/processTree', async (original) => ({
  ...(await original<typeof processTree>()),
}))
vi.mock('../../src/core/fs/fileIdentity', async (original) => ({
  ...(await original<typeof fileIdentity>()),
}))

const BANNER = 'ffmpeg version 8.0.1-3ubuntu2 Copyright (c) 2000-2025 the FFmpeg developers\n'
const isPosix = process.platform !== 'win32'
const folder = { root: '' }

beforeAll(async () => {
  folder.root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-converter-trust-')))
  if (isPosix) await chmod(folder.root, 0o700)
})
afterAll(async () => {
  if (isPosix) await chmod(folder.root, 0o700)
  await rm(folder.root, { recursive: true, force: true })
})

/** A fresh private directory with one file in it, at the given modes. */
async function tool(name: string, fileMode = 0o755, directoryMode = 0o700): Promise<string> {
  const directory = path.join(folder.root, name)
  await mkdir(directory)
  const file = path.join(directory, isPosix ? 'ffmpeg' : 'ffmpeg.exe')
  await writeFile(file, '#!/bin/sh\n')
  if (isPosix) {
    await chmod(file, fileMode)
    await chmod(directory, directoryMode)
  }
  return file
}

describe.runIf(isPosix)('the POSIX executable verifier (REDM104L3 walk, file mode)', () => {
  it('accepts a private executable and returns its canonical path', async () => {
    const file = await tool('accepted')
    expect(await verifyTrustedExecutable(file)).toEqual({ ok: true, path: file })
  })

  it('resolves a symlink first and returns its canonical target, never the link', async () => {
    const file = await tool('target')
    const link = path.join(folder.root, 'link-ffmpeg')
    await symlink(file, link)
    expect(await verifyTrustedExecutable(link)).toEqual({ ok: true, path: file })
  })

  it('refuses a symlink whose target sits under an other-writable ancestor', async () => {
    const file = await tool('shared', 0o755, 0o777)
    const link = path.join(folder.root, 'link-shared')
    await symlink(file, link)
    expect(await verifyTrustedExecutable(link)).toMatchObject({
      refused: true,
      component: path.dirname(file),
    })
  })

  it('refuses a group-writable ancestor when the group is not the user-private group', async () => {
    const file = await tool('group', 0o755, 0o770)
    // No membership lookup can prove the group private: the walk refuses.
    const lookup = vi
      .spyOn(processTree, 'runProgram')
      .mockRejectedValue(new Error('membership unavailable'))
    try {
      expect(await verifyTrustedExecutable(file)).toMatchObject({
        refused: true,
        component: path.dirname(file),
      })
    } finally {
      lookup.mockRestore()
    }
  })

  it.each([
    [0o775, 'group/other writable file'],
    [0o757, 'group/other writable file'],
    [0o644, 'not executable'],
  ])('refuses a target at mode %o (%s)', async (mode, reason) => {
    const file = await tool(`mode-${mode.toString(8)}`, mode)
    expect(await verifyTrustedExecutable(file)).toEqual({ refused: true, component: file, reason })
  })

  it('refuses a non-regular target', async () => {
    const directory = path.join(folder.root, 'not-a-file')
    await mkdir(directory, { mode: 0o700 })
    await chmod(directory, 0o700)
    expect(await verifyTrustedExecutable(directory)).toMatchObject({ refused: true })
  })

  it('refuses a foreign owner', async () => {
    const file = await tool('foreign')
    const original = fileIdentity.handleIdentity
    const owner = vi.spyOn(fileIdentity, 'handleIdentity').mockImplementation(async (handle) => {
      const info = await original(handle)
      if (info.isFile()) info.uid = BigInt((process.getuid?.() ?? 0) + 1)
      return info
    })
    try {
      expect(await verifyTrustedExecutable(file)).toEqual({
        refused: true,
        component: file,
        reason: 'foreign owner',
      })
    } finally {
      owner.mockRestore()
    }
  })

  it('refuses a target replaced between its open and its pathname check', async () => {
    const file = await tool('replaced')
    const original = fileIdentity.lstatIdentity
    const swap = vi.spyOn(fileIdentity, 'lstatIdentity').mockImplementation(async (name) => {
      const info = await original(name)
      if (name === file) info.ino += 1n
      return info
    })
    try {
      expect(await verifyTrustedExecutable(file)).toEqual({
        refused: true,
        component: file,
        reason: 'pathname replaced',
      })
    } finally {
      swap.mockRestore()
    }
  })

  it('serves as the converter port on POSIX', async () => {
    const file = await tool('port')
    expect(await converterTrustedPath().verify(file, { leafKind: 'file' })).toEqual({
      ok: true,
      path: file,
    })
  })
})

describe.runIf(process.platform === 'win32')('the Windows converter verifier', () => {
  it('judges a path through a junction by its canonical target', async () => {
    const file = await tool('junction-target')
    const junction = path.join(folder.root, 'relocated')
    await symlink(path.dirname(file), junction, 'junction')
    const verdict = await converterTrustedPath().verify(path.join(junction, path.basename(file)), {
      leafKind: 'file',
    })
    // Whatever this host's temp ACLs decide, the junction never reaches the
    // verifier: it judges the canonical target and its real ancestors.
    if ('ok' in verdict) expect(verdict.path).toBe(file)
    else {
      expect(verdict.component).not.toContain('relocated')
      expect(file.toLowerCase().startsWith(verdict.component.toLowerCase())).toBe(true)
    }
  })

  it('refuses when PowerShell cannot be located from SystemRoot', async () => {
    const file = await tool('no-system-root')
    const verdict = await converterTrustedPath('win32', {}).verify(file, { leafKind: 'file' })
    expect(verdict).toMatchObject({ refused: true })
  })
})

/** One second of 8 kHz stereo PCM: a real WAV the sniffer reads. */
function pcmWav(): Buffer {
  const data = 8000 * 2 * 2
  const wav = Buffer.alloc(44 + data)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + data, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(2, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(8000 * 4, 28)
  wav.writeUInt16LE(4, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(data, 40)
  return wav
}

/** A verifier that admits every path as the canonical one `canonical` names. */
function verified(canonical: (file: string) => string) {
  return {
    verify: vi.fn((file: string) => Promise.resolve({ ok: true as const, path: canonical(file) })),
  }
}

/** A fresh WAV input for one conversion. */
async function wavInput(): Promise<string> {
  const file = path.join(folder.root, `in-${String(Math.random()).slice(2)}.wav`)
  await writeFile(file, pcmWav())
  return file
}

/** A kernel-limited launch whose memory cap stopped the encoder. */
function rejectAtMemoryCap(): Promise<void> {
  return Promise.reject(Object.assign(new Error('job memory limit'), { code: 'EMEDIA_MEMORY_CAP' }))
}

describe('converter discovery through the port', () => {
  it('probes and returns the verified canonical path, not the name it was given', async () => {
    const trustedPath = verified(() => '/opt/homebrew/Cellar/ffmpeg/8.0.1/bin/ffmpeg')
    const probeVersion = vi.fn(() => Promise.resolve(BANNER))
    // avconvert's probe sees an ffmpeg banner and refuses; Homebrew's link wins.
    expect(await locateMediaConverter({ platform: 'darwin', trustedPath, probeVersion })).toEqual({
      ok: true,
      converter: { kind: 'ffmpeg', command: '/opt/homebrew/Cellar/ffmpeg/8.0.1/bin/ffmpeg' },
    })
    expect(probeVersion).toHaveBeenLastCalledWith(
      '/opt/homebrew/Cellar/ffmpeg/8.0.1/bin/ffmpeg',
      ['-version'],
      expect.anything(),
    )
    const ffmpeg = verified((file) => (file === '/usr/bin/avconvert' ? file : `${file}.real`))
    const probe = vi.fn((command: string) =>
      Promise.resolve(command.endsWith('.real') ? BANNER : 'usage'),
    )
    expect(
      await locateMediaConverter({ platform: 'darwin', trustedPath: ffmpeg, probeVersion: probe }),
    ).toEqual({ ok: true, converter: { kind: 'ffmpeg', command: '/opt/homebrew/bin/ffmpeg.real' } })
    expect(probe).toHaveBeenCalledWith(
      '/opt/homebrew/bin/ffmpeg.real',
      ['-version'],
      expect.anything(),
    )
  })

  it.each([
    String.raw`C:\ProgramData\chocolatey\bin\ffmpeg.exe`,
    String.raw`D:\Users\me\scoop\shims\ffmpeg.exe`,
    '/snap/bin/ffmpeg',
  ])('refuses the launcher shim %s before probing', async (shim) => {
    const probeVersion = vi.fn(() => Promise.resolve(BANNER))
    const result = await locateMediaConverter({
      platform: 'linux',
      configuredConverters: [{ kind: 'ffmpeg', command: '/usr/local/bin/ffmpeg' }],
      trustedPath: verified(() => shim),
      probeVersion,
    })
    expect(result).toMatchObject({ ok: false })
    expect(probeVersion).not.toHaveBeenCalled()
  })

  it('resolves Windows locations from the environment on any drive, winget included', async () => {
    const trustedPath = verified((file) => file)
    const probeVersion = vi.fn(() => Promise.reject(new Error('absent')))
    await locateMediaConverter({
      platform: 'win32',
      env: { ProgramFiles: String.raw`Q:\Programs`, LOCALAPPDATA: String.raw`R:\Profile\Local` },
      trustedPath,
      probeVersion,
    })
    expect(trustedPath.verify.mock.calls.map(([file]) => file)).toEqual([
      String.raw`Q:\Programs\ffmpeg\bin\ffmpeg.exe`,
      String.raw`R:\Profile\Local\Microsoft\WinGet\Links\ffmpeg.exe`,
    ])
    // No environment, no guessed C: fallback.
    trustedPath.verify.mockClear()
    expect(
      await locateMediaConverter({ platform: 'win32', env: {}, trustedPath, probeVersion }),
    ).toEqual({ ok: false, reason: UI_TEXT.media.converterUnavailable })
    expect(trustedPath.verify).not.toHaveBeenCalled()
  })

  it('names the fix when a documented converter sits under a shared-writable folder', async () => {
    const reason = '/usr/local/bin: /usr/local/bin: group/other writable ancestor'
    const trustedPath = {
      verify: (file: string) =>
        Promise.resolve(
          file === '/usr/local/bin/ffmpeg'
            ? { refused: true as const, component: '/usr/local/bin', reason }
            : { refused: true as const, component: file, reason: 'ENOENT' },
        ),
    }
    expect(
      await locateMediaConverter({ platform: 'darwin', trustedPath, probeVersion: vi.fn() }),
    ).toEqual({
      ok: false,
      reason: fill(UI_TEXT.media.converterSharedFolder, { reason: `/usr/local/bin: ${reason}` }),
    })
  })

  it('takes a configured path alone: a refusal says why and never falls back', async () => {
    const trustedPath = {
      verify: vi.fn((file: string) =>
        Promise.resolve({ refused: true as const, component: file, reason: 'foreign owner' }),
      ),
    }
    const configured: MediaConverter = { kind: 'ffmpeg', command: '/home/me/bin/ffmpeg' }
    const result = await locateMediaConverter({
      platform: 'linux',
      configuredConverters: [configured],
      trustedPath,
      probeVersion: () => Promise.resolve(BANNER),
    })
    expect(result).toEqual({
      ok: false,
      reason: fill(UI_TEXT.media.converterConfiguredRefused, {
        reason: '/home/me/bin/ffmpeg: foreign owner',
      }),
    })
    expect(trustedPath.verify).toHaveBeenCalledExactlyOnceWith('/home/me/bin/ffmpeg', {
      leafKind: 'file',
    })
  })

  it('refuses to encode when the recheck before encoding resolves elsewhere', async () => {
    const input = path.join(folder.root, 'clip.wav')
    await writeFile(input, pcmWav())
    const verify = vi
      .fn()
      .mockImplementationOnce((file: string) => Promise.resolve({ ok: true, path: file }))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, path: '/elsewhere/ffmpeg' }))
    const run = vi.fn(() => Promise.resolve())
    const converter: MediaConverter = { kind: 'ffmpeg', command: process.execPath }
    const result = await convertToWav16kMono(input, converter, {
      trustedPath: { verify },
      probeVersion: () => Promise.resolve(BANNER),
      readRssBytes: () => Promise.resolve(0),
      createPrivateDirectory: () => mkdtemp(path.join(folder.root, 'private-')),
      run,
    })
    expect(result).toMatchObject({ ok: false })
    // Verified for the probe, then again before encoding: the second differs.
    expect(verify).toHaveBeenCalledTimes(2)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('converter memory watch: a bounded sampler or a kernel cap', () => {
  const converter: MediaConverter = { kind: 'ffmpeg', command: process.execPath }
  const base = {
    trustedPath: { verify: (file: string) => Promise.resolve({ ok: true as const, path: file }) },
    probeVersion: () => Promise.resolve(BANNER),
    createPrivateDirectory: () => mkdtemp(path.join(folder.root, 'private-')),
  }

  it('encodes through the kernel-limited launch, with the cap and no sampler', async () => {
    const memoryLimitedRun = vi.fn(
      async (_command: string, _args: readonly string[], options: { outputPath: string }) => {
        await writeFile(options.outputPath, pcmWav())
      },
    )
    const result = await convertToWav16kMono(await wavInput(), converter, {
      ...base,
      memoryLimitedRun,
    })
    expect(result).toMatchObject({ ok: true })
    if (result.ok) await result.dispose()
    expect(memoryLimitedRun).toHaveBeenCalledOnce()
    const limits = memoryLimitedRun.mock.calls[0]?.[2]
    expect(limits).toMatchObject({ maxRssBytes: 512 * 1024 * 1024 })
    expect(limits).not.toHaveProperty('readRssBytes')
  })

  it('says "memory cap" when the kernel cap stopped the encoder', async () => {
    expect(
      await convertToWav16kMono(await wavInput(), converter, {
        ...base,
        memoryLimitedRun: rejectAtMemoryCap,
      }),
    ).toEqual({
      ok: false,
      reason: fill(UI_TEXT.media.conversionFailed, { reason: 'memory cap' }),
    })
    // Any other failure stays the plain conversion failure, never a guess.
    expect(
      await convertToWav16kMono(await wavInput(), converter, {
        ...base,
        memoryLimitedRun: () => Promise.reject(new Error('exit 1')),
      }),
    ).toEqual({ ok: false, reason: fill(UI_TEXT.media.conversionFailed, { reason: 'ffmpeg' }) })
  })

  it.runIf(process.platform !== 'linux')(
    'refuses off Linux with neither a sampler nor a kernel cap',
    async () => {
      const run = vi.fn(() => Promise.resolve())
      expect(
        await convertToWav16kMono(await wavInput(), converter, { ...base, run }),
      ).toMatchObject({
        ok: false,
      })
      expect(run).not.toHaveBeenCalled()
    },
  )
})
