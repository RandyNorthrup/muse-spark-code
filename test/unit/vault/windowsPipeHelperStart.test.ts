import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { windowsPipeExecutable } from '../../../src/host/vault/slots/windowsVaultBuild'
import { configureResources } from '../../../src/core/resources/admission'
import { runtimeWindowsJob } from '../../../src/runtime/resources/jobs'
import { startWindowsPipeFiles } from '../../../src/runtime/vault/windowsPipeRelay'
import type { WindowsVaultExecutable } from '../../../src/runtime/vault/slots/windowsVaultTransport'
import { UI_TEXT } from '../../../src/shared/constants'
import { isVaultFileMissing } from '../../../src/core/vault/broker/files'

// The guarded pipe helper's start through the governor the vault broker
// configures (src/runtime/vault/vaultBrokerEntry.ts): the real helper,
// launched with the job helpers recording it, starts and stops; a helper the
// guard refuses (its digest does not match) ends the start at once with the
// fixed refusal instead of waiting out the start deadline. The helper only
// runs on Windows; nothing stands in for it elsewhere.
const fixture: { root: string; helper?: WindowsVaultExecutable; dispose?: () => void } = {
  root: '',
}
describe.runIf(process.platform === 'win32')('Windows pipe helper start', () => {
  beforeAll(async () => {
    fixture.root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'vs-pipestart-'))
    // Not made here: the build makes its storage folder on first use, and
    // the test below proves the helper lands there, never in the temp tree.
    const storageDir = path.join(fixture.root, 'data', 'vault', 'helpers')
    const systemRoot = process.env['SystemRoot']
    if (systemRoot === undefined || systemRoot === '') throw new Error('SystemRoot is missing')
    const windowsJob = runtimeWindowsJob(path.join(fixture.root, 'jobs'), path.resolve('.'))
    fixture.dispose = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      windowsJob,
    })
    // The job helpers compile on first governed use: prepare them here, in
    // the hook's budget, so each case below is a launch and never a build.
    if ((await windowsJob()) === undefined) throw new Error('the Windows job helpers did not build')
    fixture.helper = await windowsPipeExecutable({
      storageDir,
      systemRoot,
      readSlotSource: () => readFile(path.resolve('native/windows/MuseSparkVault.cs'), 'utf8'),
      readPipeSource: () => readFile(path.resolve('native/windows/MuseSparkVaultPipe.cs'), 'utf8'),
    })
  })
  afterAll(async () => {
    fixture.dispose?.()
    await rm(fixture.root, { recursive: true, force: true })
  })

  it('builds the helper in its own storage folder, made on first use', () => {
    if (fixture.helper === undefined) throw new Error('the pipe helper was not built')
    const storageDir = path.join(fixture.root, 'data', 'vault', 'helpers')
    expect(path.dirname(path.dirname(fixture.helper.file))).toBe(storageDir)
  })

  it('starts the real helper through the governed launch and stops it', async () => {
    if (fixture.helper === undefined) throw new Error('the pipe helper was not built')
    const started = await startWindowsPipeFiles(fixture.helper)
    await started.stop()
  })

  it('answers a missing file as missing, never as a refusal', async () => {
    if (fixture.helper === undefined) throw new Error('the pipe helper was not built')
    const started = await startWindowsPipeFiles(fixture.helper)
    try {
      const absent = path.join(fixture.root, 'no-broker-yet', 'broker.lock')
      let failure: unknown
      try {
        await started.files.verify(absent, 'file')
      } catch (error: unknown) {
        failure = error
      }
      expect(isVaultFileMissing(failure)).toBe(true)
    } finally {
      await started.stop()
    }
  })

  it('checks a file another process holds open for deletion', async () => {
    if (fixture.helper === undefined) throw new Error('the pipe helper was not built')
    // A real holder with delete access, as the owner's own link or delete of
    // a record holds it: the check must not read it as a refusal.
    const record = path.join(fixture.root, 'record.lock')
    await writeFile(record, '{}')
    const holder = spawn(
      path.join(
        process.env['SystemRoot'] ?? '',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$s = New-Object IO.FileStream('${record}', [IO.FileMode]::Open, [Security.AccessControl.FileSystemRights]'Read, Delete', [IO.FileShare]'ReadWrite, Delete', 4096, [IO.FileOptions]::None); [Console]::Out.WriteLine('held'); [void][Console]::In.ReadLine(); $s.Dispose()`,
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
    )
    const started = await startWindowsPipeFiles(fixture.helper)
    try {
      const [line] = (await once(holder.stdout, 'data')) as [Buffer]
      expect(line.toString().trim()).toBe('held')
      await started.files.verify(record, 'file')
    } finally {
      holder.stdin.end()
      await once(holder, 'exit')
      await started.stop()
    }
  })

  it('refuses at once when the guard refuses the helper', async () => {
    if (fixture.helper === undefined) throw new Error('the pipe helper was not built')
    await expect(
      startWindowsPipeFiles({ ...fixture.helper, sha256: '0'.repeat(64) }),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
  })
})
