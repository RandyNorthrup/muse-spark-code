// "Open a Pull Request in a Conversation…" over an unloadable bundle
// (src/host/git/conversationGitBundle.ts): the loader's own refusal shows
// the fixed unavailable words; a foreign failure is never shown as-is and
// reaches the caller instead.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { openPullRequestInConversation } from '../../src/host/git/conversationGitBundle'
import type { GitWindowFeatures } from '../../src/host/git/gitWindow'

describe('openPullRequestInConversation', () => {
  it('shows the fixed words for the loader refusal', async () => {
    const shown: string[] = []
    await openPullRequestInConversation(
      () => {
        throw new Error(UI_TEXT.gitUnavailable, { cause: new Error('disk is gone') })
      },
      (message) => {
        shown.push(message)
      },
    )
    expect(shown).toEqual([UI_TEXT.gitUnavailable])
  })

  it('rethrows a foreign load failure instead of showing it', async () => {
    const shown: string[] = []
    const foreign = new Error('bundle exploded at /secret/path/bundle.js:1')
    await expect(
      openPullRequestInConversation(
        () => {
          throw foreign
        },
        (message) => {
          shown.push(message)
        },
      ),
    ).rejects.toBe(foreign)
    expect(shown).toEqual([])
  })

  it('opens through loaded features', async () => {
    const shown: string[] = []
    let opened = 0
    // The pass-through test only opens: no harness builds the whole window.
    const features = {
      openPullRequestInConversation: () => {
        opened += 1
        return Promise.resolve()
      },
    } as unknown as GitWindowFeatures
    await openPullRequestInConversation(
      () => features,
      (message) => {
        shown.push(message)
      },
    )
    expect(opened).toBe(1)
    expect(shown).toEqual([])
  })
})
