import { describe, expect, it } from 'vitest'
import {
  importPromptFile,
  mergePromptScopes,
  parsePromptFile,
  promptExportName,
  promptLoadSchema,
  promptMenuEntries,
  promptVariableNames,
  savedPromptSchema,
  serialisePromptFile,
  type PromptStoragePort,
} from '../../src/shared/prompts'
import {
  PROMPT_COMMAND_IDS,
  PROMPT_USER_FOLDER,
  PROMPT_WORKSPACE_FOLDER,
} from '../../src/shared/constants'
import { savedPromptFixture } from './helpers/sharingFixtures'

describe('portable saved prompts', () => {
  it.each([
    '',
    'No final newline',
    '\n\r\n# 日本語\n---\n',
    ' {{selection}}\r\n{{ selection }}\r\n',
  ])('round trips the exact body %j', (body) => {
    const prompt = {
      ...savedPromptFixture,
      body,
      variables: body.includes('selection')
        ? [{ name: 'selection', source: 'selection' as const }]
        : [],
    }
    const file = serialisePromptFile(prompt)
    expect(parsePromptFile(file)).toEqual(prompt)
    expect(serialisePromptFile(parsePromptFile(file))).toBe(file)
    expect(parsePromptFile(file.replaceAll('\n', '\r\n')).body).toBe(body.replaceAll('\n', '\r\n'))
  })

  it('preserves metadata, quotes, tags and every built-in/named variable', () => {
    const prompt = { ...savedPromptFixture, title: 'A "quoted": title\nwith lines' }
    expect(parsePromptFile(serialisePromptFile(prompt))).toEqual(prompt)
    expect(promptVariableNames(prompt.body + '{{selection}}')).toEqual([
      'selection',
      'file',
      'clipboard',
      'audience',
    ])
  })
  it('refuses unknown front-matter metadata instead of silently losing it', () => {
    const file = serialisePromptFile(savedPromptFixture)
    const foreign = file.replace('"schemaVersion": 1', '"foreign": true, "schemaVersion": 1')
    expect(() => parsePromptFile(foreign)).toThrow()
  })

  it.each([
    { schemaVersion: 2 },
    { unknown: true },
    { id: '' },
    { title: '' },
    { createdAt: 'invalid' },
    { updatedAt: '2026-10-04T00:00:00Z' },
    { scope: 'repository' },
    { variables: [] },
    { variables: [...savedPromptFixture.variables, savedPromptFixture.variables[0]] },
    {
      variables: savedPromptFixture.variables.map((v) =>
        v.name === 'selection' ? { ...v, source: 'clipboard' } : v,
      ),
    },
    {
      variables: savedPromptFixture.variables.map((v) =>
        v.name === 'selection' ? { ...v, source: 'input' } : v,
      ),
    },
  ])('rejects invalid metadata %j', (patch) => {
    expect(savedPromptSchema.safeParse({ ...savedPromptFixture, ...patch }).success).toBe(false)
  })

  it.each(['plain text', '---\n{}\n---\nbody', '---\nnot JSON\n---\nbody', '---\n{}\n---'])(
    'rejects an invalid file %j',
    (file) => {
      expect(() => parsePromptFile(file)).toThrow()
    },
  )

  it('imports into a chosen scope as untrusted without resolving variables or running', () => {
    const result = importPromptFile(serialisePromptFile(savedPromptFixture), 'workspace')
    expect(result.prompt.scope).toBe('workspace')
    expect(result.prompt.untrusted).toBe(true)
    expect(result.prompt.body).toBe(savedPromptFixture.body)
    expect(result.variables).toEqual(savedPromptFixture.variables)
    expect(result.autoRun).toBe(false)
    expect(parsePromptFile(serialisePromptFile(result.prompt)).untrusted).toBe(true)
  })

  it('loads into an active or new chat with insert-only semantics', () => {
    for (const chat of ['active', 'new']) {
      const input = { promptId: 'p', scope: 'user', chat, action: 'insert', send: false }
      expect(promptLoadSchema.parse(input)).toEqual(input)
      expect(promptLoadSchema.safeParse({ ...input, send: true }).success).toBe(false)
      expect(promptLoadSchema.safeParse({ ...input, action: 'run' }).success).toBe(false)
    }
  })

  it('merges both storage scopes stably, retaining same titles and ids across scopes', async () => {
    const user = { ...savedPromptFixture, id: 'z', title: 'Same' }
    const workspace = { ...user, scope: 'workspace' as const }
    const store: PromptStoragePort = {
      list: (scope) =>
        Promise.resolve(scope === 'user' ? [user, { ...user, id: 'a' }, user] : [workspace]),
      write: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    }
    const entries = mergePromptScopes(await store.list('user'), await store.list('workspace'))
    expect(entries.map((p) => `${p.scope}:${p.id}`)).toEqual(['user:a', 'user:z', 'workspace:z'])
    expect(mergePromptScopes([workspace], [user])).toEqual([])
    expect(PROMPT_USER_FOLDER).toBe('prompts')
    expect(PROMPT_WORKSPACE_FOLDER).toBe('.muse/prompts')
    expect(promptExportName('review-selection')).toBe('review-selection.muse-prompt.md')
    expect(() => promptExportName('../outside')).toThrow()
  })

  it('defines own-message, composer and selection Save menus plus composer Use', () => {
    expect(promptMenuEntries.map((m) => m.source)).toEqual([
      'userMessage',
      'composer',
      'editorSelection',
      'library',
    ])
    expect(promptMenuEntries[0].when).toContain('messageIsOwn')
    expect(promptMenuEntries[2].when).toBe('editorHasSelection')
    expect(promptMenuEntries[3].command).toBe(PROMPT_COMMAND_IDS.use)
    expect(new Set(promptMenuEntries.map((m) => m.id)).size).toBe(promptMenuEntries.length)
    expect(PROMPT_COMMAND_IDS.copyToUser).toBe('museSpark.copyToMyPrompts')
    expect(PROMPT_COMMAND_IDS.library).toBe('museSpark.promptLibrary')
  })
})
