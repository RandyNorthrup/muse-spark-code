import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { vaultClientPlatform } from '../../../src/runtime/vault/clientPlatform'
import type { VaultClientPlatform } from '../../../src/runtime/vault/clientPlatform'
import { VaultBrokerProcess } from '../../../src/host/vault/brokerProcess'
import { windowsVaultPipeNameSchema } from '../../../src/core/vault/broker/windowsPipe'
import { configureResources } from '../../../src/core/resources/admission'
import { runtimeWindowsJob } from '../../../src/runtime/resources/jobs'
import { expectEnded, isRunning } from '../helpers/processes'
import { removeFolder } from '../helpers/temporaryFolders'

// Windows end to end on Windows CI: the real client platform builds both
// helpers, launches the real installed broker entry (bundled below exactly
// as the packages lay it out), dials its pipe and reads a real status.
// Nothing is invented: the pipe name, the trust and the status all come
// from the helper and the broker. Skipped elsewhere with this reason.
// The host ids are 32 hex characters, minted the way the panel mints them
// (randomBytes(16).toString('hex')): the registrar parses them as such,
// and shorter names throw before connect.
const fixture = {
  root: '',
  platform: undefined as VaultClientPlatform | undefined,
  disposeAdmission: undefined as (() => void) | undefined,
  brokerPid: undefined as number | undefined,
  hostId: randomBytes(16).toString('hex'),
  hostSession: randomBytes(16).toString('hex'),
}
describe.skipIf(process.platform !== 'win32')('Windows vault broker end to end', () => {
  beforeAll(async () => {
    fixture.root = await mkdtemp(path.join(tmpdir(), 'vs-wbroker-'))
    const dist = path.join(fixture.root, 'dist')
    // The client reads the slot and pipe sources beside dist exactly as the
    // package lays them out, and the broker reads the job helpers' sources
    // there, so the fixture stages those real sources.
    const sources = path.join(fixture.root, 'native', 'windows')
    await mkdir(sources, { recursive: true })
    for (const name of [
      'MuseSparkJob.cs',
      'MuseSparkMcpJob.cs',
      'MuseSparkMcpLauncher.cs',
      'MuseSparkVault.cs',
      'MuseSparkVaultCng.cs',
      'MuseSparkVaultHello.cs',
      'MuseSparkVaultLock.cs',
      'MuseSparkVaultPipe.cs',
    ])
      await copyFile(path.resolve('native/windows', name), path.join(sources, name))
    const entries: [string, string][] = [
      ['src/runtime/vault/vaultBrokerEntry.ts', 'vaultBroker.js'],
      ['src/core/resources/resourceGovernorEntry.ts', 'resourceGovernor.js'],
      ['src/runtime/vault/vaultRuntimeEntry.ts', 'vaultRuntime.js'],
      ['src/runtime/vault/brokerBindings.ts', 'vaultBrokerBindings.js'],
    ]
    // The installed layout, file for file: the entry requires its
    // vaultRuntime.js and resourceGovernor.js siblings from its own folder.
    await Promise.all(
      entries.map(([entry, outfile]) =>
        build({
          entryPoints: [entry],
          outfile: path.join(dist, outfile),
          bundle: true,
          external: ['@napi-rs/keyring'],
          platform: 'node',
          format: 'cjs',
        }),
      ),
    )
    // The client side admits its helper builds and launches through the
    // real resource governor, configured as the extension host configures
    // it at activation: Windows records each governed child through the job
    // helpers, built from the staged sources.
    fixture.disposeAdmission = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      windowsJob: runtimeWindowsJob(path.join(fixture.root, 'jobs'), fixture.root),
    })
    // Helper builds (the person's own C# compiler) happen here, inside the
    // hook budget; the test below stays a fast launch plus round trip.
    fixture.platform = await vaultClientPlatform({
      dataDir: path.join(fixture.root, 'data'),
      distDir: dist,
      hostId: fixture.hostId,
      hostSession: fixture.hostSession,
    })
  })
  afterAll(async () => {
    fixture.disposeAdmission?.()
    // The launched broker would idle out on its own, but Windows cannot
    // remove a running program's files: the broker this test started (and
    // the job launcher holding it) end before the fixture's folder goes.
    if (fixture.brokerPid !== undefined && isRunning(fixture.brokerPid)) {
      process.kill(fixture.brokerPid)
      await expectEnded(fixture.brokerPid)
    }
    if (!fixture.root) return
    await removeFolder(fixture.root)
  })

  it('builds, launches, dials and reads status through the real broker', async () => {
    const platform = fixture.platform
    if (!platform) throw new Error('the client platform did not build')
    const broker = new VaultBrokerProcess(platform.discovery, platform.process)
    const client = await broker.connect(
      fixture.hostId,
      fixture.hostSession,
      platform.peers,
      platform.dial,
    )
    try {
      const location = await broker.get()
      fixture.brokerPid = location.lock.processId
      // The claim publishes a pipe name, never a socket path.
      expect(windowsVaultPipeNameSchema.safeParse(location.lock.socket).success).toBe(true)
      const first = await client.send({ kind: 'status' })
      if (first.kind !== 'status') throw new Error('broker answered outside the channel')
      // The broker alone answers `locked` with no store open: `uncreated`
      // is the management view's answer (its snapshot over the data
      // folder), and this request never reaches it.
      expect(first.status.state).toBe('locked')
      expect(first.status.reason).toBe('locked')
      // The idle interval must not lock under a live broker: every lock
      // bumps the epoch, so a stable epoch across more than one
      // one-second tick proves the unlock survives while the broker runs.
      const epoch = first.status.lockEpoch
      await delay(1200)
      const second = await client.send({ kind: 'status' })
      if (second.kind !== 'status') throw new Error('broker answered outside the channel')
      expect(second.status.state).toBe('locked')
      expect(second.status.lockEpoch).toBe(epoch)
    } finally {
      client.close()
      platform.dispose?.()
    }
  })
})
