// The real native OS background entry behind a forwarding recorder,
// shared by the unit routing suite and the integration outcome suite: the
// production entry over real temp home/data directories (the real process
// runner, the production authorization shape), the real consent store on
// the real disk filesystem, and the real coordinator. Callers own the
// folder and its cleanup; everything inside it is built here, once.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  ScheduleBackgroundCoordinator,
  type BackgroundConsentStore,
} from '../../../../src/runtime/schedules/background'
import { posixTrustedPathVerifier } from '../../../../src/runtime/trustedPath'
import type { TrustedPathVerifier } from '../../../../src/runtime/trustedPathPort'
import { NativeScheduleBackground } from '../../../../src/runtime/schedules/nativeBackground'
import {
  backgroundProcessRunner,
  nodeBackgroundFiles,
} from '../../../../src/runtime/schedules/nodeBackgroundIo'
import { createBackgroundConsentStore } from '../../../../src/runtime/schedules/consent'
import { createNodeScheduleFs } from '../../../../src/runtime/schedules/nodeScheduleFs'
import type { ScheduleBackgroundPort } from '../../../../src/shared/scheduleV2'

export type BackgroundConsent = Parameters<ScheduleBackgroundPort['register']>[1]

const CONSENT_NOW_MS = 1_700_000_000_000

/** Forwards every call to the real entry and records it: observation only. */
export class RecordingBackgroundEntry implements ScheduleBackgroundPort {
  removed = 0
  registered: { nextWakeAtMs: number }[] = []
  public constructor(private readonly inner: ScheduleBackgroundPort) {}
  status() {
    return this.inner.status()
  }
  async register(nextWakeAtMs: number, consent: BackgroundConsent): Promise<void> {
    this.registered.push({ nextWakeAtMs })
    await this.inner.register(nextWakeAtMs, consent)
  }
  async remove(): Promise<void> {
    this.removed += 1
    await this.inner.remove()
  }
}

export interface RealBackgroundHarness {
  readonly background: ScheduleBackgroundCoordinator
  readonly consent: BackgroundConsentStore
  readonly entry: RecordingBackgroundEntry
}

// A real launcher file the product's real POSIX verifier accepts, staged
// with real files the test owns: a user-owned 0700 directory holding a
// user-owned executable file. Registering with it passes the launcher
// trust check on every platform, so the refusal below comes from the
// unbound-governor runner alone — the same refusal on every machine.
export function stageTrustedBackgroundLauncher(folder: string): {
  readonly executable: string
  readonly verifier: TrustedPathVerifier
} {
  const directory = path.join(folder, 'launcher')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const executable = path.join(directory, 'launcher')
  writeFileSync(executable, '#!/bin/sh\nexit 0\n')
  chmodSync(executable, 0o700)
  return { executable, verifier: posixTrustedPathVerifier() }
}

export interface RealBackgroundHarnessLauncher {
  readonly executable: string
  readonly verifier: TrustedPathVerifier
}

export function realBackgroundHarness(
  folder: string,
  nextWake: number | undefined,
  launcher?: RealBackgroundHarnessLauncher,
): RealBackgroundHarness {
  const executable = launcher?.executable ?? process.execPath
  const entry = new RecordingBackgroundEntry(
    new NativeScheduleBackground({
      platform: process.platform,
      homeDir: path.join(folder, 'home'),
      dataDir: path.join(folder, 'data'),
      executable,
      agentFile: executable,
      uid: process.getuid === undefined ? 0 : process.getuid(),
      now: () => Date.now(),
      isWakeProcess: false,
      authorization: () => Promise.resolve({ scheduledPrompts: false }),
      files: nodeBackgroundFiles(launcher?.verifier),
      run: backgroundProcessRunner(process.env),
    }),
  )
  const consent = createBackgroundConsentStore(
    createNodeScheduleFs(path.join(folder, 'store')),
    'runtime/background-consent.json',
  )
  const background = new ScheduleBackgroundCoordinator({
    entry,
    consent,
    now: () => CONSENT_NOW_MS,
    nextWakeAtMs: () => Promise.resolve(nextWake),
  })
  return { background, consent, entry }
}

export async function saveBackgroundConsent(
  consent: BackgroundConsentStore,
  value: BackgroundConsent,
): Promise<void> {
  await consent.exclusive(async (_current, save) => {
    await save(value)
  })
}
