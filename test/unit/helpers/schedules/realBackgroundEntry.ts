// The real native OS background entry behind a forwarding recorder,
// shared by the unit routing suite and the integration outcome suite: the
// production entry over real temp home/data directories (the real process
// runner, the production authorization shape), the real consent store on
// the real disk filesystem, and the real coordinator. Callers own the
// folder and its cleanup; everything inside it is built here, once.
import path from 'node:path'
import {
  ScheduleBackgroundCoordinator,
  type BackgroundConsentStore,
} from '../../../../src/runtime/schedules/background'
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

export function realBackgroundHarness(
  folder: string,
  nextWake: number | undefined,
): RealBackgroundHarness {
  const entry = new RecordingBackgroundEntry(
    new NativeScheduleBackground({
      platform: process.platform,
      homeDir: path.join(folder, 'home'),
      dataDir: path.join(folder, 'data'),
      executable: process.execPath,
      agentFile: process.execPath,
      uid: process.getuid === undefined ? 0 : process.getuid(),
      now: () => Date.now(),
      isWakeProcess: false,
      authorization: () => Promise.resolve({ scheduledPrompts: false }),
      files: nodeBackgroundFiles(),
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
