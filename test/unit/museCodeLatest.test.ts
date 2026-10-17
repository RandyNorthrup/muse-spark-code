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
  modelListResultSchema,
  skillListResultSchema,
  toModelSummary,
  toSkillSummary,
} from '../../src/core/backends/musecode/MuseCodeHost'
import { mapNotification, UNKNOWN_METHOD } from '../../src/core/backends/musecode/mapNotification'
import { parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { museCodeLoadedSessionCeiling } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/constants'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/m126/${name}`, import.meta.url), 'utf8'))
}

const sessionId = 's1'

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
  it('leaves surfaces without a UI home unmapped and logged, not invented', () => {
    // recap/completed was recorded (providerFailed on echo); computer-use
    // setup has no surface in this product. Both stay UNKNOWN_METHOD until
    // an owner decision gives them one (docs/certification/muse-code-latest.md).
    for (const params of fixture('note-recap-completed-1.4.9.json') as unknown[]) {
      expect(mapNotification({ method: 'recap/completed', params })).toBe(UNKNOWN_METHOD)
    }
    expect(mapNotification({ method: 'computerUseSetup/changed', params: { state: {} } })).toBe(
      UNKNOWN_METHOD,
    )
  })
  it('keeps the recorded branch observation unmapped until a surface shows it', () => {
    for (const params of fixture('note-session-branchChanged-1.4.9.json') as unknown[]) {
      expect(mapNotification({ method: 'session/branchChanged', params })).toBe(UNKNOWN_METHOD)
    }
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
