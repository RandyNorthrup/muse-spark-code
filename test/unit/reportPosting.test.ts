import { afterEach, describe, expect, it, vi } from 'vitest'
import { postReport, type ReportPostingDeps } from '../../src/core/reporting/sources/github'
import { REPORT_SOURCE_TIMEOUT_MS, UI_TEXT } from '../../src/shared/constants'
import { networkContext, networkRig } from './helpers/reportNetwork'

const target = { repository: 'fixture/repo', number: 12, kind: 'issue-comment' } as const
const input = {
  kind: 'project',
  target,
  body: '# Full report\n\n| Source | State |\n| Git | ok |',
} as const
function postingRig(): ReportPostingDeps {
  const { deps } = networkRig()
  return {
    policy: deps.policy,
    scrub: deps.scrub,
    enabled: vi.fn(() => Promise.resolve(true)),
    previewed: vi.fn(() => Promise.resolve(true)),
    rememberPreview: vi.fn(() => Promise.resolve()),
    confirm: vi.fn(() => Promise.resolve('post' as const)),
    send: vi.fn(() =>
      Promise.resolve({ url: 'https://github.com/fixture/repo/issues/12#issuecomment-1' }),
    ),
  }
}
afterEach(() => {
  vi.useRealTimers()
})

describe('report posting', () => {
  it.each([-1, 0, 0.5])('refuses invalid issue numbers %s', async (number) => {
    const deps = postingRig()
    await expect(
      postReport(deps, networkContext(), { ...input, target: { ...target, number } }),
    ).rejects.toThrow()
    expect(deps.send).not.toHaveBeenCalled()
  })
  it('refuses a setting revoked during egress admission', async () => {
    const base = postingRig()
    let isEnabled = true
    const deps = {
      ...base,
      enabled: vi.fn(() => Promise.resolve(isEnabled)),
      policy: {
        ...base.policy,
        allowEgress: vi.fn(() => {
          isEnabled = false
          return Promise.resolve(true)
        }),
      },
    }
    expect(await postReport(deps, networkContext(), input)).toMatchObject({ status: 'refused' })
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('refuses a schedule with a different action at its runtime boundary', async () => {
    const deps = postingRig()
    expect(
      await postReport(deps, networkContext(), input, {
        action: 'prompt',
        kind: 'project',
        target,
      }),
    ).toMatchObject({ status: 'refused' })
    expect(deps.send).not.toHaveBeenCalled()
  })
  it('previews the full scrubbed body and automated note before a manual post', async () => {
    const deps = postingRig()
    const result = await postReport(deps, networkContext(), input)
    expect(result.status).toBe('posted')
    expect(deps.confirm).toHaveBeenCalledWith(
      { ...input, body: `${input.body}\n\n${UI_TEXT.reportUi.automatedNote}\n` },
      expect.any(AbortSignal),
    )
    expect(deps.send).toHaveBeenCalledWith(
      expect.objectContaining({
        ...input,
        method: 'comment',
        body: `${input.body}\n\n${UI_TEXT.reportUi.automatedNote}\n`,
      }),
    )
    expect(deps.rememberPreview).toHaveBeenCalledWith('project', target)
  })

  it('refuses a denied preview', async () => {
    const deps = { ...postingRig(), confirm: vi.fn(() => Promise.resolve('cancel' as const)) }
    const observed21 = await postReport(deps, networkContext(), input)
    expect(observed21.status).toBe('refused')
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('requires opt-in for the exact kind and target', async () => {
    const deps = {
      ...postingRig(),
      enabled: vi.fn<ReportPostingDeps['enabled']>((kind, candidate) =>
        Promise.resolve(kind === 'release' && candidate.number === 13),
      ),
    }
    const observed22 = await postReport(deps, networkContext(), input)
    expect(observed22.status).toBe('refused')
    expect(deps.enabled).toHaveBeenCalledWith('project', target)
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('honors a revoked opt-in after preview', async () => {
    const deps = {
      ...postingRig(),
      enabled: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    }
    const observed23 = await postReport(deps, networkContext(), input)
    expect(observed23.status).toBe('refused')
    expect(deps.send).not.toHaveBeenCalled()
  })

  it.each(['off', 'no-login', 'terminal-no-flag', 'egress-denied'])(
    'refuses policy %s',
    async (reason) => {
      const base = postingRig()
      const policy = {
        ...base.policy,
        mode: reason === 'off' ? ('off' as const) : ('always' as const),
        surface: reason === 'terminal-no-flag' ? ('terminal' as const) : ('editor' as const),
        githubSignedIn: reason !== 'no-login',
        allowEgress: vi.fn(() => Promise.resolve(reason !== 'egress-denied')),
      }
      const deps = { ...base, policy }
      const observed24 = await postReport(deps, networkContext(false), input)
      expect(observed24.status).toBe('refused')
      expect(deps.send).not.toHaveBeenCalled()
    },
  )

  it('edits the same pinned issue in place on every invocation', async () => {
    const deps = postingRig()
    const pinned = { ...input, target: { ...target, kind: 'pinned-status-issue' as const } }
    await postReport(deps, networkContext(), pinned)
    await postReport(deps, networkContext(), pinned)
    expect(deps.send).toHaveBeenCalledTimes(2)
    expect(deps.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'updateIssue', target: pinned.target }),
    )
  })

  it('posts a PR comment to the chosen PR', async () => {
    const deps = {
      ...postingRig(),
      send: vi.fn(() =>
        Promise.resolve({ url: 'https://github.com/fixture/repo/pull/12#issuecomment-1' }),
      ),
    }
    const observed25 = await postReport(deps, networkContext(), {
      ...input,
      target: { ...target, kind: 'pull-request-comment' },
    })
    expect(observed25.status).toBe('posted')
  })

  it('requires the schedule grant to name the same kind and exact target', async () => {
    const deps = postingRig()
    const grants = [
      { action: 'post-report' as const, kind: 'release' as const, target },
      {
        action: 'post-report' as const,
        kind: 'project' as const,
        target: { ...target, number: 13 },
      },
      {
        action: 'post-report' as const,
        kind: 'project' as const,
        target: { ...target, repository: 'other/repo' },
      },
      {
        action: 'post-report' as const,
        kind: 'project' as const,
        target: { ...target, kind: 'pinned-status-issue' as const },
      },
    ]
    for (const grant of grants) {
      const observed26 = await postReport(deps, networkContext(), input, grant)
      expect(observed26.status).toBe('refused')
    }
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('requires first full preview approval before any unattended post', async () => {
    const deps = { ...postingRig(), previewed: vi.fn(() => Promise.resolve(false)) }
    const observed27 = await postReport(deps, networkContext(), input, {
      action: 'post-report',
      kind: 'project',
      target,
    })
    expect(observed27.status).toBe('refused')
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('uses an exact previously previewed scheduled grant without a new manual prompt', async () => {
    const deps = postingRig()
    const observed28 = await postReport(deps, networkContext(), input, {
      action: 'post-report',
      kind: 'project',
      target,
    })
    expect(observed28.status).toBe('posted')
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.send).toHaveBeenCalledOnce()
  })

  it('scrubs planted source credentials from preview and dispatched body', async () => {
    const deps = postingRig()
    const secret = `ghp_${'c'.repeat(36)}`
    await postReport(deps, networkContext(), { ...input, body: `# Pull title ${secret}` })
    expect(JSON.stringify(vi.mocked(deps.confirm).mock.calls)).not.toContain(secret)
    expect(JSON.stringify(vi.mocked(deps.send).mock.calls)).not.toContain(secret)
  })

  it('refuses a changed scrub result after approval', async () => {
    let hasChanged = false
    const base = postingRig()
    const deps = {
      ...base,
      scrub: (value: string) => (hasChanged ? value.replace('Full', 'Changed') : value),
      confirm: vi.fn(() => {
        hasChanged = true
        return Promise.resolve('post' as const)
      }),
    }
    const observed29 = await postReport(deps, networkContext(), input)
    expect(observed29.status).toBe('refused')
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('does not let the preview callback alter the approved outgoing body', async () => {
    const deps = {
      ...postingRig(),
      confirm: vi.fn((preview) => {
        Object.assign(preview, { body: 'hasChanged' })
        return Promise.resolve('post' as const)
      }),
    }
    await postReport(deps, networkContext(), input)
    expect(deps.send).toHaveBeenCalledWith(
      expect.objectContaining({ body: `${input.body}\n\n${UI_TEXT.reportUi.automatedNote}\n` }),
    )
  })

  it('retains uncertainty and never retries a dispatched request that times out', async () => {
    vi.useFakeTimers()
    const deps = { ...postingRig(), send: vi.fn(() => new Promise<unknown>(() => undefined)) }
    const pending = postReport(deps, networkContext(), input)
    await vi.advanceTimersByTimeAsync(REPORT_SOURCE_TIMEOUT_MS)
    const observed30 = await pending
    expect(observed30.status).toBe('uncertain')
    expect(deps.send).toHaveBeenCalledOnce()
    expect(deps.rememberPreview).not.toHaveBeenCalled()
  })

  it('does not show errors or foreign receipt URLs after uncertain dispatch', async () => {
    const secret = `ghp_${'d'.repeat(36)}`
    const bad = {
      ...postingRig(),
      send: vi.fn(() => Promise.resolve({ url: `https://example.invalid/${secret}` })),
    }
    expect(await postReport(bad, networkContext(), input)).toEqual({
      status: 'uncertain',
      reason: UI_TEXT.reportUi.generationFailed,
    })
    expect(bad.rememberPreview).not.toHaveBeenCalled()
    const failed = { ...postingRig(), send: vi.fn(() => Promise.reject(new Error(secret))) }
    expect(JSON.stringify(await postReport(failed, networkContext(), input))).not.toContain(secret)
  })

  it.each([
    'https://example.invalid/fixture/repo/issues/12',
    'https://github.com/fixture/repo/issues/13',
    'https://github.com/fixture/repo/issues/12?tracking=1',
  ])('refuses a foreign posting receipt %s', async (url) => {
    const deps = { ...postingRig(), send: vi.fn(() => Promise.resolve({ url })) }
    expect(await postReport(deps, networkContext(), input)).toMatchObject({ status: 'uncertain' })
    expect(deps.rememberPreview).not.toHaveBeenCalled()
  })

  it('validates target boundaries before checking policy or dispatch', async () => {
    const deps = postingRig()
    await expect(
      postReport(deps, networkContext(), {
        ...input,
        target: { ...target, repository: 'fixture/repo/../../other' },
      }),
    ).rejects.toThrow()
    expect(deps.send).not.toHaveBeenCalled()
  })
})
