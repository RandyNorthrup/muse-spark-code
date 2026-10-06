import { describe, expect, it } from 'vitest'
import {
  type HeadFacts,
  isPlainRefName,
  isPlainRefspec,
  planPush,
  type RemoteFacts,
} from '../../src/core/git/pushPlan'

const ORIGIN: RemoteFacts = {
  name: 'origin',
  fetchUrl: 'https://github.com/o/r.git',
  pushUrl: undefined,
}
const FORK: RemoteFacts = {
  name: 'fork',
  fetchUrl: 'https://github.com/me/r.git',
  pushUrl: 'git@github.com:me/r.git',
}

function head(fields: Partial<HeadFacts>): HeadFacts {
  return { branch: 'feature', upstream: undefined, ahead: undefined, behind: undefined, ...fields }
}

describe('planPush (M71): never a force', () => {
  it('pushes a tracking branch to its upstream, fast-forward only', () => {
    expect(
      planPush(head({ upstream: { remote: 'origin', name: 'feature' }, ahead: 2, behind: 0 }), [
        ORIGIN,
      ]),
    ).toEqual({
      ok: true,
      remote: 'origin',
      remoteUrl: 'https://github.com/o/r.git',
      branch: 'feature',
      target: 'feature',
      refspec: 'feature',
      setUpstream: false,
      commits: 2,
    })
  })

  it('names the upstream branch when it differs, as VS Code does', () => {
    const plan = planPush(
      head({ upstream: { remote: 'fork', name: 'topic/x' }, ahead: 1, behind: 0 }),
      [ORIGIN, FORK],
    )
    expect(plan).toMatchObject({
      ok: true,
      remote: 'fork',
      refspec: 'feature:topic/x',
      remoteUrl: 'git@github.com:me/r.git',
    })
  })

  it('refuses a branch behind its upstream instead of pushing over it', () => {
    expect(
      planPush(head({ upstream: { remote: 'origin', name: 'feature' }, ahead: 1, behind: 3 }), [
        ORIGIN,
      ]),
    ).toEqual({ ok: false, refusal: 'behind' })
    // Behind with nothing of its own is still behind, never "up to date".
    expect(
      planPush(head({ upstream: { remote: 'origin', name: 'feature' }, ahead: 0, behind: 1 }), [
        ORIGIN,
      ]),
    ).toEqual({ ok: false, refusal: 'behind' })
  })

  it.each(['+feature', '-f', 'a:b', 'has space', ''])(
    'refuses the branch name %j, which would not mean only itself',
    (branch) => {
      expect(planPush(head({ branch }), [ORIGIN])).toEqual({ ok: false, refusal: 'unsafeName' })
    },
  )

  it('refuses an upstream name that would force', () => {
    expect(
      planPush(head({ upstream: { remote: 'origin', name: '+main' }, ahead: 1, behind: 0 }), [
        ORIGIN,
      ]),
    ).toEqual({ ok: false, refusal: 'unsafeName' })
  })

  it('refuses a remote whose name would read as an option, tracked or first', () => {
    expect(
      planPush(head({ upstream: { remote: '--force', name: 'feature' }, ahead: 1, behind: 0 }), [
        { name: '--force', fetchUrl: 'https://github.com/o/r.git' },
      ]),
    ).toEqual({ ok: false, refusal: 'unsafeName' })
    expect(planPush(head({}), [{ name: '-f', fetchUrl: 'https://github.com/o/r.git' }])).toEqual({
      ok: false,
      refusal: 'unsafeName',
    })
  })

  it('refuses a detached HEAD and says when there is nothing to push', () => {
    expect(planPush(head({ branch: undefined }), [ORIGIN])).toEqual({
      ok: false,
      refusal: 'detached',
    })
    expect(
      planPush(head({ upstream: { remote: 'origin', name: 'feature' }, ahead: 0, behind: 0 }), [
        ORIGIN,
      ]),
    ).toEqual({ ok: false, refusal: 'upToDate' })
  })

  it('makes a first push to the only remote, origin, or the one chosen, with -u', () => {
    expect(planPush(head({}), [FORK])).toMatchObject({
      ok: true,
      remote: 'fork',
      refspec: 'feature',
      setUpstream: true,
      commits: undefined,
    })
    expect(planPush(head({}), [FORK, ORIGIN])).toMatchObject({ ok: true, remote: 'origin' })
    expect(planPush(head({}), [ORIGIN, FORK], 'fork')).toMatchObject({ ok: true, remote: 'fork' })
  })

  it('asks which remote when it cannot tell, and says when there is none', () => {
    const upstreamless = { ...FORK, name: 'upstream' }
    expect(planPush(head({}), [FORK, upstreamless])).toEqual({
      ok: false,
      refusal: 'chooseRemote',
      remotes: ['fork', 'upstream'],
    })
    expect(planPush(head({}), [])).toEqual({ ok: false, refusal: 'noRemote', remotes: [] })
    expect(planPush(head({}), [ORIGIN], 'gone')).toEqual({
      ok: false,
      refusal: 'noRemote',
      remotes: ['origin'],
    })
  })
})

describe('refspec checks (M71)', () => {
  it('accepts plain names and one mapping', () => {
    expect(isPlainRefspec('feature')).toBe(true)
    expect(isPlainRefspec('feature:topic/x')).toBe(true)
    expect(isPlainRefName('feature/login-2')).toBe(true)
  })

  it.each(['+feature', 'feature:+main', '+a:b', 'a:b:c', ':main', 'a:', '-u'])(
    'rejects %j',
    (refspec) => {
      expect(isPlainRefspec(refspec)).toBe(false)
    },
  )
})
