// M127: Muse Code at its latest release. Every frame below is a recorded
// exchange with Muse Code 1.4.9 (1.4.9-R6297.1) over `muse serve --provider
// echo --no-session-log` on 2026-10-17 (test/fixtures/m127/provenance.json);
// no model call, no sign-in. Notification params the echo host cannot emit
// (a provider backoff, an Auto-review hold, a plugin install) follow the
// CLI's own schema export captured the same day
// (`muse schema generate-json-schema`, temp/muse-captures/schema-1.4.9).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { TurnModelRetryScheduledParams } from '@muse-code/sdk/dist/src/msp.js'
import {
  backgroundTaskListResultSchema,
  claimLeaveSettlement,
  claimRecapSettlement,
  computerUseSettingsResultSchema,
  hookListResultSchema,
  modelListResultSchema,
  pluginListResultSchema,
  sessionLeaveResultSchema,
  skillImportResultSchema,
  skillListResultSchema,
  skillSetActivationResultSchema,
  toBackgroundTaskSummary,
  toForeignSkillImport,
  toModelSummary,
  toSessionHookRow,
  toSessionPluginRow,
  toSkillSummary,
  workflowControlResultSchema,
} from '../../src/core/backends/musecode/MuseCodeHost'
import { mapNotification, UNKNOWN_METHOD } from '../../src/core/backends/musecode/mapNotification'
import { sessionClosedSchema } from '../../src/core/backends/musecode/sessionRecords'
import {
  acquireHookProcessSlot,
  dispatchHooks,
  parseHookConfig,
} from '../../src/core/backends/modelapi/hooks'
import { subagentSpawnDescription } from '../../src/core/backends/modelapi/subagentTools'
import { readSettings, type SettingsSource } from '../../src/host/settings'
import { warningLogger } from './helpers/collectingLogger'
import {
  HOOK_MAX_RUNNING_COMMANDS,
  SETTING_DEFAULTS,
  SUBAGENT_CAPACITY,
  museCodeLoadedSessionCeiling,
} from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/constants'
import type { ShellResult } from '../../src/core/shellResult'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/m127/${name}`, import.meta.url), 'utf8'))
}

const sessionId = 's1'

/** An in-memory settings port: the keys `readSettings` asks for, nothing else. */
function settingSource(values: Record<string, unknown>): SettingsSource {
  return {
    get: (key: string) => values[key],
  }
}

/** A runner that holds every started command until the test releases it. */
function heldRunner(onStart: (command: string, running: number) => void) {
  let running = 0
  const releases: (() => void)[] = []
  const runHook = async (command: string): Promise<ShellResult> => {
    running += 1
    onStart(command, running)
    await new Promise<void>((resolve) => {
      releases.push(() => {
        running -= 1
        resolve()
      })
    })
    return { stdout: '', stderr: '', exitCode: 0, isTimedOut: false, isCancelled: false }
  }
  return { runHook, releases }
}

describe('museCodeLoadedSessionCeiling', () => {
  it('reads Muse Code’s documented per-release bound from the served version', () => {
    // M-CL 1.4.5: 32 through 1.4.4, 256 from 1.4.5.
    expect(museCodeLoadedSessionCeiling('1.4.4')).toBe(32)
    expect(museCodeLoadedSessionCeiling('1.4.4-R5419.1')).toBe(32)
    expect(museCodeLoadedSessionCeiling('1.4.5')).toBe(256)
    expect(museCodeLoadedSessionCeiling('1.4.9')).toBe(256)
    expect(museCodeLoadedSessionCeiling('1.4.9-R6297.1')).toBe(256)
    expect(museCodeLoadedSessionCeiling('2.0.0')).toBe(256)
  })
  it('reads an unreadable version as the older documented bound', () => {
    expect(museCodeLoadedSessionCeiling(undefined)).toBe(32)
    expect(museCodeLoadedSessionCeiling('')).toBe(32)
    expect(museCodeLoadedSessionCeiling('not-a-version')).toBe(32)
    expect(museCodeLoadedSessionCeiling('0.9.9')).toBe(32)
    expect(museCodeLoadedSessionCeiling('1.3.0')).toBe(32)
  })
})

describe('recorded model/list (outputLimit)', () => {
  it('reads the per-model output limit the catalog serves', () => {
    const rows = modelListResultSchema.parse(fixture('model-list-1.4.9.json')).models
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      // The echo host serves 128,000 with an effective 1,007,997 window.
      const summary = toModelSummary(row)
      expect(summary.outputLimit).toBe(128_000)
      expect(summary.contextLimit).toBe(1_007_997)
    }
  })
  it('reads a null output limit as absent, as older catalogs serve', () => {
    const parsed = modelListResultSchema.parse({
      models: [
        {
          modelId: 'm',
          displayLabel: 'm',
          contextLimit: null,
          outputLimit: null,
          isDefault: false,
        },
      ],
    })
    expect(parsed.models[0]?.outputLimit).toBeNull()
  })
})

describe('recorded skill/list (title)', () => {
  it('reads the declared human-readable name where the skill sets one', () => {
    const rows = skillListResultSchema.parse(fixture('skill-list-1.4.9.json')).skills
    const titled = rows.find((row) => row.selector === 'titled-skill')
    // Served only because the capture skill declares metadata.display-name.
    expect(titled).toBeDefined()
    expect(toSkillSummary(titled!).title).toBe('Titled Skill')
    expect(toSkillSummary(titled!).displayName).toBe('titled-skill')
  })
  it('leaves title absent where the skill declares none', () => {
    const rows = skillListResultSchema.parse(fixture('skill-list-1.4.9.json')).skills
    const plain = rows.find((row) => row.selector === 'create-plugin')
    expect(plain).toBeDefined()
    expect(toSkillSummary(plain!).title).toBeUndefined()
  })
})

describe('recorded initialize', () => {
  it('names the served build and its sandbox posture', () => {
    const init = fixture('initialize-1.4.9.json') as {
      serverInfo: { version: string }
      schema: { fingerprint: string }
      grantedCapabilities: string[]
      sandboxAvailability?: string
    }
    expect(init.serverInfo.version).toBe('1.4.9')
    expect(init.schema.fingerprint).toBe(
      'sha256:5d3b43e5ccdb7dc4f5a32c380f5f2cde0f10e3059b93610afb2e73f73b1d914c',
    )
    expect(init.sandboxAvailability).toBe('available')
    // Requested but not granted by this host: rename stays behind the
    // platform gate, never assumed from the request.
    expect(init.grantedCapabilities).not.toContain('sessionRename')
  })
})

describe('new notifications', () => {
  it('maps a model retry to the retry event with the attempt’s own words', () => {
    // Member for member the pinned SDK 1.4.10's `TurnModelRetryScheduledParams`
    // (which folds live `turn/modelRetryScheduled` frames) and the CLI 1.4.10's
    // own schema export (fingerprint sha256:5d3b…914c, verified 2026-10-18):
    // the annotation below fails compilation if the wire contract moves. The
    // echo host cannot fail a provider attempt, so no recorded frame exists;
    // a live provider-retry capture stays lead-owned real-life proof.
    const wire: Omit<TurnModelRetryScheduledParams, 'sourceRange' | 'viewCursor'> = {
      sessionId,
      turnId: 't1',
      attempt: 1,
      nextAttempt: 2,
      maxAttempts: 3,
      retryDelayMs: 5000,
      errorKind: 'rateLimited',
      httpStatus: 429,
      system: 'meta',
    }
    const mapped = mapNotification({ method: 'turn/modelRetryScheduled', params: wire })
    expect(mapped).toEqual({
      sessionId,
      event: {
        type: 'turnRetry',
        turnId: 't1',
        attempt: 1,
        maxAttempts: 3,
        retryDelayMs: 5000,
        reason: 'rateLimited',
        nextAttempt: 2,
        errorKind: 'rateLimited',
        httpStatus: 429,
        system: 'meta',
      },
    })
  })
  it('names the HTTP status when the attempt carries no kind', () => {
    const mapped = mapNotification({
      method: 'turn/modelRetryScheduled',
      params: {
        sessionId,
        turnId: 't1',
        attempt: 2,
        nextAttempt: 3,
        maxAttempts: 3,
        retryDelayMs: 1000,
        httpStatus: 503,
      },
    })
    expect(mapped).toMatchObject({ event: { type: 'turnRetry', reason: 'HTTP 503' } })
  })
  it('carries the 1.4.6 provider facets on turn-level retries', () => {
    const mapped = mapNotification({
      method: 'turn/retryScheduled',
      params: {
        sessionId,
        turnId: 't1',
        attempt: 1,
        nextAttempt: 2,
        maxAttempts: 3,
        retryDelayMs: 2000,
        reason: 'glitch',
        errorKind: 'overloaded',
        httpStatus: 503,
        system: 'meta',
      },
    })
    expect(mapped).toMatchObject({
      event: {
        type: 'turnRetry',
        reason: 'glitch',
        nextAttempt: 2,
        errorKind: 'overloaded',
        httpStatus: 503,
        system: 'meta',
      },
    })
  })
  it('shows an Auto-review hold as a notice naming the approval', () => {
    const mapped = mapNotification({
      method: 'approval/reviewing',
      params: { sessionId, approvalId: 'a1' },
    })
    expect(mapped).toEqual({
      sessionId,
      event: {
        type: 'backendNotice',
        level: 'info',
        text: `${UI_TEXT.approvalReviewing} (a1)`,
      },
    })
  })
  it.each(['plugin/changed', 'plugin/marketplaceChanged'] as const)(
    're-lists skills on %s',
    (method) => {
      expect(mapNotification({ method, params: { sessionId } })).toEqual({
        sessionId,
        event: { type: 'skillsChanged' },
      })
    },
  )
  it('tells a declined retract from an accepted one', () => {
    expect(
      mapNotification({ method: 'turn/retracted', params: { sessionId, turnId: 't1' } }),
    ).toMatchObject({ event: { type: 'backendNotice', text: UI_TEXT.turnRetracted } })
    expect(
      mapNotification({
        method: 'turn/retracted',
        params: { sessionId, turnId: 't1', outcome: 'accepted' },
      }),
    ).toMatchObject({ event: { type: 'backendNotice', text: UI_TEXT.turnRetracted } })
    expect(
      mapNotification({
        method: 'turn/retracted',
        params: { sessionId, turnId: 't1', outcome: 'declined' },
      }),
    ).toMatchObject({ event: { type: 'backendNotice', text: UI_TEXT.turnRetractDeclined } })
  })
  it('shows an unrequested recap settlement as it came', () => {
    // Requested recaps resolve the waiter in dispatchHostEvent and never
    // reach here; the recorded providerFailed echo settlement does.
    for (const params of fixture('note-recap-completed-1.4.9.json') as Record<string, unknown>[]) {
      expect(mapNotification({ method: 'recap/completed', params })).toEqual({
        sessionId: (params as { sessionId: string }).sessionId,
        event: { type: 'backendNotice', level: 'info', text: 'providerFailed' },
      })
    }
  })
  it('shows the recorded branch observations with the served branch', () => {
    // Both recorded frames observe feat/muse-code-latest at different
    // cursors; the detached-HEAD shape below follows the CLI's own schema
    // (branch null), unobservable on a branched checkout.
    const frames = fixture('note-session-branchChanged-1.4.9.json') as Record<string, unknown>[]
    expect(frames).toHaveLength(2)
    for (const params of frames) {
      expect(mapNotification({ method: 'session/branchChanged', params })).toEqual({
        sessionId: (params as { sessionId: string }).sessionId,
        event: {
          type: 'backendNotice',
          level: 'info',
          text: `${UI_TEXT.sessionBranchChanged} (feat/muse-code-latest)`,
        },
      })
    }
    expect(
      mapNotification({ method: 'session/branchChanged', params: { sessionId, branch: null } }),
    ).toEqual({
      sessionId,
      event: { type: 'backendNotice', level: 'info', text: UI_TEXT.sessionBranchChanged },
    })
  })
  it('shows view-health moves with the served word', () => {
    expect(
      mapNotification({
        method: 'session/viewHealthChanged',
        params: { sessionId, health: 'unavailable' },
      }),
    ).toEqual({
      sessionId,
      event: {
        type: 'backendNotice',
        level: 'info',
        text: `${UI_TEXT.sessionViewHealthChanged} (unavailable)`,
      },
    })
  })
  it('keeps the view-health failure reason the host sent', () => {
    // SDK `SessionViewHealthChangedParams.noneReason`: the actionable half
    // of an unusable view (v1 serves `projectionUnavailable`).
    expect(
      mapNotification({
        method: 'session/viewHealthChanged',
        params: { sessionId, health: 'unavailable', noneReason: 'projectionUnavailable' },
      }),
    ).toEqual({
      sessionId,
      event: {
        type: 'backendNotice',
        level: 'info',
        text: `${UI_TEXT.sessionViewHealthChanged} (unavailable: projectionUnavailable)`,
      },
    })
  })
  it('says why the turn indicator keeps spinning', () => {
    for (const params of fixture('note-turn-foregroundCompleted-1.4.9.json') as Record<
      string,
      unknown
    >[]) {
      expect(mapNotification({ method: 'turn/foregroundCompleted', params })).toEqual({
        sessionId: (params as { sessionId: string }).sessionId,
        event: { type: 'backendNotice', level: 'info', text: UI_TEXT.turnForegroundCompleted },
      })
    }
  })
  it('leaves computer-use setup changes unmapped until an owner surface exists', () => {
    // No computer-use surface in this product; stays UNKNOWN_METHOD
    // (docs/certification/muse-code-latest.md names the owner decision).
    expect(mapNotification({ method: 'computerUseSetup/changed', params: { state: {} } })).toBe(
      UNKNOWN_METHOD,
    )
  })
  it('tolerates the 1.4.11 leave handshake without mapping it', () => {
    // This client never hands a session to another host, so it never sends
    // `session/leave` and the terminal `session/leaveCompleted` stays
    // unmapped; a `session/closed` broadcast for a released leave still
    // parses, and the reason reads as served.
    expect(
      mapNotification({
        method: 'session/leaveCompleted',
        params: { sessionId, commandId: 'c1', outcome: 'released' },
      }),
    ).toBe(UNKNOWN_METHOD)
    expect(sessionClosedSchema.parse({ sessionId, reason: 'leave' })).toEqual({
      sessionId,
      reason: 'leave',
    })
  })
})

describe('hook event ToolUseStart', () => {
  it('warns that ToolUseStart is not wired instead of silently ignoring it', () => {
    // No tool-start firing point exists: the group parses (still a known
    // event) but is refused with a not-wired warning and no handler is
    // kept, so an expected observability hook can never silently do nothing.
    const parsed = parseHookConfig(
      JSON.stringify({
        hooks: { ToolUseStart: [{ hooks: [{ type: 'command', command: 'true' }] }] },
      }),
      'user',
      'linux',
    )
    expect(parsed.hooks).toEqual([])
    expect(parsed.warnings).toEqual([
      'user hooks: ToolUseStart is not wired on the Model API backend',
    ])
  })
})

describe('hook running commands setting', () => {
  const FIVE = [
    { type: 'command', command: 'a' },
    { type: 'command', command: 'b' },
    { type: 'command', command: 'c' },
    { type: 'command', command: 'd' },
    { type: 'command', command: 'e' },
  ] as const

  // Five command hooks through the real dispatch and gate; the runner holds
  // every started command until the test releases it, recording the peak.
  async function peakRunning(maxRunningCommands?: number): Promise<number> {
    const parsed = parseHookConfig(
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [...FIVE] }] } }),
      'user',
      'linux',
    )
    expect(parsed.warnings).toEqual([])
    let peak = 0
    const { runHook, releases } = heldRunner((_command, running) => {
      peak = Math.max(peak, running)
    })
    const warnings: string[] = []
    const work = dispatchHooks(
      parsed.hooks,
      'SessionStart',
      { cwd: '/ws' },
      undefined,
      { runHook },
      undefined,
      (warning) => {
        warnings.push(warning)
      },
      undefined,
      undefined,
      undefined,
      undefined,
      maxRunningCommands === undefined ? undefined : { maxRunningCommands },
    )
    for (let round = 0; round < 10 && releases.length === 0; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    while (releases.length > 0) {
      const release = releases.shift()
      release?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await work
    return peak
  }

  it('starts every matching handler at once when the setting is 0', async () => {
    expect(await peakRunning(0)).toBe(5)
  })

  it('serializes handlers when the setting is 1', async () => {
    expect(await peakRunning(1)).toBe(1)
  })

  it('keeps the extension-host fallback cap without the setting', async () => {
    expect(await peakRunning()).toBe(4)
  })

  it('runs the production process gate under the passed cap', async () => {
    // The VS Code runner's gate (toolIo runHook): the setting's 0 grants
    // every slot at once, 1 serializes, and no cap keeps the fallback.
    const unlimited = await Promise.all(
      [0, 1, 2, 3, 4].map(() => acquireHookProcessSlot(undefined, 0)),
    )
    expect(unlimited).toHaveLength(5)
    for (const release of unlimited) {
      release()
    }
    const first = await acquireHookProcessSlot(undefined, 1)
    let isSecondStarted = false
    const secondPending = (async () => {
      const release = await acquireHookProcessSlot(undefined, 1)
      isSecondStarted = true
      return release
    })()
    for (let round = 0; round < 5; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(isSecondStarted).toBe(false)
    first()
    const releaseSecond = await secondPending
    releaseSecond()
    const fallback = await Promise.all([0, 1, 2, 3].map(() => acquireHookProcessSlot(undefined)))
    expect(fallback).toHaveLength(HOOK_MAX_RUNNING_COMMANDS)
    let isFifthStarted = false
    const fifthPending = (async () => {
      const release = await acquireHookProcessSlot(undefined)
      isFifthStarted = true
      return release
    })()
    for (let round = 0; round < 5; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(isFifthStarted).toBe(false)
    for (const release of fallback) {
      release()
    }
    const releaseFifth = await fifthPending
    releaseFifth()
  })

  it('wakes the waiter behind an aborted capped waiter', async () => {
    // Four slots held at cap 4, a cap-1 waiter heading the queue with a
    // cap-4 waiter behind it: one release leaves both queued (the head's
    // cap is not met), and aborting the head must grant the waiter behind
    // it while room allows instead of stalling it for a full hook timeout.
    const held = await Promise.all([0, 1, 2, 3].map(() => acquireHookProcessSlot(undefined, 4)))
    const abort = new AbortController()
    let headOutcome = 'pending'
    const headPending = (async () => {
      try {
        await acquireHookProcessSlot(abort.signal, 1)
        headOutcome = 'granted'
      } catch {
        headOutcome = 'cancelled'
      }
    })()
    let isTailGranted = false
    const tailPending = (async () => {
      const release = await acquireHookProcessSlot(undefined, 4)
      isTailGranted = true
      return release
    })()
    const flush = async () => {
      for (let round = 0; round < 5; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    await flush()
    expect(headOutcome).toBe('pending')
    expect(isTailGranted).toBe(false)
    held[0]!()
    await flush()
    expect(isTailGranted).toBe(false)
    abort.abort()
    await flush()
    await headPending
    expect(headOutcome).toBe('cancelled')
    expect(isTailGranted).toBe(true)
    const releaseTail = await tailPending
    releaseTail()
    for (const release of held.slice(1)) {
      release()
    }
  })

  it('holds a lowered cap for queued handlers instead of handing them freed slots', async () => {
    // One host-wide gate, two dispatches: the first runs four of five at
    // cap 4, the second queues its one handler at cap 1 (the setting
    // lowered between dispatches). The cap-1 handler may start only when
    // it would be the sole command running.
    const parsed = parseHookConfig(
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [...FIVE] }] } }),
      'user',
      'linux',
    )
    const solo = parseHookConfig(
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'z' }] }] } }),
      'user',
      'linux',
    )
    let soloStartedAt = -1
    const { runHook, releases } = heldRunner((command, running) => {
      if (command === 'z') {
        soloStartedAt = running
      }
    })
    const dispatch = (hooks: typeof parsed.hooks, maxRunningCommands: number) =>
      dispatchHooks(
        hooks,
        'SessionStart',
        { cwd: '/ws' },
        undefined,
        { runHook },
        undefined,
        () => undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { maxRunningCommands },
      )
    const first = dispatch(parsed.hooks, 4)
    const second = dispatch(solo.hooks, 1)
    for (let round = 0; round < 10 && releases.length < 4; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(releases).toHaveLength(4)
    while (releases.length > 0) {
      releases.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await Promise.all([first, second])
    expect(soloStartedAt).toBe(1)
  })
})

describe('session inventories (task/hook/plugin)', () => {
  it('reads the recorded empty task and plugin lists', () => {
    expect(backgroundTaskListResultSchema.parse(fixture('task-list-1.4.9.json'))).toEqual({
      tasks: [],
    })
    expect(pluginListResultSchema.parse(fixture('plugin-list-1.4.9.json'))).toEqual({ plugins: [] })
  })

  it('reads the recorded hook row with the wire event word', () => {
    const rows = hookListResultSchema.parse(fixture('hook-list-1.4.9.json')).hooks
    expect(rows).toHaveLength(1)
    // Served camelCase on the wire (HookEventName is PascalCase): kept verbatim.
    expect(toSessionHookRow(rows[0]!)).toMatchObject({
      event: 'sessionStart',
      handlerKind: 'project',
      enabled: false,
    })
    expect(toSessionHookRow(rows[0]!).key).toContain('session_start')
  })

  it('maps the recorded installed plugin row with its source word', () => {
    // Recorded 2026-10-18 from Muse Code 1.4.10 (`plugin-list-1.4.10.json`):
    // a locally installed Agent Plugins bundle serves `foreignImport` as
    // the source word, carried through opaquely.
    const rows = pluginListResultSchema.parse(fixture('plugin-list-1.4.10.json')).plugins
    expect(rows).toHaveLength(1)
    expect(toSessionPluginRow(rows[0]!)).toEqual({
      id: 'capture-probe',
      version: '1.0.0',
      enabled: true,
      source: 'foreignImport',
    })
  })

  it('maps a running task row per the CLI schema', () => {
    // No background task runs on the echo provider without a model turn
    // (a running `session/userShell` is not listed, measured 2026-10-18);
    // the shape below is the binary's own TaskListEntry contract from the
    // same-day schema export: required taskId/kind/status,
    // additive-optional startedAt/tool/backgroundInitiator, and
    // `inProgress` the only status served.
    const parsed = backgroundTaskListResultSchema.parse({
      tasks: [
        {
          taskId: 't1',
          kind: 'tool',
          status: 'inProgress',
          tool: 'shell',
          backgroundInitiator: 'user',
        },
      ],
    })
    expect(toBackgroundTaskSummary(parsed.tasks[0]!)).toEqual({
      taskId: 't1',
      kind: 'tool',
      status: 'inProgress',
      tool: 'shell',
      backgroundInitiator: 'user',
    })
  })
})

describe('skill/import receipt', () => {
  it('reads the recorded codex dry-run receipt', () => {
    const receipt = toForeignSkillImport(
      skillImportResultSchema.parse(fixture('skill-import-dryrun-1.4.9.json')),
    )
    expect(receipt).toMatchObject({ source: 'codex', dryRun: true, status: 'accepted' })
    expect(receipt.counts).toEqual({ failed: 0, installed: 0, quarantined: 0, skipped: 0 })
    expect(receipt.installed).toEqual([])
  })

  it('carries quarantine reasons and failure reasons per the CLI schema', () => {
    // Empty on the echo dry run (foreign sources live outside this
    // sandbox); entry shapes are the binary's own SkillImportQuarantine
    // (`id` plus `reasons`) and SkillImportFailure (`id`, nullable, plus a
    // required `reason`) from the same-day schema export.
    const receipt = toForeignSkillImport({
      source: 'claude',
      dryRun: false,
      status: 'accepted',
      counts: { installed: 1, quarantined: 1, skipped: 1, failed: 1 },
      installed: ['ok-skill'],
      skipped: ['known-skill'],
      quarantined: [{ id: 'q-skill', reasons: ['unsigned', 'unpinned-source'] }],
      failed: [{ id: null, reason: 'no frontmatter' }],
    })
    expect(receipt.installed).toEqual(['ok-skill'])
    expect(receipt.quarantined).toEqual([
      { id: 'q-skill', reasons: ['unsigned', 'unpinned-source'] },
    ])
    expect(receipt.failed).toEqual([{ id: null, reason: 'no frontmatter' }])
  })
})

describe('recap, computer-use and workflow shapes', () => {
  it('pairs the recorded request ack with its settlement by commandId', () => {
    const ack = fixture('recap-request-1.4.9.json') as {
      result: { commandId: string; status: string }
    }
    const settlements = fixture('note-recap-completed-1.4.9.json') as {
      commandId: string
      outcome: string
      reason: string
    }[]
    expect(ack.result.status).toBe('accepted')
    expect(settlements).toHaveLength(1)
    expect(settlements[0]!.commandId).toBe(ack.result.commandId)
    expect(settlements[0]!).toMatchObject({ outcome: 'failed', reason: 'providerFailed' })
  })

  it('settles a requested recap by commandId and leaves the rest unclaimed', () => {
    const settlements = fixture('note-recap-completed-1.4.9.json') as {
      commandId: string
      outcome: string
      reason: string
      sessionId: string
    }[]
    const pending = new Map<
      string,
      { readonly sessionId: string; readonly settle: (recap: unknown) => void }
    >()
    let settled: unknown
    pending.set(settlements[0]!.commandId, {
      sessionId: settlements[0]!.sessionId,
      settle: (recap) => {
        settled = recap
      },
    })
    expect(claimRecapSettlement(pending, settlements[0]!)).toEqual({
      outcome: 'failed',
      reason: 'providerFailed',
    })
    expect(settled).toEqual({ outcome: 'failed', reason: 'providerFailed' })
    expect(pending.size).toBe(0)
    // A late settlement past the wait, or one nobody asked for, stays
    // unclaimed for the notice mapping.
    expect(claimRecapSettlement(pending, settlements[0]!)).toBeUndefined()
  })

  it('refuses computer-use setup on this host with the documented kind', () => {
    // The Linux rig cannot grant macOS permissions: the recorded check
    // answers the -32033 refusal, which the wrapper lets flow as-is.
    const frame = fixture('computerUseSetup-check-1.4.9.json') as {
      error: { code: number; data: { kind: string } }
    }
    expect(frame.error).toMatchObject({ code: -32_033, data: { kind: 'computerUseUnavailable' } })
  })
})

describe('session leave, skill activation, workflow controls (1.4.11)', () => {
  it('pairs the recorded leave ack with its released settlement by commandId', () => {
    const ack = fixture('session-leave-1.4.11.json') as {
      result: { commandId: string; status: string }
    }
    expect(sessionLeaveResultSchema.parse(ack.result)).toMatchObject({ status: 'accepted' })
    const settlements = fixture('note-session-leaveCompleted-1.4.11.json') as {
      commandId: string
      outcome: string
      sessionId: string
    }[]
    expect(settlements).toHaveLength(1)
    expect(settlements[0]!.commandId).toBe(ack.result.commandId)
    expect(settlements[0]!).toMatchObject({ outcome: 'released' })
  })

  it('settles a requested handoff by commandId and leaves the rest unclaimed', () => {
    const settlements = fixture('note-session-leaveCompleted-1.4.11.json') as {
      commandId: string
      outcome: string
      sessionId: string
    }[]
    const pending = new Map<
      string,
      { readonly sessionId: string; readonly settle: (leave: unknown) => void }
    >()
    let settled: unknown
    pending.set(settlements[0]!.commandId, {
      sessionId: settlements[0]!.sessionId,
      settle: (leave) => {
        settled = leave
      },
    })
    expect(claimLeaveSettlement(pending, settlements[0]!)).toEqual({ outcome: 'released' })
    expect(settled).toEqual({ outcome: 'released' })
    expect(pending.size).toBe(0)
    // A late settlement past the wait, or one nobody asked for, stays
    // unclaimed for the notice mapping.
    expect(claimLeaveSettlement(pending, settlements[0]!)).toBeUndefined()
  })

  it('shows the recorded unload with its served reason', () => {
    for (const params of fixture('note-session-closed-1.4.11.json') as Record<string, unknown>[]) {
      expect(mapNotification({ method: 'session/closed', params })).toEqual({
        sessionId: (params as { sessionId: string }).sessionId,
        event: {
          type: 'backendNotice',
          level: 'info',
          text: `${UI_TEXT.sessionClosed} (leave)`,
        },
      })
    }
  })

  it('shows an unrequested handoff settlement as it came', () => {
    // Requested handoffs resolve the waiter in dispatchHostEvent and never
    // reach here; the recorded released echo settlement does.
    for (const params of fixture('note-session-leaveCompleted-1.4.11.json') as Record<
      string,
      unknown
    >[]) {
      expect(mapNotification({ method: 'session/leaveCompleted', params })).toEqual({
        sessionId: (params as { sessionId: string }).sessionId,
        event: {
          type: 'backendNotice',
          level: 'info',
          text: `${UI_TEXT.sessionLeaveCompleted} (released)`,
        },
      })
    }
  })

  it('reads the recorded activation receipt with what it replaced', () => {
    const frame = fixture('skill-setActivation-1.4.11.json') as { result: unknown }
    expect(skillSetActivationResultSchema.parse(frame.result)).toEqual({
      activation: 'off',
      commandId: (frame.result as { commandId: string }).commandId,
      previous: 'on',
      scope: 'bundled',
      selector: 'grill',
      status: 'accepted',
    })
  })

  it('refuses an unknown skill selector with the documented kind', () => {
    const frame = fixture('skill-setActivation-unknown-1.4.11.json') as {
      error: { code: number; data: { kind: string; selector: string } }
    }
    expect(frame.error).toMatchObject({
      code: -32_032,
      data: { kind: 'skillNotFound', selector: 'no-such-skill' },
    })
  })

  it.each([
    'workflow-pause-1.4.11.json',
    'workflow-cancel-1.4.11.json',
    'workflow-childControl-1.4.11.json',
  ] as const)('refuses an unknown run in %s with the documented kind', (name) => {
    const frame = fixture(name) as {
      error: { code: number; data: { kind: string; reason: string } }
    }
    expect(frame.error).toMatchObject({
      code: -32_030,
      data: { kind: 'commandRejected', reason: 'missing_run' },
    })
  })

  it('reads the shared control ack per the CLI schema', () => {
    // No workflow runs on the echo provider without a model turn; the
    // shape below is the binary's own WorkflowControlResult contract
    // from the same-day schema export: a bare {commandId, status} ack.
    expect(workflowControlResultSchema.parse({ commandId: 'c1', status: 'accepted' })).toEqual({
      commandId: 'c1',
      status: 'accepted',
    })
  })

  it.each(['computerUseSettings-read-1.4.11.json', 'computerUseSetup-read-1.4.11.json'] as const)(
    'refuses the computer-use read in %s on a host without it',
    (name) => {
      const frame = fixture(name) as { error: { code: number; data: { kind: string } } }
      expect(frame.error).toMatchObject({
        code: -32_033,
        data: { kind: 'computerUseUnavailable' },
      })
    },
  )

  it('reads the settings answer per the CLI schema', () => {
    // Unobservable on this Windows host (the read is refused above); the
    // shape below is the binary's own ComputerUseSettings contract from
    // the same-day schema export.
    expect(
      computerUseSettingsResultSchema.parse({
        blockedApps: [{ bundleId: 'com.example', locked: false }],
        computerControl: 'ask',
        screenshots: 'ask',
      }),
    ).toMatchObject({ computerControl: 'ask', screenshots: 'ask' })
  })
})

describe('hook and subagent setting defaults', () => {
  it('ships no limit of our own (D121)', () => {
    expect(SETTING_DEFAULTS.hooksMaxStopContinuations).toBe(0)
    expect(SETTING_DEFAULTS.hooksMaxRunningCommands).toBe(0)
    expect(SETTING_DEFAULTS.subagentMaxConcurrent).toBe(SUBAGENT_CAPACITY)
    expect(SETTING_DEFAULTS.subagentMaxConcurrent).toBe(0)
  })

  it('names the live subagent count in the spawn description', () => {
    expect(subagentSpawnDescription()).not.toContain('Up to')
    expect(subagentSpawnDescription(0)).not.toContain('Up to')
    expect(subagentSpawnDescription(3)).toContain('Up to 3 work at once')
    expect(subagentSpawnDescription(64)).toContain('Up to 64 work at once')
  })

  // NOLIMITSSET (PLAN.md D121): the 8 was ours, never a provider's — a set
  // count governs as set; what is not a count refuses with the setting named.
  it('honours a set Stop-continuation count past the removed 8', () => {
    const warnings: string[] = []
    const log = warningLogger(warnings)
    expect(
      readSettings(settingSource({ hooksMaxStopContinuations: 1000 }), log)
        .hooksMaxStopContinuations,
    ).toBe(1000)
    expect(warnings).toHaveLength(0)
    expect(
      readSettings(settingSource({ hooksMaxStopContinuations: 3 }), log).hooksMaxStopContinuations,
    ).toBe(3)
  })
})
