import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Closed history moves out of PLAN.md into docs/plan-archive/ so the plan
// stays well under the plan reader's size bound (CONTRIBUTING.md, "Archiving
// closed history from PLAN.md"). What moves is kept byte for byte: each
// passage stands between a `plan-archive:begin` marker that carries its size
// and SHA-256 and a `plan-archive:end` marker, and this suite hashes every
// one. An edit inside a block, a reformatted block or a block cut short fails
// here; so does a marker that no longer parses, which would otherwise hide its
// block from the check.

const root = path.resolve(import.meta.dirname, '../..')
const folder = path.join(root, 'docs/plan-archive')
// `at` names the commit the line numbers refer to; the first move's blocks carry none.
const BLOCK =
  /<!-- plan-archive:begin id="([^"]+)" lines="(\d+)-(\d+)"(?: at="[0-9a-f]{7,40}")? bytes="(\d+)" sha256="([0-9a-f]{64})" -->\n\n([^]*?)\n<!-- plan-archive:end id="\1" -->/g

interface Block {
  readonly id: string
  readonly bytes: number
  readonly sha256: string
  readonly body: string
}

function blocksOf(text: string): Block[] {
  return Array.from(text.matchAll(BLOCK), (match) => ({
    id: match[1] ?? '',
    bytes: Number(match[4]),
    sha256: match[5] ?? '',
    body: match[6] ?? '',
  }))
}

/** What is wrong with the blocks of one archive file's text; empty when nothing is. */
function problemsIn(text: string): string[] {
  const blocks = blocksOf(text)
  const problems: string[] = []
  const begins = text.match(/<!-- plan-archive:begin /g)?.length ?? 0
  const ends = text.match(/<!-- plan-archive:end /g)?.length ?? 0
  if (begins !== blocks.length || ends !== blocks.length)
    problems.push(
      `${String(begins)} begin and ${String(ends)} end markers for ${String(blocks.length)} whole blocks`,
    )
  for (const block of blocks) {
    if (Buffer.byteLength(block.body) !== block.bytes) problems.push(`${block.id}: size`)
    if (createHash('sha256').update(block.body).digest('hex') !== block.sha256)
      problems.push(`${block.id}: sha256`)
  }
  return problems
}

const files = readdirSync(folder)
  .filter((name) => name.endsWith('.md'))
  .toSorted((left, right) => left.localeCompare(right))
const texts = new Map(files.map((name) => [name, readFileSync(path.join(folder, name), 'utf8')]))

describe('PLAN.md archive', () => {
  it('holds decisions, gate records and milestone sections', () => {
    expect(files).toEqual(['decisions.md', 'gates.md', 'milestones.md'])
  })

  it.each(files)('keeps every marked passage of %s byte for byte', (name) => {
    const text = texts.get(name) ?? ''
    expect(blocksOf(text).length).toBeGreaterThan(0)
    expect(problemsIn(text)).toEqual([])
  })

  it('gives every passage its own id', () => {
    const ids = files.flatMap((name) => blocksOf(texts.get(name) ?? '').map((block) => block.id))
    expect(ids.length).toBeGreaterThan(100)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('notices a changed, shortened or unmarked passage', () => {
    const text = texts.get('gates.md') ?? ''
    const [first] = blocksOf(text)
    expect(first).toBeDefined()
    const body = first?.body ?? ''
    const word = /[A-Za-z]{5,}/.exec(body)?.[0] ?? ''
    expect(word).not.toBe('')
    const id = first?.id ?? ''
    // One word changed inside the first block.
    const initial = word.slice(0, 1)
    const swapped = `${initial === initial.toLowerCase() ? initial.toUpperCase() : initial.toLowerCase()}${word.slice(1)}`
    const reworded = body.replace(word, () => swapped)
    expect(reworded).not.toBe(body)
    expect(problemsIn(text.replace(body, () => reworded))).toEqual([`${id}: sha256`])
    // The block cut short.
    expect(problemsIn(text.replace(body, () => body.slice(0, -2)))).toEqual([
      `${id}: size`,
      `${id}: sha256`,
    ])
    // Its end marker gone: the block no longer parses, and that is reported.
    const broken = problemsIn(text.replace(`<!-- plan-archive:end id="${id}" -->`, ''))
    expect(broken[0]).toMatch(/begin and \d+ end markers for \d+ whole blocks/)
  })

  it('is where every archive link in PLAN.md leads', () => {
    const plan = readFileSync(path.join(root, 'PLAN.md'), 'utf8')
    const targets = new Set(
      Array.from(
        plan.matchAll(/\]\((docs\/plan-archive\/[^)#\s]+)(?:#[^)]*)?\)/g),
        (match) => match[1] ?? '',
      ),
    )
    expect([...targets].toSorted((left, right) => left.localeCompare(right))).toEqual([
      'docs/plan-archive/decisions.md',
      'docs/plan-archive/gates.md',
      'docs/plan-archive/milestones.md',
    ])
    for (const target of targets) expect(existsSync(path.join(root, target))).toBe(true)
  })
})
