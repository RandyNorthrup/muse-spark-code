// The OS hand-off's wait (src/core/resources/commands.ts, D121): the
// caller's own deadline ends the wait when passed; otherwise the safety
// default (RESOURCE_HANDOFF_TIMEOUT_MS) still ends it, counting the
// adapter as launched. The adapter's exit, its start, or the caller's
// cancel ends it sooner. A still-running adapter at the deadline is
// detached (launched, never killed).
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { configureResources } from '../../src/core/resources/admission'
import { handoffResourceFile } from '../../src/core/resources/commands'
import { createdPathCommands } from '../../src/core/resources/resourceGovernorEntry'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'
import { buildLinuxHelper } from '../../scripts/build-linux-helper.mjs'

// A real adapter: node itself, writing a marker after SLOW_ADAPTER_MS and
// exiting 0. Slow enough that only a detached wait resolves before it.
const SLOW_ADAPTER_MS = 3000
const ADAPTER_SCRIPT = `setTimeout(()=>require("node:fs").writeFileSync(process.argv[1],"done"),${String(SLOW_ADAPTER_MS)})`
const QUICK_SCRIPT = 'process.exit(0)'

const fixture: {
  root: string
  dispose?: (() => void) | undefined
} = { root: '' }

beforeAll(async () => {
  mkdirSync('temp', { recursive: true })
  fixture.root = mkdtempSync(path.resolve('temp', 'fix-handoff-deadline-'))
  // The governor's bundled default spells dist/../native, which from source
  // would read src/core/native: the created helper is rooted at a fixture
  // install instead, the way the vault panel fixtures stage one.
  let commands: (args: readonly string[]) => Promise<string>
  let windowsJob: ReturnType<typeof runtimeWindowsJob> | undefined
  if (process.platform === 'linux') {
    buildLinuxHelper(path.join(fixture.root, 'linux', process.arch))
    commands = createdPathCommands(fixture.root, undefined)
  } else if (process.platform === 'win32') {
    windowsJob = runtimeWindowsJob(
      mkdtempSync(path.join(tmpdir(), 'handoff-deadline-jobs-')),
      path.resolve('.'),
    )
    // The build is admitted through the governor, configured as the host does.
    const built = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      windowsJob,
    })
    try {
      if ((await windowsJob()) === undefined)
        throw new Error('the Windows job helpers did not build')
    } finally {
      built()
    }
    commands = createdPathCommands(path.resolve('native'), windowsJob)
  } else {
    commands = createdPathCommands(path.resolve('native'), undefined)
  }
  // One governor for the file, as production keeps one per window; the
  // registry manifest stays in the fixture root, out of the tests' way.
  fixture.dispose = configureResources({
    registryFile: path.join(fixture.root, 'resource-created', 'registry.json'),
    createdDirectories: commands,
    inspect: () => ({}),
    onError: () => undefined,
    ...(windowsJob !== undefined && { windowsJob }),
  })
})

afterAll(() => {
  fixture.dispose?.()
  fixture.dispose = undefined
  fixture.root = ''
})

async function runHandoff(
  storage: string,
  marker: string,
  script: string,
  extra?: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
): Promise<void> {
  await handoffResourceFile(process.execPath, ['-e', script, marker], {
    env: process.env,
    workspaceRoot: storage,
    ...(extra?.timeoutMs !== undefined && { timeoutMs: extra.timeoutMs }),
    ...(extra?.signal !== undefined && { signal: extra.signal }),
  })
}

async function waitForMarker(marker: string): Promise<void> {
  const started = Date.now()
  while (!existsSync(marker)) {
    if (Date.now() - started > SLOW_ADAPTER_MS + 2000) throw new Error('marker never landed')
    await delay(100)
  }
}

describe('handoffResourceFile wait', () => {
  it('detaches at an explicit deadline instead of waiting out the adapter', async () => {
    const storage = await mkdtemp(path.join(tmpdir(), 'handoff-deadline-'))
    try {
      const marker = path.join(storage, 'marker')
      // The deadline covers admission and the adapter run: admission is
      // warmed and timed first, so the bound falls on the adapter alone,
      // half-way through its run. A Windows hand-off's admission (job
      // helper, temp root) measured 0.9-1.5 s on a desktop PC, where a
      // fixed 500 ms deadline cancelled admission before the adapter ran.
      const warmStarted = Date.now()
      await runHandoff(storage, path.join(storage, 'warmup'), QUICK_SCRIPT)
      const admissionMs = Date.now() - warmStarted
      await runHandoff(storage, marker, ADAPTER_SCRIPT, {
        timeoutMs: admissionMs + SLOW_ADAPTER_MS / 2,
      })
      // Resolved while the adapter still runs: the marker lands only later.
      expect(existsSync(marker)).toBe(false)
      // Detached, never killed: the adapter runs to its own end.
      await waitForMarker(marker)
    } finally {
      await rm(storage, { recursive: true, force: true })
    }
  })

  it('waits for the adapter exit without a caller deadline', async () => {
    const storage = await mkdtemp(path.join(tmpdir(), 'handoff-exit-'))
    try {
      const marker = path.join(storage, 'marker')
      await runHandoff(storage, marker, ADAPTER_SCRIPT)
      expect(existsSync(marker)).toBe(true)
    } finally {
      await rm(storage, { recursive: true, force: true })
    }
  })

  it('ends the wait at the caller cancel', async () => {
    const storage = await mkdtemp(path.join(tmpdir(), 'handoff-cancel-'))
    try {
      const marker = path.join(storage, 'marker')
      const stop = new AbortController()
      const pending = runHandoff(storage, marker, ADAPTER_SCRIPT, { signal: stop.signal })
      stop.abort(new Error('caller stopped waiting'))
      await expect(pending).rejects.toThrow()
    } finally {
      await rm(storage, { recursive: true, force: true })
    }
  })
})
