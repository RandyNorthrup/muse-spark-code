import { EventEmitter, once } from 'node:events'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { landTeamTask } from '../../src/host/team/teamLandingEntry'
import { createWindowIdentity } from '../../src/host/team/windowIdentity'
import { EN } from '../../src/shared/l10n/en'
import {
  landingRunGit,
  landingTask,
  makeLandingFixture,
  type LandingFixture,
} from './helpers/teamLandingFixture'

// Pause-before-rename (M96c lane K), on a real repository: while the
// workspace check is still running in the staging copy, the user's tree
// keeps its old bytes; only after the check passes does landing rename.

const holder: { fixture?: LandingFixture } = {}

beforeAll(async () => {
  holder.fixture = await makeLandingFixture('task-landing')
})

afterAll(async () => {
  await holder.fixture?.dispose()
})

describe('checked landing (real git)', () => {
  it('renames nothing into the user tree while the check is still running', async () => {
    const fixture = holder.fixture
    if (fixture === undefined) throw new Error('fixture missing')
    const { root } = fixture
    const gate = new EventEmitter()
    let isCheckStarted = false
    const landing = landTeamTask(
      EN,
      'en',
      {
        root,
        storage: fixture.storage,
        platform: process.platform,
        isTrusted: () => true,
        runGit: landingRunGit,
        writePaths: undefined,
        policy: {
          owner: createWindowIdentity(Date.now()),
          checks: () => ({
            commands: [{ name: 'check', command: 'true', timeoutSeconds: 60 }],
            platform: process.platform,
            setupCommand: '',
            cacheKey: '',
          }),
          runChecks: async () => {
            isCheckStarted = true
            await once(gate, 'release')
            return { passed: true }
          },
          confirmWithoutChecks: () => Promise.resolve(false),
          validateTarget: () => Promise.resolve(),
          hints: () => Promise.resolve([]),
        },
      },
      landingTask(fixture),
      new AbortController().signal,
      { allowProtected: false },
    )

    // The check is running in the staging copy; the user tree is untouched.
    // Staging clones and merges with real git before the check runs.
    await vi.waitFor(
      () => {
        expect(isCheckStarted).toBe(true)
      },
      { timeout: 30_000 },
    )
    expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('before\n')

    gate.emit('release')
    const result = await landing
    expect(result.status).toBe('merged')
    expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('after\n')
    // Real git processes on a cold cache exceed the 5 s default on this rig class.
  }, 60_000)
})
