// The other-CI launcher's pure logic (action/lib/ci-adapters.mjs and the
// fact, key, input and deadline functions of action/lib/ci-run.mjs), driven
// through the real modules with plain environment data and real temp
// folders. End-to-end vendor runs are not simulated here: no fake agent, no
// local CI host (the owner's no-stand-ins rule); those behaviours wait for
// hosted receipts and are listed in docs/real-life/unproven.md.

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { azureBoolean, ciFacts, decideCi } from '../../action/lib/ci-adapters.mjs'
import {
  bootstrapStartMs,
  checkJobDeadline,
  jobMinutes,
  jobStartMs,
  parseCiInputs,
  privateTemp,
  requiredJobMinutes,
  requiredRunMs,
  takeCiKey,
} from '../../action/lib/ci-run.mjs'

const CI_KEY = `LLM_${'c'.repeat(28)}`
const isPosix = process.platform !== 'win32'

/** True when `text` holds the fabricated key in raw or URL-encoded form. */
function hasKey(text: string): boolean {
  return text.includes(CI_KEY) || text.includes(encodeURIComponent(CI_KEY))
}

/** A trusted branch run's facts, with any field replaced. */
function facts(overrides: Partial<CiFacts>): CiFacts {
  return {
    system: 'gitlab',
    workspace: '/w',
    runId: '1',
    attempt: '1',
    event: 'branch',
    label: 'branch main',
    number: null,
    isFork: false,
    isProtected: null,
    headSha: 'a'.repeat(40),
    base: { firstParent: true },
    title: '',
    body: '',
    ...overrides,
  }
}

describe('adapters: each system’s facts and trust', () => {
  it('reads Azure’s string booleans without case and refuses anything else', () => {
    for (const value of ['True', 'TRUE', 'true', 'tRuE'])
      expect(azureBoolean(value, 'x')).toBe(true)
    for (const value of ['False', 'FALSE', 'false']) expect(azureBoolean(value, 'x')).toBe(false)
    expect(azureBoolean('', 'x')).toBeUndefined()
    expect(() => azureBoolean('yes', 'x')).toThrow('x must be true or false')
  })

  it('names forks, pull requests and protection from each system’s own variables', () => {
    const head = 'a'.repeat(40)
    const base = 'b'.repeat(40)
    const gitlabFork = ciFacts('gitlab', {
      CI_PROJECT_DIR: '/w',
      CI_JOB_ID: '1',
      CI_PIPELINE_SOURCE: 'merge_request_event',
      CI_COMMIT_SHA: head,
      CI_MERGE_REQUEST_IID: '3',
      CI_PROJECT_ID: '10',
      CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '11',
      CI_MERGE_REQUEST_DIFF_BASE_SHA: base,
    })
    expect(gitlabFork).toMatchObject({ event: 'pull_request', isFork: true, isProtected: false })
    const gitlabPush = ciFacts('gitlab', {
      CI_PROJECT_DIR: '/w',
      CI_JOB_ID: '1',
      CI_PIPELINE_SOURCE: 'push',
      CI_COMMIT_SHA: head,
      CI_COMMIT_BEFORE_SHA: '0'.repeat(40),
      CI_COMMIT_REF_PROTECTED: 'true',
    })
    expect(gitlabPush).toMatchObject({
      event: 'branch',
      isProtected: true,
      base: { firstParent: true },
    })
    const azureFork = ciFacts('azure', {
      BUILD_SOURCESDIRECTORY: '/w',
      BUILD_BUILDID: '1',
      BUILD_REASON: 'PullRequest',
      BUILD_SOURCEVERSION: head,
      SYSTEM_PULLREQUEST_ISFORK: 'True',
      SYSTEM_PULLREQUEST_PULLREQUESTID: '4',
    })
    expect(azureFork).toMatchObject({ isFork: true, base: { mergeParent: true } })
    expect(() =>
      ciFacts('azure', {
        BUILD_SOURCESDIRECTORY: '/w',
        BUILD_BUILDID: '1',
        BUILD_REASON: 'PullRequest',
        BUILD_SOURCEVERSION: head,
        SYSTEM_PULLREQUEST_PULLREQUESTID: '4',
      }),
    ).toThrow('System.PullRequest.IsFork is missing')
    const jenkinsFork = ciFacts('jenkins', {
      WORKSPACE: '/w',
      BUILD_NUMBER: '1',
      GIT_COMMIT: head,
      CHANGE_ID: '5',
      CHANGE_FORK: 'someone/fork',
      CHANGE_TARGET: 'main',
    })
    expect(jenkinsFork).toMatchObject({ isFork: true, base: { ref: 'refs/remotes/origin/main' } })
    const bitbucketTag = ciFacts('bitbucket', {
      BITBUCKET_CLONE_DIR: '/w',
      BITBUCKET_BUILD_NUMBER: '1',
      BITBUCKET_COMMIT: head,
      BITBUCKET_TAG: 'v1',
    })
    expect(bitbucketTag.event).toBe('unsupported')
    expect(() => ciFacts('travis', {})).toThrow('the CI system is not one this launcher knows')
    expect(() =>
      ciFacts('jenkins', { WORKSPACE: '/w', BUILD_NUMBER: '1', GIT_COMMIT: 'not-a-sha' }),
    ).toThrow('GIT_COMMIT is missing or malformed')
  })

  it('refuses forks, untrusted pull requests, unprotected refs and images in review', () => {
    const trusted = { trustPullRequests: true, imageGeneration: false, mode: 'review' as const }
    expect(decideCi(facts({}), trusted)).toEqual({ allowed: true })
    expect(decideCi(facts({ isFork: true, event: 'pull_request' }), trusted)).toEqual({
      allowed: false,
      reason: 'the change comes from a fork',
    })
    expect(
      decideCi(facts({ event: 'pull_request' }), { ...trusted, trustPullRequests: false }),
    ).toMatchObject({
      allowed: false,
      reason: 'pull requests run only with trust-pull-requests set to true',
    })
    expect(decideCi(facts({ isProtected: false }), trusted)).toMatchObject({
      reason: 'the source branch is not protected',
    })
    expect(decideCi(facts({ event: 'unsupported' }), trusted)).toMatchObject({ allowed: false })
    expect(decideCi(facts({}), { ...trusted, imageGeneration: true })).toMatchObject({
      reason: 'image-generation needs fix mode',
    })
  })

  it('refuses Azure BatchedCI: the batch head alone cannot cover the batch', () => {
    const head = 'a'.repeat(40)
    const batched = ciFacts('azure', {
      BUILD_SOURCESDIRECTORY: '/w',
      BUILD_BUILDID: '1',
      BUILD_REASON: 'BatchedCI',
      BUILD_SOURCEVERSION: head,
      BUILD_SOURCEBRANCHNAME: 'main',
    })
    expect(batched.event).toBe('unsupported')
    expect(
      decideCi(batched, {
        trustPullRequests: true,
        imageGeneration: false,
        mode: 'review' as const,
      }),
    ).toEqual({ allowed: false, reason: 'this pipeline event cannot start a run' })
  })
})

describe('key intake, inputs and the job deadline', () => {
  it('takes the key out under every name that carries it', () => {
    const env: Record<string, string | undefined> = {
      MUSE_SPARK_MODEL_API_KEY: `${CI_KEY}\n`,
      MUSE_MODEL_API_KEY: CI_KEY,
      RENAMED_BINDING: CI_KEY,
      HEADER_WITH_IT: `Bearer ${CI_KEY}`,
      PATH: '/usr/bin',
    }
    expect(takeCiKey(env)).toBe(CI_KEY)
    expect(env).toEqual({ PATH: '/usr/bin' })
    const unmapped: Record<string, string | undefined> = {
      MUSE_MODEL_API_KEY: CI_KEY,
      COPY: CI_KEY,
    }
    expect(takeCiKey(unmapped)).toBe(CI_KEY)
    expect(unmapped).toEqual({})
    const oversize: Record<string, string | undefined> = {
      MUSE_MODEL_API_KEY: `LLM_${'a'.repeat(5000)}`,
    }
    expect(takeCiKey(oversize)).toBeUndefined()
    expect(oversize).toEqual({})
  })

  it('R4-P1-2: a declared alias is a key source; conflicting names refuse and all values are scrubbed', () => {
    const alias = {
      MUSE_CI_KEY_ALIASES: 'RENAMED_BINDING',
      RENAMED_BINDING: CI_KEY,
      COPY: `Bearer ${CI_KEY}`,
    }
    expect(takeCiKey(alias)).toBe(CI_KEY)
    expect(alias).toEqual({ MUSE_CI_KEY_ALIASES: 'RENAMED_BINDING' })
    const conflict = {
      MUSE_MODEL_API_KEY: CI_KEY,
      META_API_KEY: `LLM_${'d'.repeat(28)}`,
      COPY: CI_KEY,
    }
    expect(takeCiKey(conflict)).toBeUndefined()
    expect(conflict).toEqual({})
  })

  it('R6-P2-1: Azure reserves ten minutes before measured bootstrap, regardless of vendor timezone', () => {
    const now = Date.parse('2026-10-10T14:20:00Z')
    const setupMs = 10 * 60_000
    for (const vendorTime of ['2026-10-10T16:04:00Z', '2026-10-10T09:04:00-05:00', 'invalid']) {
      const env = {
        MUSE_CI_JOB_TIMEOUT_MINUTES: '35',
        MUSE_CI_BOOTSTRAP_START_MS: String(now),
        MUSE_CI_PIPELINE_STARTED_AT: vendorTime,
      }
      expect(jobStartMs(env, 'azure', now)).toBe(now - setupMs)
      expect(() => {
        checkJobDeadline(env, 'azure', { timeoutMinutes: 20 }, now)
      }).toThrow('only 25 of 35 remain')
      expect(() => {
        checkJobDeadline(
          { ...env, MUSE_CI_JOB_TIMEOUT_MINUTES: '45' },
          'azure',
          { timeoutMinutes: 20 },
          now,
        )
      }).not.toThrow()
      expect(() => {
        checkJobDeadline(
          {
            ...env,
            MUSE_CI_JOB_TIMEOUT_MINUTES: '45',
            MUSE_CI_BOOTSTRAP_START_MS: String(now - 6 * 60_000),
          },
          'azure',
          { timeoutMinutes: 20 },
          now,
        )
      }).toThrow('only 29 of 45 remain')
    }
    expect(() =>
      jobStartMs({ MUSE_CI_BOOTSTRAP_START_MS: String(now + 60_000) }, 'azure', now),
    ).toThrow('a measured job or bootstrap start is required')
    expect(() => jobStartMs({ MUSE_CI_JOB_START_MS: String(now) }, 'azure', now)).toThrow(
      'MUSE_CI_BOOTSTRAP_START_MS',
    )
    expect(
      jobStartMs(
        {
          MUSE_CI_BOOTSTRAP_START_MS: String(now),
          MUSE_CI_JOB_START_MS: String(now - 16 * 60_000),
        },
        'azure',
        now,
      ),
    ).toBe(now - 16 * 60_000)
    expect(
      jobStartMs({ MUSE_CI_BOOTSTRAP_START_MS: String(now - 7 * 60_000) }, 'bitbucket', now),
    ).toBe(now - 7 * 60_000)
  })

  it('R6-P2-2: Node refuses aliases in the bootstrap ownership namespace and scrubs their values', () => {
    for (const name of [
      'muse_ci_internal_dir',
      'muse_ci_internal_rm_dir',
      'muse_ci_internal_alias',
      'MUSE_CI_TEMP',
      'MUSE_CI_BOOTSTRAP_START_MS',
      'MUSE_INPUT_AGENT_PACKAGE',
      'MUSE_AGENT_VERSION',
    ]) {
      const env = {
        MUSE_MODEL_API_KEY: CI_KEY,
        MUSE_CI_KEY_ALIASES: name,
        [name]: CI_KEY,
        COPY: `Bearer ${CI_KEY}`,
      }
      expect(takeCiKey(env), name).toBeUndefined()
      expect(
        Object.values(env).some((value) => hasKey(value)),
        name,
      ).toBe(false)
    }
  })

  it('uses the Action’s grammar, refuses GitHub-only inputs and reads Azure booleans', () => {
    const base = {
      MUSE_INPUT_MAX_BUDGET_USD: '1.50',
      MUSE_INPUT_AGENT_PACKAGE: '/tmp/agent.tgz',
      MUSE_INPUT_AGENT_PACKAGE_SHA256: 'f'.repeat(64),
    }
    expect(parseCiInputs(base, 'gitlab')).toMatchObject({
      mode: 'review',
      trustPullRequests: false,
    })
    expect(() => parseCiInputs({ ...base, MUSE_INPUT_POST_COMMENT: 'true' }, 'gitlab')).toThrow(
      'MUSE_INPUT_POST_COMMENT is a GitHub Action input',
    )
    expect(() =>
      parseCiInputs({ ...base, MUSE_INPUT_TRUST_PULL_REQUESTS: 'True' }, 'gitlab'),
    ).toThrow('MUSE_INPUT_TRUST_PULL_REQUESTS must be true or false')
    expect(
      parseCiInputs(
        { ...base, MUSE_INPUT_TRUST_PULL_REQUESTS: 'True', MUSE_INPUT_IMAGE_GENERATION: 'FALSE' },
        'azure',
      ),
    ).toMatchObject({ trustPullRequests: true, imageGeneration: false })
    expect(() => parseCiInputs({ MUSE_INPUT_MAX_BUDGET_USD: '1' }, 'jenkins')).toThrow(
      'agent-package and agent-package-sha256 are required',
    )
    expect(() => parseCiInputs({ ...base, MUSE_INPUT_MAX_BUDGET_USD: '' }, 'bitbucket')).toThrow(
      'max-budget-usd must be a plain decimal number of USD',
    )
  })

  it('admits on the time remaining, not the configured duration (P1 finding 5)', () => {
    const now = Date.now()
    const fresh = {
      CI_JOB_TIMEOUT: '2100',
      CI_JOB_STARTED_AT: new Date(now).toISOString(),
    }
    expect(jobStartMs(fresh, 'gitlab', now)).toBe(now)
    expect(() => {
      checkJobDeadline(fresh, 'gitlab', { timeoutMinutes: 20 }, now)
    }).not.toThrow()
    // The review's scenario: a 35-minute job whose checkout took 16 minutes
    // cannot cover a 20-minute turn, although the configured 35 minutes could.
    const spent = {
      CI_JOB_TIMEOUT: '2100',
      CI_JOB_STARTED_AT: new Date(now - 16 * 60_000).toISOString(),
    }
    expect(() => {
      checkJobDeadline(spent, 'gitlab', { timeoutMinutes: 20 }, now)
    }).toThrow('timeout-minutes 20 needs a job timeout of at least')
    // Jenkins measures from the template's vendor start time.
    expect(jobStartMs({ MUSE_CI_JOB_START_MS: String(now - 60_000) }, 'jenkins', now)).toBe(
      now - 60_000,
    )
    // Fallback measures from bootstrap; vendor timestamps can only make admission more conservative.
    const bootstrap = {
      MUSE_CI_BOOTSTRAP_START_MS: String(now),
      MUSE_CI_JOB_TIMEOUT_MINUTES: '35',
    }
    expect(jobStartMs(bootstrap, 'azure', now)).toBe(now - 10 * 60_000)
    expect(() => {
      checkJobDeadline(bootstrap, 'bitbucket', { timeoutMinutes: 20 }, now)
    }).not.toThrow()
    expect(() => {
      checkJobDeadline(
        { ...bootstrap, MUSE_CI_BOOTSTRAP_START_MS: String(now - 16 * 60_000) },
        'bitbucket',
        { timeoutMinutes: 20 },
        now,
      )
    }).toThrow('needs a job timeout of at least')
    // A malformed vendor start falls back to the bootstrap; a missing
    // bootstrap refuses instead of admitting blind.
    expect(jobStartMs({ ...bootstrap, CI_JOB_STARTED_AT: 'not-a-date' }, 'gitlab', now)).toBe(now)
    expect(() => bootstrapStartMs({})).toThrow('MUSE_CI_BOOTSTRAP_START_MS')
    expect(requiredJobMinutes({ timeoutMinutes: 20 })).toBeLessThanOrEqual(35)
    expect(requiredRunMs({ timeoutMinutes: 20 })).toBeLessThan(35 * 60_000)
    expect(jobMinutes({ CI_JOB_TIMEOUT: '2100' }, 'gitlab')).toBe(35)
    expect(jobMinutes({ MUSE_CI_JOB_TIMEOUT_MINUTES: '35' }, 'azure')).toBe(35)
    expect(() => jobMinutes({}, 'jenkins')).toThrow('MUSE_CI_JOB_TIMEOUT_MINUTES')
    for (const minutes of [30, 120, 360]) {
      expect(() => {
        checkJobDeadline(
          {
            MUSE_CI_JOB_TIMEOUT_MINUTES: '35',
            MUSE_CI_BOOTSTRAP_START_MS: String(Date.now()),
          },
          'bitbucket',
          {
            timeoutMinutes: minutes,
          },
        )
      }).toThrow(`timeout-minutes ${String(minutes)} needs a job timeout of at least`)
    }
  })

  it.runIf(isPosix)('accepts only a private temp folder outside the workspace', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ci-run-'))
    try {
      const ws = path.join(root, 'ws')
      mkdirSync(ws)
      const own = mkdtempSync(path.join(root, 'ci-'))
      expect(privateTemp(own, ws, process.platform)).toBe(own)
      expect(() => privateTemp('relative', ws, process.platform)).toThrow('absolute')
      expect(() => privateTemp(ws, ws, process.platform)).toThrow('outside the workspace')
      expect(() => privateTemp(root, ws, process.platform)).toThrow(
        'must not contain the workspace',
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
