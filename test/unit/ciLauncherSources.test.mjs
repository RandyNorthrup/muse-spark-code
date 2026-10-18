// The ACP package carries exactly ci-entry.mjs's dependency closure: every
// relative import ci-entry.mjs reaches (statically or through its dynamic
// import of ci-run.mjs) must be a listed launcher file, every listed file
// must be reached, and the unrelated Action entry points and the non-CI
// prompt pair must stay out. Real sources on disk, no fixtures.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CI_LAUNCHER_SOURCES } from '../../scripts/lib/acpNativeSources.mjs'
import { stageCiLauncher } from '../../scripts/lib/ciStageLayout.mjs'
import { CI_TEMPLATES_DIR } from '../../action/lib/ci-run.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const libDir = path.join(root, 'action', 'lib')

const compareNames = (a, b) => {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** Every `./name.mjs` a module pulls in, statically or dynamically. */
function relativeImports(file) {
  const text = readFileSync(file, 'utf8')
  const found = new Set()
  for (const match of text.matchAll(/from\s+'(\.[^']+)'/g)) found.add(match[1])
  for (const match of text.matchAll(/import\s*\(\s*'(\.[^']+)'\s*\)/g)) found.add(match[1])
  return [...found]
}

describe('other-CI launcher closure', () => {
  it('ships exactly the files ci-entry.mjs reaches plus the CI prompts', () => {
    const listed = CI_LAUNCHER_SOURCES.map((entry) => path.join(root, entry))
    for (const entry of listed) {
      expect(existsSync(entry), `${entry} is listed but missing`).toBe(true)
    }
    expect(
      listed.filter((entry) => statSync(entry).isDirectory()).map((entry) => path.basename(entry)),
    ).toEqual(['ci'])
    const listedFiles = new Set(
      listed.filter((entry) => statSync(entry).isFile()).map((entry) => path.resolve(entry)),
    )
    const reached = new Set()
    const queue = [path.join(libDir, 'ci-entry.mjs')]
    while (queue.length > 0) {
      const file = path.resolve(queue.pop())
      if (reached.has(file)) continue
      reached.add(file)
      for (const specifier of relativeImports(file)) {
        queue.push(path.resolve(path.dirname(file), specifier))
      }
    }
    for (const file of reached) {
      expect(listedFiles.has(file), `${file} is reached but not shipped`).toBe(true)
    }
    for (const file of listedFiles) {
      expect(reached.has(file), `${file} is shipped but not reached`).toBe(true)
    }
    for (const excluded of ['checkout.mjs', 'gate.mjs', 'gate-cli.mjs', 'post.mjs']) {
      expect(reached.has(path.join(libDir, excluded)), `${excluded} must stay out`).toBe(false)
    }
  })

  it('stages ci/lib and ci/prompts with nothing else', () => {
    const stage = mkdtempSync(path.join(tmpdir(), 'ci-stage-'))
    try {
      stageCiLauncher(root, stage, CI_LAUNCHER_SOURCES)
      expect(readdirSync(path.join(stage, 'ci')).toSorted(compareNames)).toEqual(['lib', 'prompts'])
      const lib = readdirSync(path.join(stage, 'ci', 'lib')).toSorted(compareNames)
      expect(lib).toContain('ci-entry.mjs')
      expect(lib).toContain('ci-run.mjs')
      for (const excluded of ['checkout.mjs', 'gate.mjs', 'gate-cli.mjs', 'post.mjs']) {
        expect(lib, `${excluded} must not ship`).not.toContain(excluded)
      }
      const prompts = readdirSync(path.join(stage, 'ci', 'prompts'))
      expect(prompts).toEqual(['ci'])
      expect(readdirSync(path.join(stage, 'ci', 'prompts', 'ci')).toSorted(compareNames)).toEqual([
        'fix.md',
        'review.md',
      ])
      expect(() => stageCiLauncher(root, stage, [path.join('other', 'place.mjs')])).toThrow(
        'must stay under action/',
      )
    } finally {
      rmSync(stage, { recursive: true, force: true })
    }
  })

  it('renders its prompts from the shipped CI prompt directory', () => {
    const templates = path.normalize(CI_TEMPLATES_DIR)
    expect(templates.endsWith(path.join('action', 'prompts', 'ci'))).toBe(true)
    for (const prompt of ['review.md', 'fix.md']) {
      expect(existsSync(path.join(templates, prompt)), `${prompt} is missing`).toBe(true)
    }
  })
})
