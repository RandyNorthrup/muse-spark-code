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
  it('keeps all portable JSON schemas in sync with the production boundaries', async () => {
    const { stdout } = await run(process.execPath, ['scripts/exec-schema.mjs', '--check'])
    expect(stdout).toContain('Exec schemas match.')
  })
  it('registers P commands and menus while retaining C’s pending share-chat contract', async () => {
    const raw: unknown = JSON.parse(
      await readFile('docs/certification/m118-manifest-patch.json', 'utf8'),
    )
    const patch = contributionSchema.parse(raw).contributes
    expect(patch.commands.map((c) => c.command)).toEqual(Object.values(PROMPT_COMMAND_IDS))
    for (const entry of promptMenuEntries) {
      const menu = entry.menu === 'editor/context' ? entry.menu : 'webview/context'
      expect(
        patch.menus[menu]?.some((m) => m.command === entry.command && m.when.includes(entry.when)),
      ).toBe(true)
    }
    const manifest = contributionSchema.parse(
      JSON.parse(await readFile('package.json', 'utf8')),
    ).contributes
    expect(
      manifest.commands
        .filter((c) => Object.values<string>(PROMPT_COMMAND_IDS).includes(c.command))
        .map((c) => c.command),
    ).toEqual(Object.values(PROMPT_COMMAND_IDS).filter((id) => id !== PROMPT_COMMAND_IDS.shareChat))
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
