// D119 catch burn-down: each handler below names its expected failure and
// rethrows anything else. Every test drives the real code into its real
// failure (malformed text, an unknown zone, a missing file, a refused read).
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { agentCommandOf } from '../../src/shared/agentReceipt'
import { fleetSnapshotSchema } from '../../src/shared/estimate'
import { safePolicyUrl } from '../../src/shared/hostApi/accounts'
import { EN } from '../../src/shared/l10n/en'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { loadUsageTable, type UsageTable } from '../../src/shared/l10n/usageTable'
import { providerOutputMinimum } from '../../src/shared/providerRouting'
import { createReference } from '../../src/shared/reference/referenceEntry'
import { parseReviewBlock } from '../../src/shared/reviewFindings'
import { scheduleZoneSchema } from '../../src/shared/scheduleV2'
import { TEXT_FILE_DISPLAY_MARKER } from '../../src/shared/constants'
import { readTextFileDisplay } from '../../src/shared/textFileDisplay'
import { vaultMaterialSchema, vaultOriginSchema } from '../../src/shared/vault'

const scratchRoots: string[] = []
afterEach(async () => {
  while (scratchRoots.length > 0) {
    const root = scratchRoots.pop()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  }
})

async function scratchRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'shared-catch-'))
  scratchRoots.push(root)
  return root
}

describe('agentCommandOf malformed tool arguments', () => {
  it('reads no command from text no JSON value denotes', () => {
    expect(
      agentCommandOf({
        itemId: 'i1',
        kind: 'toolCall',
        status: 'done',
        tool: 'bash',
        args: '{oops',
      }),
    ).toBeUndefined()
  })

  it('still reads a command from well-formed arguments', () => {
    expect(
      agentCommandOf({
        itemId: 'i1',
        kind: 'toolCall',
        status: 'done',
        tool: 'bash',
        args: JSON.stringify({ command: 'git status' }),
      }),
    ).toBe('git status')
  })
})

describe('review and display-text boundary input', () => {
  it('reads no findings from text no JSON value denotes', () => {
    expect(parseReviewBlock('{oops')).toBeUndefined()
  })

  it('keeps a damaged display suffix file-bearing', () => {
    expect(readTextFileDisplay(`visible${TEXT_FILE_DISPLAY_MARKER}{"a":]`)).toEqual([])
  })
})

describe('time-zone refinements', () => {
  it('refuses an unknown schedule zone', () => {
    expect(scheduleZoneSchema.safeParse('Bogus/Zone').success).toBe(false)
  })

  it('keeps a known schedule zone', () => {
    expect(scheduleZoneSchema.safeParse('UTC').success).toBe(true)
  })

  it('refuses a fleet window with an unknown zone', () => {
    const asOf = new Date('2026-10-01T00:00:00.000Z').toISOString()
    const fleet = {
      asOf,
      machines: [],
      roles: [],
      accounts: [
        {
          id: 'a',
          providerId: 'p',
          requestsPerMinute: 1,
          usageLimits: [
            {
              kind: 'rolling',
              periodSeconds: 60,
              id: 'w',
              unit: 'requests',
              remaining: 1,
              allowance: 2,
              resetsAt: asOf,
              timeZone: 'Bogus/Zone',
            },
          ],
        },
      ],
      slots: [],
      ci: [],
    }
    expect(fleetSnapshotSchema.safeParse(fleet).success).toBe(false)
  })
})

describe('URL refinements', () => {
  it('refuses a malformed vault origin', () => {
    expect(vaultOriginSchema.safeParse('ht!tp://[').success).toBe(false)
  })

  it('keeps a well-formed vault origin', () => {
    expect(vaultOriginSchema.safeParse('https://example.com').success).toBe(true)
  })

  it('refuses vault material with a malformed resource', () => {
    expect(
      vaultMaterialSchema.safeParse({
        kind: 'oauth',
        accessToken: new Uint8Array([1]),
        refreshToken: null,
        issuer: 'https://issuer.example',
        expiresAt: 1,
        resource: 'not a url',
      }).success,
    ).toBe(false)
  })

  it('refuses a malformed accounts policy URL', () => {
    expect(safePolicyUrl.safeParse('ht!tp://[').success).toBe(false)
  })

  it('infers no minimum from a malformed provider address', () => {
    expect(providerOutputMinimum('ht!tp://[', 'muse-spark-test', 7, 'responses')).toBe(7)
  })
})

function loadFrom(root: string, warnings: string[]): Promise<UsageTable> {
  return loadUsageTable({
    language: 'de',
    readTableFile: (segments) => readFile(path.join(root, ...segments), 'utf8'),
    warn: (message) => {
      warnings.push(message)
    },
  })
}

describe('usage table reads', () => {
  it('falls back to English with a warning when the table file is missing', async () => {
    const root = await scratchRoot()
    const warnings: string[] = []
    const loaded = await loadFrom(root, warnings)
    expect(loaded.locale).toBe('en')
    expect(loaded.table).toBe(USAGE_EN)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('unreadable')
  })

  it('falls back to English with a warning when the table text is corrupt', async () => {
    const root = await scratchRoot()
    await mkdir(path.join(root, 'l10n'), { recursive: true })
    await writeFile(path.join(root, 'l10n', 'usage.de.json'), '{oops', 'utf8')
    const warnings: string[] = []
    const loaded = await loadFrom(root, warnings)
    expect(loaded.table).toBe(USAGE_EN)
    expect(warnings).toHaveLength(1)
  })

  it('lets a refused read keep its kind instead of answering English', async () => {
    const warnings: string[] = []
    await expect(
      loadUsageTable({
        language: 'de',
        readTableFile: () =>
          Promise.reject(Object.assign(new Error('table locked'), { code: 'EBUSY' })),
        warn: (message) => {
          warnings.push(message)
        },
      }),
    ).rejects.toThrow('table locked')
    expect(warnings).toEqual([])
  })
})

function hostWith(readNls: () => Promise<unknown>) {
  const posts: unknown[] = []
  return {
    posts,
    host: {
      readNls,
      currentValue: () => undefined,
      openSetting: () => Promise.resolve(),
      runCommand: () => Promise.resolve(),
      post: (message: unknown) => {
        posts.push(message)
      },
    },
  }
}

describe('reference values read', () => {
  it('carries a failed table read to the caller instead of answering values', async () => {
    const root = await scratchRoot()
    const { posts, host } = hostWith(() =>
      readFile(path.join(root, 'l10n', 'package.nls.de.json'), 'utf8'),
    )
    const reference = createReference(EN, 'en')
    await expect(reference.handle({ type: 'readReference' }, host)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(posts).toEqual([])
  })

  it('wraps a non-error rejection so its kind survives', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the port may reject with a foreign value; the boundary must wrap it, never leak it.
    const { posts, host } = hostWith(() => Promise.reject('a string failure'))
    const reference = createReference(EN, 'en')
    try {
      await reference.handle({ type: 'readReference' }, host)
      expect.unreachable('a failing read must reject the reference handle')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      if (error instanceof Error) expect(error.cause).toBe('a string failure')
    }
    expect(posts).toEqual([])
  })
})
