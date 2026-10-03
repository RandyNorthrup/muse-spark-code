// M80 lane C: the sticky review comment (SPEC §2.2, §6.6; G11). Only a valid
// completed result posts; the body is redacted first, then every @ is
// defused, then it is capped; the footer names model, requests, settled and
// uncertain cost, images and the run; one bot-owned comment is updated, or
// one is created.

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ACTION_COMMENT_MAX_CHARS } from '../../action/lib/lifecycle.mjs'
import {
  commentBody,
  completedResult as readCompleted,
  defuseMentions,
  postSticky,
  STICKY_MARKER,
} from '../../action/lib/post.mjs'
import captures from '../action/captures.json'
import { resultRecord } from './helpers/execContract'
import {
  ACTION_DIR,
  allocate,
  completedResult,
  jsonFetch,
  jsonRecord,
  NODE,
  tempLayout,
  TEST_TOKEN,
  type TempLayout,
} from './helpers/actionFixtures'

const ZWSP = String.fromCodePoint(0x20_0b)
const REPO = captures.repository.full_name

function body(overrides: Partial<Parameters<typeof commentBody>[0]> = {}): string {
  return commentBody({
    result: resultRecord(),
    runUrl: 'https://github.com/o/r/actions/runs/1',
    artifactName: 'muse-spark-1-1-review-0000000000000001',
    mode: 'review',
    patchWithheld: '',
    patchPublished: false,
    literals: [TEST_TOKEN],
    ...overrides,
  })
}

describe('the comment body (G11)', () => {
  it('starts with the marker and ends with the footer', () => {
    const text = body()
    expect(text.startsWith(`${STICKY_MARKER}\ndone\n`)).toBe(true)
    expect(text).toContain(
      'Model muse-spark · 1 requests · $0.000002 settled, $0.000000 uncertain · images: 0 returned, 0 uncertain · [run](https://github.com/o/r/actions/runs/1)',
    )
  })

  it('defuses every mention, in the message and the fix notice', () => {
    const result = {
      ...resultRecord(),
      finalMessage: 'ping @team and @org/sec',
      filesChanged: ['@x/file.ts'],
    }
    const text = body({ result, mode: 'fix', patchPublished: true })
    expect(text).not.toMatch(new RegExp(`@(?!${ZWSP})`))
    expect(text).toContain(`@${ZWSP}team`)
    expect(text).toContain(`@${ZWSP}x/file.ts`)
    expect(defuseMentions('a@b@')).toBe(`a@${ZWSP}b@${ZWSP}`)
  })

  it('redacts before it caps, so no token prefix survives a cut', () => {
    const notice = '\n\n(The message was cut to fit a comment.)'
    const overhead = body({ result: { ...resultRecord(), finalMessage: '' } }).length
    const cutAt = ACTION_COMMENT_MAX_CHARS - overhead - notice.length
    // The token straddles the cut: five of its characters fall before it.
    const message = `${'a'.repeat(cutAt - 5)}${TEST_TOKEN}${'b'.repeat(5000)}`
    const text = body({ result: { ...resultRecord(), finalMessage: message } })
    expect(text.length).toBeLessThanOrEqual(ACTION_COMMENT_MAX_CHARS)
    expect(text).toContain(notice)
    expect(text).not.toContain(TEST_TOKEN.slice(0, 5))
    expect(text.endsWith('[run](https://github.com/o/r/actions/runs/1)\n')).toBe(true)
  })

  it('shows uncertainty and paid images in the footer', () => {
    const base = resultRecord()
    const result = {
      ...base,
      usage: {
        ...base.usage,
        costUsd: {
          settled: 0.010004,
          uncertain: 0.108135,
          reserved: 0,
          total: 0.118139,
          isUpperBound: true,
        },
        paid: {
          imageAttempts: 2,
          imagesReturned: 1,
          imagesRefunded: 0,
          imagesUncertain: 1,
          settledUsd: 0.01,
          uncertainUsd: 0.01,
        },
      },
    }
    expect(body({ result })).toContain(
      '$0.010004 settled, $0.108135 uncertain (total is an upper bound) · images: 1 returned, 1 uncertain',
    )
  })

  it('names the artifact and files of a published fix, or why it was withheld', () => {
    const result = { ...resultRecord(), filesChanged: ['src/a.ts', 'docs/b.md'] }
    expect(body({ result, mode: 'fix', patchPublished: true })).toContain(
      'Proposed patch: artifact `muse-spark-1-1-review-0000000000000001`; files: src/a.ts, docs/b.md.',
    )
    expect(body({ mode: 'fix', patchWithheld: 'binary' })).toContain(
      'so the whole patch is withheld',
    )
    expect(body({ mode: 'fix', patchWithheld: 'secret' })).toContain('credential-shaped')
    expect(body({ mode: 'fix' })).toContain('No file changed')
    expect(body()).not.toContain('patch')
  })

  it('keeps the cap with a huge file list, a long model id and a long message (RVM80CD P2-6)', () => {
    const files = Array.from(
      { length: 8000 },
      (_, index) => `src/deep/path/file-${String(index)}.ts`,
    )
    const result = {
      ...resultRecord(),
      model: 'm'.repeat(5000),
      filesChanged: files,
      finalMessage: 'x'.repeat(100_000),
    }
    const text = body({ result, mode: 'fix', patchPublished: true })
    expect(text.length).toBeLessThanOrEqual(ACTION_COMMENT_MAX_CHARS)
    expect(text).toContain('more. A maintainer reads it before approving the push.')
    expect(text).toContain('(The message was cut to fit a comment.)')
    expect(text.endsWith('[run](https://github.com/o/r/actions/runs/1)\n')).toBe(true)
    const empty = body({
      result: { ...result, finalMessage: '' },
      mode: 'fix',
      patchPublished: true,
    })
    expect(empty.length).toBeLessThanOrEqual(ACTION_COMMENT_MAX_CHARS)
  })
})

describe('posting', () => {
  let layout: TempLayout
  beforeEach(() => {
    layout = tempLayout()
  })
  afterEach(() => {
    layout.cleanup()
  })

  const signal = new AbortController().signal
  const post = (fetch: typeof globalThis.fetch) =>
    postSticky({
      fetch,
      apiUrl: 'https://api.example.test',
      repository: REPO,
      prNumber: 72,
      token: TEST_TOKEN,
      body: 'B',
      signal,
    })

  it('updates the bot-owned sticky comment, found across pages', async () => {
    const human = { id: 1, user: { type: 'User' }, body: `${STICKY_MARKER}\nforged by a person` }
    const page = Array.from({ length: 100 }, (_, index) => ({
      id: index + 10,
      user: { type: 'User' },
      body: 'hi',
    }))
    const bot = { id: 99, user: captures.botComment.user, body: `${STICKY_MARKER}\nold` }
    const fetch = jsonFetch([human, ...page.slice(1)], [bot], { id: 99 })
    expect(await post(fetch)).toBe('updated')
    expect(fetch.calls.map((call) => [call.init?.method ?? 'GET', call.url])).toEqual([
      ['GET', `https://api.example.test/repos/${REPO}/issues/72/comments?per_page=100&page=1`],
      ['GET', `https://api.example.test/repos/${REPO}/issues/72/comments?per_page=100&page=2`],
      ['PATCH', `https://api.example.test/repos/${REPO}/issues/comments/99`],
    ])
    const sent = fetch.calls[2]?.init?.body
    expect(typeof sent === 'string' ? jsonRecord(sent) : sent).toEqual({ body: 'B' })
  })

  it('creates one when no bot-owned sticky comment exists', async () => {
    const fetch = jsonFetch([{ id: 1, user: { type: 'User' }, body: STICKY_MARKER }], { id: 2 })
    expect(await post(fetch)).toBe('created')
    expect(fetch.calls[1]).toMatchObject({
      url: `https://api.example.test/repos/${REPO}/issues/72/comments`,
      init: { method: 'POST' },
    })
  })

  it('posts only a valid completed result with exit code 0', async () => {
    const paths = allocate(layout)
    writeFileSync(paths.result, JSON.stringify(completedResult()))
    expect(await readCompleted(paths.result)).toEqual(completedResult())
    writeFileSync(
      paths.result,
      JSON.stringify(
        completedResult({ status: 'failed', exitCode: 4, error: { kind: 'f', message: '' } }),
      ),
    )
    expect(await readCompleted(paths.result)).toBeNull()
    writeFileSync(paths.result, JSON.stringify(completedResult({ exitCode: 3 })))
    expect(await readCompleted(paths.result)).toBeNull()
  })

  it('the entry makes no request and no comment without a completed run status', () => {
    const paths = allocate(layout)
    writeFileSync(paths.result, JSON.stringify(completedResult()))
    const done = spawnSync(NODE, [path.join(ACTION_DIR, 'lib', 'post.mjs')], {
      env: {
        PATH: process.env['PATH'],
        RUNNER_TEMP: layout.runnerTemp,
        MUSE_INVOCATION: paths.invocation,
        MUSE_RUN_STATUS: 'failed',
        MUSE_GITHUB_TOKEN: TEST_TOKEN,
        GITHUB_API_URL: 'https://127.0.0.1:9',
      },
      encoding: 'utf8',
    })
    expect(done.status).toBe(0)
    expect(done.stdout).toBe('No completed result, so no comment was posted.\n')
  })
})
