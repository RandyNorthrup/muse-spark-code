import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { PROMPT_COMMAND_IDS } from '../../src/shared/constants'
import { promptMenuEntries } from '../../src/shared/prompts'

const run = promisify(execFile)
const contributionSchema = z.object({
  contributes: z.object({
    commands: z.array(z.object({ command: z.string(), title: z.string(), category: z.string() })),
    menus: z.record(
      z.string(),
      z.array(z.object({ command: z.string(), when: z.string(), group: z.optional(z.string()) })),
    ),
  }),
})

describe('M118 integration artifacts', () => {
  it('requires sync consent on each machine and forbids workspace overrides', async () => {
    const schema = z.object({
      contributes: z.object({
        configuration: z.object({
          properties: z.record(
            z.string(),
            z.object({ scope: z.optional(z.string()), default: z.optional(z.unknown()) }),
          ),
        }),
      }),
    })
    const manifest = schema.parse(JSON.parse(await readFile('package.json', 'utf8')))
    const setting =
      manifest.contributes.configuration.properties['museSpark.syncPromptsAndBookmarks']
    expect(setting?.scope).toBe('machine')
    expect(setting?.default).toBe(false)
    for (const file of ['src/host/prompts/promptEntry.ts']) {
      const source = await readFile(file, 'utf8')
      expect(source).toMatch(/inspect<boolean>\(PROMPT_SYNC_SETTING\)\s*\?\.globalValue/)
      expect(source).not.toContain('get<boolean>(PROMPT_SYNC_SETTING)')
    }
  })
  it('keeps all portable JSON schemas in sync with the production boundaries', async () => {
    const { stdout } = await run(process.execPath, ['scripts/exec-schema.mjs', '--check'])
    expect(stdout).toContain('Exec schemas match.')
  })
  it('registers all sharing commands and portable context menus', async () => {
    const manifest = contributionSchema.parse(
      JSON.parse(await readFile('package.json', 'utf8')),
    ).contributes
    expect(
      manifest.commands
        .filter((c) => Object.values<string>(PROMPT_COMMAND_IDS).includes(c.command))
        .map((c) => c.command),
    ).toEqual(expect.arrayContaining(Object.values(PROMPT_COMMAND_IDS)))
    for (const entry of promptMenuEntries) {
      const menu = entry.menu === 'editor/context' ? entry.menu : 'webview/context'
      expect(
        manifest.menus[menu]?.some(
          (m) => m.command === entry.command && m.when.includes(entry.when),
        ),
      ).toBe(true)
    }
  })
})
