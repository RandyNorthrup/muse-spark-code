// M126: Muse Code at its latest release. Every frame below is a recorded
// exchange with Muse Code 1.4.9 (1.4.9-R6297.1) over `muse serve --provider
// echo --no-session-log` on 2026-10-17 (test/fixtures/m126/provenance.json);
// no model call, no sign-in. Notification params the echo host cannot emit
// (a provider backoff, an Auto-review hold, a plugin install) follow the
// CLI's own schema export captured the same day
// (`muse schema generate-json-schema`, temp/muse-captures/schema-1.4.9).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  backgroundTaskListResultSchema,
  claimRecapSettlement,
  hookListResultSchema,
  modelListResultSchema,
  pluginListResultSchema,
  skillImportResultSchema,
  skillListResultSchema,
  toBackgroundTaskSummary,
  toForeignSkillImport,
  toModelSummary,
  toSessionHookRow,
  toSessionPluginRow,
  toSkillSummary,
} from '../../src/core/backends/musecode/MuseCodeHost'
import { mapNotification, UNKNOWN_METHOD } from '../../src/core/backends/musecode/mapNotification'
import { dispatchHooks, parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { subagentSpawnDescription } from '../../src/core/backends/modelapi/subagentTools'
import {
  HOOK_MAX_STOP_CONTINUATIONS,
  SETTING_DEFAULTS,
  SUBAGENT_CAPACITY,
  museCodeLoadedSessionCeiling,
} from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/constants'
import type { ShellResult } from '../../src/core/shellResult'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/m126/${name}`, import.meta.url), 'utf8'))
}

const sessionId = 's1'

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
    // Shape per the CLI’s own schema export (TurnModelRetryScheduledParams);
    // the echo host cannot fail a provider attempt, so no wire frame exists.
    const mapped = mapNotification({
      method: 'turn/modelRetryScheduled',
      params: {
        sessionId,
        turnId: 't1',
        attempt: 1,
        nextAttempt: 2,
        maxAttempts: 3,
        retryDelayMs: 5000,
        errorKind: 'rateLimited',
        httpStatus: 429,
        system: 'meta',
      },
    })
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
})

describe('hook event ToolUseStart', () => {
  it('parses a ToolUseStart group without an unsupported-event warning', () => {
    const parsed = parseHookConfig(
      JSON.stringify({
        hooks: { ToolUseStart: [{ hooks: [{ type: 'command', command: 'true' }] }] },
      }),
      'user',
      'linux',
    )
    expect(parsed.warnings).toEqual([])
    expect(parsed.hooks).toHaveLength(1)
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

  it('maps running task and installed plugin rows per the CLI schema', () => {
    // No background task ran on the echo host and no plugin is installed
    // in the scratch home; row shapes follow the CLI's own schema export.
    expect(
      toBackgroundTaskSummary({
        taskId: 't1',
        kind: 'shell',
        status: 'running',
        startedAt: '2026-10-17T18:20:00Z',
      }),
    ).toEqual({ taskId: 't1', kind: 'shell', status: 'running', startedAt: '2026-10-17T18:20:00Z' })
    expect(
      toSessionPluginRow({ id: 'p1', version: '1.0.0', enabled: true, source: { type: 'local' } }),
    ).toEqual({ id: 'p1', version: '1.0.0', enabled: true, source: { type: 'local' } })
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

  it('carries quarantine and failure entries with their reasons', () => {
    // Empty on the echo dry run; entry shapes follow the CLI's own schema.
    const receipt = toForeignSkillImport({
      source: 'claude',
      dryRun: false,
      status: 'accepted',
      counts: { installed: 1, quarantined: 1, skipped: 1, failed: 1 },
      installed: ['ok-skill'],
      skipped: ['known-skill'],
      quarantined: [{ id: 'q-skill', reason: 'unsigned' }],
      failed: [{ id: null, reason: 'no frontmatter' }],
    })
    expect(receipt.installed).toEqual(['ok-skill'])
    expect(receipt.quarantined).toEqual([{ id: 'q-skill', reason: 'unsigned' }])
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

describe('hook and subagent setting defaults', () => {
  it('ships Muse Code’s own defaults', () => {
    expect(SETTING_DEFAULTS.hooksMaxStopContinuations).toBe(HOOK_MAX_STOP_CONTINUATIONS)
    expect(SETTING_DEFAULTS.hooksMaxStopContinuations).toBe(8)
    expect(SETTING_DEFAULTS.hooksMaxRunningCommands).toBe(0)
    expect(SETTING_DEFAULTS.subagentMaxConcurrent).toBe(SUBAGENT_CAPACITY)
    expect(SETTING_DEFAULTS.subagentMaxConcurrent).toBe(8)
  })

  it('names the live subagent count in the spawn description', () => {
    expect(subagentSpawnDescription()).toContain('Up to 8 work at once')
    expect(subagentSpawnDescription(3)).toContain('Up to 3 work at once')
    expect(subagentSpawnDescription(64)).toContain('Up to 64 work at once')
  })
})
