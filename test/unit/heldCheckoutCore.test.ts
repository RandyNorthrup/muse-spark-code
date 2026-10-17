// The held-checkout core both hosts call (M123 lane P): the cat-file
// batch protocol and the checkout confirmation words.

import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import {
  BlobAnswers,
  blobHeaderOf,
  pullRequestCheckoutConfirmation,
} from '../../src/core/git/heldCheckoutCore'
import type { HeldEntry } from '../../src/core/git/heldTree'

const ENTRY: HeldEntry = {
  path: 'README.md',
  kind: 'file',
  oid: 'e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5',
  size: 5,
}
const BYTES = Buffer.from('hello')
const ANSWER = Buffer.concat([blobHeaderOf(ENTRY), BYTES, Buffer.from('\n')])
const PULL_REQUEST = {
  number: 51,
  url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
  state: 'open',
  title: 'A foreign pull request',
  isDraft: false,
  isMerged: false,
  author: { login: 'Piangpi1997', id: 203_822_472 },
  headRef: 'android-termux-p0-tests',
  headSha: '29fe2d8a111e5424c69c3ad0e7328b53a98646af',
  headRepository: 'Piangpi1997/muse-spark-code',
  baseRef: 'main',
  baseRepository: 'RandyNorthrup/muse-spark-code',
}

function answersFor(blobs: readonly HeldEntry[]) {
  const written: { readonly entry: HeldEntry; readonly bytes: Buffer }[] = []
  const answers = new BlobAnswers(
    blobs,
    (entry, bytes) => {
      written.push({ entry, bytes })
      return Promise.resolve()
    },
    () => new Error('unreadable'),
  )
  return { answers, written }
}

describe('held checkout answers (M123 lane P)', () => {
  it('writes one answer delivered in two chunks', async () => {
    const { answers, written } = answersFor([ENTRY])
    await answers.take(ANSWER.subarray(0, 3))
    expect(written).toHaveLength(0)
    await answers.take(ANSWER.subarray(3))
    answers.finish()
    expect(written).toHaveLength(1)
    expect(written[0]?.bytes.equals(BYTES)).toBe(true)
  })

  it("refuses another object's bytes", async () => {
    const { answers } = answersFor([ENTRY])
    const forged = Buffer.concat([
      Buffer.from(`${'0'.repeat(40)} blob 5\n`),
      BYTES,
      Buffer.from('\n'),
    ])
    await expect(answers.take(forged)).rejects.toThrow('unreadable')
  })

  it('refuses a missing trailing line feed', async () => {
    const { answers } = answersFor([ENTRY])
    const truncated = Buffer.concat([blobHeaderOf(ENTRY), BYTES, Buffer.from('x')])
    await expect(answers.take(truncated)).rejects.toThrow('unreadable')
  })

  it('refuses a byte past the last answer', async () => {
    const { answers } = answersFor([ENTRY])
    await answers.take(ANSWER)
    await expect(answers.take(Buffer.from('x'))).rejects.toThrow('unreadable')
    expect(() => {
      answers.finish()
    }).toThrow('unreadable')
  })

  it('refuses finishing before every blob was answered', () => {
    const { answers } = answersFor([ENTRY])
    expect(() => {
      answers.finish()
    }).toThrow('unreadable')
  })
})

describe('pull request checkout confirmation (M123 lane P)', () => {
  it('holds someone else’s pull request in its own words', () => {
    const detail = pullRequestCheckoutConfirmation(PULL_REQUEST, false)
    expect(detail).toContain(PULL_REQUEST.title)
    expect(detail).toContain('Piangpi1997')
    expect(detail).toContain('Piangpi1997/muse-spark-code:android-termux-p0-tests')
    expect(detail).toContain(UI_TEXT.openPullRequestHeldDetail)
    expect(detail).toContain(UI_TEXT.openPullRequestUnfilteredDetail)
    expect(detail).toContain(UI_TEXT.gitCommandConsequences)
  })

  it('names the user’s own pull request as unheld', () => {
    const detail = pullRequestCheckoutConfirmation(
      { ...PULL_REQUEST, headRepository: undefined, headRef: 'feature' },
      true,
    )
    expect(detail).toContain(UI_TEXT.openPullRequestOwnDetail)
    expect(detail).not.toContain(UI_TEXT.openPullRequestHeldDetail)
  })
})
