// M103-S: shipped text uses the real shared catalogue and a complete recipe
// ledger. These are asset checks, never toolchain, hardware or cloud calls.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { type ContextIo } from '../../src/core/context/contextFiles'
import { loadSkills, parseSkillFile, skillBodyForModel } from '../../src/core/context/skills'
import { countSecretMatches } from '../../src/core/redact'
import { SKILL_FILE_MAX_BYTES, SKILL_ID_PATTERN } from '../../src/shared/constants'

const ROOT = path.resolve('first-party-skills')
const RECIPE_LIST = path.resolve('docs/certification/m103-s-recipes.json')
const MAX_ENTRY_LINES = 64
const IDS = [
  'maker_cad',
  'maker_cnc',
  'maker_firmware',
  'maker_kicad',
  'maker_micropython',
  'maker_pi',
  'maker_printers',
  'maker_ros2',
  'maker_simulation',
] as const
const recipeSchema = z.object({
  recipes: z.array(
    z.object({
      id: z.string().check(z.regex(/^[a-z0-9-]+$/)),
      command: z.string().check(z.minLength(1)),
      actionClass: z.enum(['offline', 'observe', 'connect', 'program', 'actuate', 'refused']),
      evidence: z.enum(['pending-toolchain', 'pending-user-cloud-opt-in', 'rig-command']),
    }),
  ),
})

function documents(): readonly { readonly file: string; readonly text: string }[] {
  return IDS.flatMap((id) =>
    readdirSync(path.join(ROOT, id)).map((name) => {
      const file = path.join(ROOT, id, name)
      expect(statSync(file).isFile(), file).toBe(true)
      expect(name.endsWith('.md'), file).toBe(true)
      return { file, text: readFileSync(file, 'utf8') }
    }),
  )
}

const io: ContextIo = {
  readFile: (file, maxBytes) =>
    Promise.resolve(
      readFileSync(file).subarray(0, maxBytes === undefined ? undefined : maxBytes + 1),
    ),
  listDirectory: (folder) =>
    Promise.resolve(
      readdirSync(folder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    ),
  realPath: (file) => Promise.resolve(realpathSync(file)),
}

describe('maker skill pack (M103-S)', () => {
  it('ships exactly the planned ids with valid front matter and short on-demand entries', () => {
    expect(
      readdirSync(ROOT)
        .filter((id) => id.startsWith('maker_'))
        .toSorted((a, b) => a.localeCompare(b, 'en')),
    ).toEqual(IDS)
    for (const id of IDS) {
      expect(SKILL_ID_PATTERN.test(id)).toBe(true)
      const text = readFileSync(path.join(ROOT, id, 'SKILL.md'), 'utf8')
      const parsed = parseSkillFile(text)
      expect(parsed.ok, id).toBe(true)
      if (!parsed.ok) {
        throw new Error(parsed.reason)
      }
      expect(parsed.skill.name, id).toBe(id)
      expect(parsed.skill.description.length, id).toBeGreaterThan(1)
      expect(parsed.skill.isUserInvocable, id).toBe(true)
      expect(text.split('\n').length, id).toBeLessThanOrEqual(MAX_ENTRY_LINES)
      expect(Buffer.byteLength(text), id).toBeLessThan(SKILL_FILE_MAX_BYTES)
      expect(parsed.skill.body, id).not.toMatch(/```(?:sh|bash|powershell)/)
    }
  })

  it('resolves every local topic link inside its skill and reaches every topic on demand', () => {
    for (const { file, text } of documents()) {
      const linked = new Set<string>()
      for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1]
        if (target === undefined || target.startsWith('https://')) {
          continue
        }
        const resolved = path.resolve(path.dirname(file), target)
        const relative = path.relative(path.dirname(file), resolved)
        expect(relative.startsWith('..') || path.isAbsolute(relative), `${file}: ${target}`).toBe(
          false,
        )
        expect(statSync(resolved).isFile(), `${file}: ${target}`).toBe(true)
        linked.add(path.basename(resolved))
      }
      if (path.basename(file) === 'SKILL.md') {
        expect([...linked].toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual(
          readdirSync(path.dirname(file))
            .filter((name) => name !== 'SKILL.md')
            .toSorted((a, b) => a.localeCompare(b, 'en')),
        )
      }
    }
  })

  it('contains no credential values or unfinished scaffold', () => {
    for (const { file, text } of documents()) {
      expect(countSecretMatches(text, []), file).toBe(0)
      // Wokwi is not in the base branch's secret table yet (lane G owns it).
      expect(/wok_[A-Za-z0-9_-]{40}/.test(text), file).toBe(false)
      expect(text, file).not.toMatch(/\b(?:TODO|FIXME)\b/)
    }
  })

  it('accounts for every executable recipe exactly once with its class and honest evidence', () => {
    const list = recipeSchema.parse(JSON.parse(readFileSync(RECIPE_LIST, 'utf8')))
    const found: { readonly id: string; readonly command: string }[] = []
    for (const { file, text } of documents()) {
      const blocks = text.match(/^```(?:sh|bash|powershell)$/gm) ?? []
      let markedCount = 0
      for (const match of text.matchAll(
        /<!-- recipe:([a-z0-9-]+) -->\s+```(?:sh|bash|powershell)\n([\s\S]*?)\n```/g,
      )) {
        markedCount += 1
        const [, id, command] = match
        if (id === undefined || command === undefined) {
          throw new Error(`Incomplete recipe in ${file}`)
        }
        found.push({ id, command })
      }
      expect(markedCount, file).toBe(blocks.length)
    }
    expect(found.length).toBeGreaterThan(0)
    expect(new Set(found.map((entry) => entry.id)).size).toBe(found.length)
    expect(found.toSorted((a, b) => a.id.localeCompare(b.id, 'en'))).toEqual(
      list.recipes
        .map(({ id, command }) => ({ id, command }))
        .toSorted((a, b) => a.id.localeCompare(b.id, 'en')),
    )
    // No recipe may dispatch real hardware as if it were an offline check.
    expect(
      list.recipes.every(
        (entry) => entry.actionClass === 'offline' || entry.actionClass === 'observe',
      ),
    ).toBe(true)
    expect(list.recipes.find((entry) => entry.id === 'wokwi-run')?.evidence).toBe(
      'pending-user-cloud-opt-in',
    )
  })

  it('keeps host approval, physical stops, secrets and editor placement in every entry', () => {
    for (const id of IDS) {
      const text = readFileSync(path.join(ROOT, id, 'SKILL.md'), 'utf8')
      for (const invariant of [
        "host's approval",
        'Send once',
        'confirm flag',
        'never approval',
        'do not reroute',
        'Headless and unattended workers do offline and observe work',
        'physical E-stop',
        'software stop is not an emergency stop',
        'secrets.h',
        'settings.toml',
        'secrets.yaml',
        'sdkconfig Wi-Fi',
        'ACP editors',
        'computer running the engine',
        'capability record',
      ]) {
        expect(text.toLowerCase().replaceAll(/\s+/g, ' '), `${id}: ${invariant}`).toContain(
          invariant.toLowerCase(),
        )
      }
      expect(text, id).not.toMatch(/(?:enable|use|switch to)\s+(?:bypass|always allow)/i)
    }
  })

  it('loads through the same portable catalogue with topic content kept out of the initial body', async () => {
    const loaded = await loadSkills({ io, platform: process.platform }, [
      {
        directory: ROOT,
        source: 'bundled',
        confineTo: ROOT,
        packageRoot: ROOT,
      },
    ])
    expect(loaded.warnings).toEqual([])
    expect(
      loaded.skills
        .filter((skill) => skill.id.startsWith('maker_'))
        .map((skill) => skill.id)
        .toSorted((a, b) => a.localeCompare(b, 'en')),
    ).toEqual(IDS)
    for (const skill of loaded.skills) {
      if (!skill.id.startsWith('maker_')) {
        continue
      }
      expect(skill.source).toBe('bundled')
      expect(skillBodyForModel(skill)).toContain(ROOT)
      expect(skill.body).not.toContain('<!-- recipe:')
    }
  })
})
