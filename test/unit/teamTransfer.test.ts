// Import and export (M96 lane F): the export never holds a credential,
// an endpoint, a provider definition or a command line; the import is
// refused whole on an unknown key, opens as a draft, and marks entries
// the user lacks as missing.

import { describe, expect, it } from 'vitest'
import {
  buildTeamExport,
  isTeamImportRefusal,
  parseTeamImport,
  TEAM_EXPORT_FORMAT,
  TEAM_EXPORT_VERSION,
  type TeamImportDraft,
  type TeamStoredRole,
} from '../../src/core/team/teamTransfer'

const STORED: readonly TeamStoredRole[] = [
  {
    role: 'engineering',
    mode: 'own-branch',
    toolGroups: ['read', 'write', 'shell'],
    charterText: 'Ship tested code.',
    pool: [
      {
        modelRef: 'muse-spark-1.3',
        caps: [{ measure: 'tokens', window: 'task', amount: 400_000 }],
        credentialRecord: { apiKey: 'LLM_SECRET' },
        endpoint: 'https://models.example.com',
        provider: { id: 'meta', baseUrl: 'https://models.example.com' },
      },
      {
        modelRef: 'codex-cli',
        caps: [{ measure: 'tokens', window: 'task', amount: 400_000 }],
        commandLine: ['codex', '--profile', 'mine'],
      },
    ],
  },
]

describe('buildTeamExport', () => {
  it('holds roles, charters, pools and caps with the format marker', () => {
    const document = buildTeamExport('full', STORED)
    expect(document.format).toBe(TEAM_EXPORT_FORMAT)
    expect(document.version).toBe(TEAM_EXPORT_VERSION)
    expect(document.roles).toHaveLength(1)
    expect(document.roles[0]?.pool.map((entry) => entry.modelRef)).toEqual([
      'muse-spark-1.3',
      'codex-cli',
    ])
  })

  it('never exports a credential, an endpoint, a provider or a command line', () => {
    const text = JSON.stringify(buildTeamExport('full', STORED))
    for (const secret of ['LLM_SECRET', 'models.example.com', '--profile', 'mine']) {
      expect(text).not.toContain(secret)
    }
  })
})

describe('parseTeamImport', () => {
  it('round-trips an export into a draft with no missing entries', () => {
    const parsed = parseTeamImport(buildTeamExport('full', STORED), ['muse-spark-1.3', 'codex-cli'])
    if (isTeamImportRefusal(parsed)) {
      throw new Error(`refused: ${parsed.reason}`)
    }
    const draft: TeamImportDraft = parsed
    expect(draft.draft.template).toBe('full')
    expect(draft.draft.roles).toHaveLength(1)
    expect(draft.missing).toEqual([])
    expect(draft.charters['engineering']).toBe('Ship tested code.')
  })

  it('opens roles without charter text with no charters', () => {
    const roles = STORED.map((role) => ({ ...role, charterText: undefined }))
    const parsed = parseTeamImport(buildTeamExport('full', roles), ['muse-spark-1.3', 'codex-cli'])
    if (isTeamImportRefusal(parsed)) {
      throw new Error(`refused: ${parsed.reason}`)
    }
    expect(parsed.charters).toEqual({})
  })

  it('marks entries the user lacks as missing', () => {
    const parsed = parseTeamImport(buildTeamExport('full', STORED), ['muse-spark-1.3'])
    if (isTeamImportRefusal(parsed)) {
      throw new Error(`refused: ${parsed.reason}`)
    }
    expect(parsed.missing.map((entry) => entry.modelRef)).toEqual(['codex-cli'])
    expect(parsed.missing[0]?.message).toContain('codex-cli')
  })

  it('refuses an unknown top-level key whole, naming it', () => {
    const parsed = parseTeamImport({ ...buildTeamExport('full', STORED), apiKey: 'LLM_SECRET' }, [
      'muse-spark-1.3',
    ])
    expect(isTeamImportRefusal(parsed)).toBe(true)
    if (!isTeamImportRefusal(parsed)) {
      throw new Error('expected a refusal')
    }
    expect(parsed.reason).toContain('apiKey')
  })

  it('refuses an unknown role key and an unknown cap key', () => {
    const document = buildTeamExport('full', STORED)
    const roleKey = parseTeamImport(
      {
        ...document,
        roles: [{ ...document.roles[0], owner: 'me' }],
      },
      [],
    )
    expect(isTeamImportRefusal(roleKey)).toBe(true)
    const capKey = parseTeamImport(
      {
        ...document,
        roles: [
          {
            ...document.roles[0],
            pool: [
              {
                modelRef: 'x',
                caps: [{ measure: 'tokens', window: 'task', amount: 1, burst: true }],
              },
            ],
          },
        ],
      },
      [],
    )
    expect(isTeamImportRefusal(capKey)).toBe(true)
    if (!isTeamImportRefusal(capKey)) {
      throw new Error('expected a refusal')
    }
    expect(capKey.reason).toContain('burst')
  })

  it('refuses an unknown entry key', () => {
    const document = buildTeamExport('full', STORED)
    const parsed = parseTeamImport(
      {
        ...document,
        roles: [
          {
            ...document.roles[0],
            pool: [{ modelRef: 'x', caps: [], provider: 'meta' }],
          },
        ],
      },
      [],
    )
    expect(isTeamImportRefusal(parsed)).toBe(true)
    if (!isTeamImportRefusal(parsed)) {
      throw new Error('expected a refusal')
    }
    expect(parsed.reason).toContain('provider')
  })

  it('refuses a malformed document', () => {
    expect(isTeamImportRefusal(parseTeamImport({ format: TEAM_EXPORT_FORMAT }, []))).toBe(true)
    expect(isTeamImportRefusal(parseTeamImport('not a team', []))).toBe(true)
  })
})
