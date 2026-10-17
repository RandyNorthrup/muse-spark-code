// M80 lane C: the Action's gate (SPEC §6.6, G1–G10, G15, G16). The pure
// decision runs over event payloads assembled from the real GitHub objects
// captured in test/action/captures.json; gate-cli runs against a stub API.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { decide, eventPrNumber, GATE_TASK_MAX_CHARS } from '../../action/lib/gate.mjs'
import { runGate } from '../../action/lib/gate-cli.mjs'
import { parseActionInputs } from '../../action/lib/tools.mjs'
import captures from '../action/captures.json'
import {
  allocate,
  jsonFetch,
  jsonRecord,
  readOutputs,
  tempLayout,
  TEST_TOKEN,
  testOwner,
  type TempLayout,
} from './helpers/actionFixtures'

const REPO = captures.repository.full_name
const HEAD = captures.pull.head.sha
const BASE = captures.pull.base.sha
const USER = captures.pull.user
const FORK = 'someone/muse-spark-code'

function apiPull(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...captures.pull, state: 'open', body: 'Body text', ...overrides }
}

function prEvent(overrides: Record<string, unknown> = {}, pull: Record<string, unknown> = {}) {
  return {
    action: 'synchronize',
    sender: USER,
    repository: captures.repository,
    pull_request: {
      number: captures.pull.number,
      author_association: 'OWNER',
      head: { sha: HEAD, ref: captures.pull.head.ref, repo: { full_name: REPO } },
      ...pull,
    },
    ...overrides,
  }
}

function commentEvent(
  comment: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  return {
    action: 'created',
    sender: USER,
    repository: captures.repository,
    issue: captures.issueOnPull,
    comment: { author_association: 'COLLABORATOR', body: '@muse-spark check the docs', ...comment },
    ...overrides,
  }
}

type GateInput = Parameters<typeof decide>[0]

function gate(input: Partial<GateInput>): ReturnType<typeof decide> {
  return decide({
    eventName: 'pull_request',
    event: prEvent(),
    pr: apiPull(),
    repository: REPO,
    isPublic: true,
    runnerEnvironment: 'github-hosted',
    mode: 'review',
    imageGeneration: false,
    triggerPhrase: '@muse-spark',
    dispatchPrNumber: null,
    ...input,
  })
}

function reason(input: Partial<GateInput>): string {
  const decision = gate(input)
  return decision.allowed ? 'allowed' : decision.reason
}

describe('the gate decision (pure)', () => {
  it('G1 allows a same-repository OWNER pull request whose API view agrees', () => {
    expect(gate({})).toEqual({
      allowed: true,
      prNumber: captures.pull.number,
      headSha: HEAD,
      baseSha: BASE,
      headRef: captures.pull.head.ref,
      task: '',
      title: captures.pull.title,
      body: 'Body text',
      warning: null,
    })
    for (const action of ['opened', 'reopened', 'ready_for_review']) {
      expect(gate({ event: prEvent({ action }) }).allowed, action).toBe(true)
    }
    expect(reason({ event: prEvent({ action: 'closed' }) })).toMatch(/action/)
    expect(reason({ pr: apiPull({ state: 'closed' }) })).toMatch(/not open/)
  })

  it('G2 refuses a fork pull request by its event and by its API head', () => {
    const forkHead = { sha: HEAD, ref: 'main', repo: { full_name: FORK } }
    expect(reason({ event: prEvent({}, { head: forkHead }) })).toMatch(/another repository/)
    expect(reason({ pr: apiPull({ head: forkHead }) })).toMatch(/another repository/)
  })

  it('G3 refuses pull_request_target and every event outside the allow-list', () => {
    expect(reason({ eventName: 'pull_request_target' })).toBe('pull_request_target is refused')
    expect(reason({ eventName: 'push' })).toMatch(/cannot start/)
  })

  it('G4 refuses comments from contributors, outsiders and first-timers', () => {
    for (const association of ['CONTRIBUTOR', 'NONE', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER']) {
      const event = commentEvent({ author_association: association })
      expect(reason({ eventName: 'issue_comment', event }), association).toMatch(/commenter/)
    }
    expect(reason({ event: prEvent({}, { author_association: 'CONTRIBUTOR' }) })).toMatch(/author/)
  })

  it('G5 refuses a member comment on a fork pull request (API head)', () => {
    const event = commentEvent({ author_association: 'MEMBER' })
    const pr = apiPull({ head: { sha: HEAD, ref: 'main', repo: { full_name: FORK } } })
    expect(reason({ eventName: 'issue_comment', event, pr })).toMatch(/another repository/)
    expect(reason({ eventName: 'issue_comment', event, pr: { ...apiPull(), head: null } })).toMatch(
      /head is not available/,
    )
  })

  it('G6 refuses a comment on a plain issue and names no pull request', () => {
    const event = commentEvent({}, { issue: captures.plainIssue })
    expect(eventPrNumber('issue_comment', event, null)).toBeNull()
    expect(reason({ eventName: 'issue_comment', event })).toMatch(/not on a pull request/)
  })

  it('G7 refuses a public repository on a self-hosted runner and warns for a private one', () => {
    expect(reason({ runnerEnvironment: 'self-hosted' })).toMatch(/GitHub-hosted/)
    const decision = gate({ runnerEnvironment: 'self-hosted', isPublic: false })
    expect(decision.allowed && decision.warning).toMatch(/self-hosted/)
  })

  it('G8 refuses a bot sender, by type or by login', () => {
    expect(reason({ event: prEvent({ sender: captures.botComment.user }) })).toMatch(/bot/)
    const login = { login: 'helper[bot]', type: 'User' }
    expect(reason({ event: prEvent({ sender: login }) })).toMatch(/bot/)
  })

  it('G9 allows a dispatch only for a positive integer, open, same-repository pull request', () => {
    const dispatch = { eventName: 'workflow_dispatch', event: { sender: USER } }
    expect(gate({ ...dispatch, dispatchPrNumber: captures.pull.number }).allowed).toBe(true)
    expect(reason({ ...dispatch })).toMatch(/pr-number/)
    expect(reason({ ...dispatch, dispatchPrNumber: 5 })).toMatch(/number does not match/)
    const fork = apiPull({ head: { sha: HEAD, ref: 'x', repo: { full_name: FORK } } })
    expect(reason({ ...dispatch, dispatchPrNumber: captures.pull.number, pr: fork })).toMatch(
      /another repository/,
    )
    for (const value of ['0', '-1', '1.5', 'abc', '1e3']) {
      expect(() =>
        parseActionInputs({ MUSE_INPUT_MAX_BUDGET_USD: '1', MUSE_INPUT_PR_NUMBER: value }),
      ).toThrow(/pr-number/)
    }
  })

  it('G10 refuses a comment without the trigger, an edited comment and a review-comment edit', () => {
    const missing = commentEvent({ body: 'please review @muse-spark' })
    expect(reason({ eventName: 'issue_comment', event: missing })).toMatch(/trigger/)
    const edited = commentEvent({}, { action: 'edited' })
    expect(reason({ eventName: 'issue_comment', event: edited })).toMatch(/newly created/)
    const review = { ...prEvent({ action: 'edited' }), comment: commentEvent().comment }
    expect(reason({ eventName: 'pull_request_review_comment', event: review })).toMatch(
      /newly created/,
    )
  })

  it('takes the task after the trigger and bounds it at 4,000 characters', () => {
    const event = (body: string) => commentEvent({ body })
    const allowed = gate({ eventName: 'issue_comment', event: event('@muse-spark  fix the typo ') })
    expect(allowed.allowed && allowed.task).toBe('fix the typo')
    const longest = `@muse-spark ${'x'.repeat(GATE_TASK_MAX_CHARS)}`
    expect(gate({ eventName: 'issue_comment', event: event(longest) }).allowed).toBe(true)
    expect(reason({ eventName: 'issue_comment', event: event(`${longest}y`) })).toMatch(/4,000/)
    const review = { ...prEvent({ action: 'created' }), comment: commentEvent().comment }
    expect(gate({ eventName: 'pull_request_review_comment', event: review }).allowed).toBe(true)
  })

  it('G15 refuses when the event head differs from the API head', () => {
    const pr = apiPull({ head: { ...captures.pull.head, sha: BASE } })
    expect(reason({ pr })).toMatch(/event head differs/)
  })

  it('G16 refuses image generation in review mode', () => {
    expect(reason({ imageGeneration: true })).toMatch(/fix mode/)
    expect(gate({ imageGeneration: true, mode: 'fix' }).allowed).toBe(true)
  })

  it('refuses malformed API heads, bases, refs and repository names', () => {
    expect(reason({ pr: apiPull({ head: { ...captures.pull.head, sha: 'HEAD' } }) })).toMatch(
      /malformed/,
    )
    expect(reason({ pr: apiPull({ head: { ...captures.pull.head, ref: '-x' } }) })).toMatch(
      /malformed/,
    )
    expect(reason({ pr: apiPull({ head: { ...captures.pull.head, ref: 'a..b' } }) })).toMatch(
      /malformed/,
    )
    expect(reason({ repository: 'not a repo' })).toMatch(/repository name/)
    expect(reason({ event: null })).toMatch(/event is missing/)
  })
})

describe('gate-cli under its owner', () => {
  let layout: TempLayout
  afterEach(() => {
    layout.cleanup()
  })

  function gateEnv(eventName: string, event: unknown): Record<string, string> {
    layout = tempLayout()
    const paths = allocate(layout)
    const eventPath = path.join(layout.root, 'event.json')
    writeFileSync(eventPath, JSON.stringify(event))
    return {
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: REPO,
      GITHUB_API_URL: 'https://api.example.test',
      RUNNER_ENVIRONMENT: 'github-hosted',
      RUNNER_TEMP: layout.runnerTemp,
      MUSE_INVOCATION: paths.invocation,
      MUSE_GITHUB_TOKEN: TEST_TOKEN,
      GITHUB_OUTPUT: path.join(layout.root, 'outputs.txt'),
    }
  }

  it('reads the pull request once with the token and writes the private decision', async () => {
    const env = gateEnv('pull_request', prEvent())
    const fetchStub = jsonFetch(apiPull())
    const { owner } = testOwner({})
    const decision = await runGate({ env, fetch: fetchStub, owner })
    expect(decision.allowed).toBe(true)
    expect(fetchStub.calls).toHaveLength(1)
    expect(fetchStub.calls[0]?.url).toBe(`https://api.example.test/repos/${REPO}/pulls/72`)
    expect(fetchStub.calls[0]?.init?.redirect).toBe('error')
    expect(JSON.stringify(fetchStub.calls[0]?.init?.headers)).toContain(`Bearer ${TEST_TOKEN}`)
    const outputs = readOutputs(env['GITHUB_OUTPUT'] ?? '')
    expect(outputs).toMatchObject({ allowed: 'true', 'pr-number': '72', 'head-sha': HEAD })
    const stored = jsonRecord(readFileSync(outputs['task-file'] ?? '', 'utf8'))
    expect(stored).toMatchObject({ headSha: HEAD, baseSha: BASE, title: captures.pull.title })
    await owner.cleanup()
  })

  it('G2/G3 refuse before any API read and write allowed=false', async () => {
    for (const [name, event] of [
      ['pull_request_target', prEvent()],
      ['issue_comment', commentEvent({}, { issue: captures.plainIssue })],
    ] as const) {
      const env = gateEnv(name, event)
      const fetchStub = jsonFetch()
      const { owner } = testOwner({})
      const decision = await runGate({ env, fetch: fetchStub, owner })
      expect(decision.allowed, name).toBe(false)
      expect(fetchStub.calls, name).toHaveLength(0)
      expect(readOutputs(env['GITHUB_OUTPUT'] ?? '')).toEqual({ allowed: 'false' })
      await owner.cleanup()
      layout.cleanup()
    }
    layout = tempLayout()
  })

  it('refuses when the API answers an error status', async () => {
    const env = gateEnv('pull_request', prEvent())
    const { owner } = testOwner({})
    await expect(
      runGate({ env, fetch: jsonFetch({ status: 404, body: {} }), owner }),
    ).rejects.toThrow(/404/)
    await owner.cleanup()
  })
})
