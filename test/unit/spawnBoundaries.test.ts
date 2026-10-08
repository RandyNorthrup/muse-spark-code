import * as childProcess from 'node:child_process'
import { Socket } from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as admission from '../../src/core/resources/admission'
import { locateMediaConverter } from '../../src/core/media/convert'
import { macVaultTransport } from '../../src/runtime/vault/slots/macVaultTransport'
import { windowsVaultTransport } from '../../src/runtime/vault/slots/windowsVaultTransport'
import { UnixVaultPeerVerifier } from '../../src/core/vault/broker/peer'
import { localGitRefs } from '../../src/core/schedules/events/git'
import { reportGitIo } from '../../src/runtime/reporting/sources'
import { backgroundProcessRunner } from '../../src/runtime/schedules/nodeBackgroundIo'

vi.mock('node:child_process', { spy: true })
vi.mock('../../src/core/resources/admission', { spy: true })
afterEach(() => vi.restoreAllMocks())

describe('SPAWN017 new spawn sites wait for resource admission', () => {
  const sites: readonly [string, () => Promise<unknown>][] = [
    [
      'media version probe',
      () =>
        locateMediaConverter({
          platform: process.platform,
          configuredConverters: [{ kind: 'ffmpeg', command: process.execPath }],
          trustedPath: { verify: () => Promise.resolve('ok') },
        }),
    ],
    [
      'macOS vault slot helper',
      () => macVaultTransport(process.execPath).exchange(Buffer.alloc(0), Buffer.alloc(0)),
    ],
    [
      'Windows vault slot guard',
      () =>
        windowsVaultTransport({
          file: path.resolve('fixture.exe'),
          sha256: 'a'.repeat(64),
          powershell: path.resolve('powershell.exe'),
          guardSource: 'fixture',
          rebuild: () => Promise.resolve(),
          report: vi.fn(),
        }).exchange(Buffer.from('{"v":1,"operation":"probe"}'), Buffer.alloc(0)),
    ],
    [
      'Unix vault peer helper',
      () =>
        new UnixVaultPeerVerifier(process.execPath, () => Promise.reject(new Error('No peer')), {
          descriptor: () => 1,
        }).verify(new Socket()),
    ],
    ['scheduled Git refs', () => localGitRefs(process.cwd(), () => true).read()],
    [
      'report Git reader',
      () =>
        reportGitIo(process.cwd(), process.platform, process.env).run(
          ['status', '--porcelain'],
          new AbortController().signal,
        ),
    ],
    [
      'native schedule command',
      () => backgroundProcessRunner(process.env)(process.execPath, ['--version']),
    ],
  ]
  it.each(sites)('refuses %s before any process starts', async (_name, run) => {
    const gate = vi
      .spyOn(admission, 'admitResource')
      .mockRejectedValue(new Error('Fixture admission denied'))
    const spawn = vi.spyOn(childProcess, 'spawn').mockImplementation(() => {
      throw new Error('Unexpected raw spawn')
    })
    const exec = vi.spyOn(childProcess, 'execFile').mockImplementation(() => {
      throw new Error('Unexpected raw exec')
    })
    try {
      await run()
    } catch {
      /* Expected refusal; only admission may be reached. */
    }
    expect(gate).toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
  })
})
