import { describe, expect, it } from 'vitest'
import {
  commitMessageFrom,
  commitMessagePrompt,
  hasCredentialShapes,
  pullRequestPrompt,
  pullRequestTextFrom,
} from '../../src/core/git/gitText'
import { GIT_PROMPT_DIFF_MAX_CHARS, MODEL_TEXT } from '../../src/shared/constants'

// Built at run time so the repository's secret scan sees no token shape.
const TOKEN = `ghp_${'0'.repeat(36)}`

describe('the generation prompts (M71)', () => {
  it('puts the changes after a line saying they are data, in a fence they cannot close', () => {
    const prompt = commitMessagePrompt({
      branch: 'feature',
      scope: 'staged',
      files: ['src/a.ts', 'README.md'],
      diff: 'diff --git a/src/a.ts b/src/a.ts\n+const x = "```"\n+````y',
    })
    const dataLine = prompt.indexOf(MODEL_TEXT.gitUntrustedData)
    expect(dataLine).toBeGreaterThan(0)
    expect(prompt.indexOf('diff --git')).toBeGreaterThan(dataLine)
    expect(prompt).toContain('Branch: feature')
    expect(prompt).toContain('Staged files:\n- src/a.ts\n- README.md')
    // The diff holds a run of four backticks, so the fence has five.
    expect(prompt).toContain('`````diff\n')
    expect(prompt.endsWith('\n`````')).toBe(true)
  })

  it('says when the diff was cut, and how much', () => {
    const prompt = commitMessagePrompt({
      branch: undefined,
      scope: 'all',
      files: [],
      diff: 'x'.repeat(GIT_PROMPT_DIFF_MAX_CHARS + 5),
    })
    expect(prompt).toContain('[5 more characters of the diff were left out]')
    expect(prompt).toContain('Branch: (detached HEAD)')
    expect(prompt).toContain('Changed files:')
  })

  it('lists the commits, or says why it could not', () => {
    const listed = pullRequestPrompt({
      head: 'feature',
      base: 'main',
      commits: ['Add the parser', 'Fix the tests'],
      files: ['src/parser.ts'],
    })
    expect(listed).toContain('Branch: feature → main')
    expect(listed).toContain('- Add the parser\n- Fix the tests')
    expect(listed).toContain('Changed files:\n- src/parser.ts')
    const unlisted = pullRequestPrompt({
      head: 'feature',
      base: 'main',
      commits: undefined,
      files: undefined,
      commitsUnavailable: 'origin/main is not known here',
    })
    expect(unlisted).toContain(
      'The commits on the branch could not be listed: origin/main is not known here',
    )
    expect(unlisted).not.toContain('Changed files:')
  })

  it('counts the files it leaves out', () => {
    const files = Array.from({ length: 205 }, (_, index) => `f${String(index)}`)
    expect(commitMessagePrompt({ branch: 'b', scope: 'all', files, diff: '' })).toContain(
      '- and 5 more',
    )
  })
})

describe('reading the replies (M71)', () => {
  it('takes a commit message as it came, without a fence around it', () => {
    expect(commitMessageFrom('  Add the parser\n\nIt handles ??.  ')).toBe(
      'Add the parser\n\nIt handles ??.',
    )
    expect(commitMessageFrom('```text\nAdd the parser\n```')).toBe('Add the parser')
    expect(commitMessageFrom(' '.repeat(3))).toBeUndefined()
  })

  it('masks a credential in what it drafts', () => {
    expect(commitMessageFrom(`Use ${TOKEN} for CI`)).toBe('Use [redacted] for CI')
    expect(pullRequestTextFrom(`Title\n\nThe key is ${TOKEN}.`)).toEqual({
      title: 'Title',
      body: 'The key is [redacted].',
    })
    expect(hasCredentialShapes(`x ${TOKEN}`)).toBe(true)
    expect(hasCredentialShapes('nothing here')).toBe(false)
  })

  it('splits a pull request reply into a title and a body, dropping title markup', () => {
    expect(pullRequestTextFrom('# Add the parser\n\n## What\nIt parses.')).toEqual({
      title: 'Add the parser',
      body: '## What\nIt parses.',
    })
    expect(pullRequestTextFrom('\n\nTitle: Fix it\n')).toEqual({ title: 'Fix it', body: '' })
    expect(pullRequestTextFrom('**Bold title**\nbody')).toEqual({
      title: 'Bold title',
      body: 'body',
    })
    expect(pullRequestTextFrom('````\nIn a fence\n\nbody\n````')).toEqual({
      title: 'In a fence',
      body: 'body',
    })
    expect(pullRequestTextFrom('  \n ')).toBeUndefined()
    expect(pullRequestTextFrom('#\nbody')).toBeUndefined()
  })
})
