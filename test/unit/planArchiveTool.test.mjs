// scripts/plan-archive.mjs and scripts/lib/planArchive.mjs: moving passages of
// PLAN.md into docs/plan-archive/ byte for byte (CONTRIBUTING.md, "Archiving
// closed history from PLAN.md"). The text rules run in memory; the command
// runs against a small plan committed in a throwaway repository, through the
// real plan reader.
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  addToArchive,
  archiveBlocks,
  archiveProblems,
  linesOf,
  PLAN_ARCHIVE_AT_PERCENT,
  PLAN_ARCHIVE_FILES,
  putBack,
  renderBlock,
  sectionOf,
  sha256,
  takeOut,
  topLevelBlocks,
  wrapProse,
} from '../../scripts/lib/planArchive.mjs'
import { fixtureGitEnvironment } from './helpers/fixtureGit'

const root = path.resolve(import.meta.dirname, '../..')
const COMMIT = 'abc1234de'

const PLAN = `# Fixture plan

## 2. Resolved decisions

### D1 — Backends (M12, 2026-10-05)

Use the selected backend.

The first design paragraph, which is record.

- A list item that is record,
  - with a nested item under it,

  and a paragraph of its own.

1. An ordered item.

2. A second ordered item.

| Budget | Value |
| ------ | ----- |
| cap    | 10    |

\`\`\`md
### not a heading

still inside the fence
\`\`\`

## 3. Open questions

- **Q-M12 — Choose the target (2026-10-05).**
  The owner chooses the target.

## 6. Milestones

### M12 — Fixture contracts (D1)

**Status 2026-10-05: planned.**

A paragraph of lane history.

- **Goal.** A stable contract.

A paragraph the goal field takes in.

- [x] A recorded fixture.

## 7. Gates

**LANE1 verification (2026-10-01).** The first record.

No live calls were made.

**LANE0 verification (2026-09-30).** An older record.

No live calls were made.

**LANE2 verification (2026-10-02).** The second record.
`

const RECORD = 'The first design paragraph, which is record.'
const LIST = ['- A list item that is record,', '  and a paragraph of its own.']
const HISTORY = 'A paragraph of lane history.'
const SWALLOWED = 'A paragraph the goal field takes in.'
const CHECKED = '- [x] A recorded fixture.'
const LANE2 = '**LANE2 verification (2026-10-02).** The second record.'
const REPEATED = 'No live calls were made.'

/** The 1-based, inclusive lines from the line that is `first` to the line that is `last`. */
function span(first, last = first, plan = PLAN) {
  const lines = plan.split('\n')
  return { first: lines.indexOf(first) + 1, last: lines.indexOf(last) + 1 }
}
const text = (range) =>
  `${PLAN.split('\n')
    .slice(range.first - 1, range.last)
    .join('\n')}\n`
const numbers = (range) => `${String(range.first)}-${String(range.last)}`
const pointer = (name) => `- **Archived.** The record that stood here is in [${name}](${name}).`
const block = (id) => renderBlock({ id, firstLine: 1, lastLine: 1, at: COMMIT, body: `${id}\n` })

describe('plan archive: text rules', () => {
  it('keeps a list item with what is indented under it, an ordered list whole, a fence closed', () => {
    const lines = PLAN.split('\n')
    const blocks = topLevelBlocks(lines).map((block) => lines.slice(block.start, block.end))
    expect(blocks).toContainEqual([
      '- A list item that is record,',
      '  - with a nested item under it,',
      '',
      '  and a paragraph of its own.',
    ])
    expect(blocks).toContainEqual(['1. An ordered item.', '', '2. A second ordered item.'])
    expect(blocks).toContainEqual([
      '```md',
      '### not a heading',
      '',
      'still inside the fence',
      '```',
    ])
    // Headings are blocks of their own, and the fenced line is not one of them.
    expect(
      topLevelBlocks(lines)
        .filter((block) => block.isHeading)
        .map((block) => lines[block.start]),
    ).toEqual([
      '# Fixture plan',
      '## 2. Resolved decisions',
      '### D1 — Backends (M12, 2026-10-05)',
      '## 3. Open questions',
      '## 6. Milestones',
      '### M12 — Fixture contracts (D1)',
      '## 7. Gates',
    ])
  })

  it('takes whole blocks out and puts them back, byte for byte', () => {
    const stub = ['A paragraph that says where it went.']
    const ranges = [{ ...span(RECORD), stub }, span(...LIST), span(LANE2)]
    // Adjacent blocks move as two ranges or as one; both come back the same.
    const merged = [{ first: ranges[0].first, last: ranges[1].last, stub }, span(LANE2)]
    for (const chosen of [ranges, merged, ranges.toReversed()]) {
      const taken = takeOut(PLAN, chosen)
      const inOrder = chosen.toSorted((left, right) => left.first - right.first)
      expect(taken.moves.map((move) => move.body)).toEqual(inOrder.map((range) => text(range)))
      expect(taken.moves.map((move) => chosen[move.range])).toEqual(inOrder)
      expect(taken.text).toContain(
        'Use the selected backend.\n\nA paragraph that says where it went.\n\n1. An ordered item.\n',
      )
      // The last block of the file leaves one final newline, not a blank line.
      expect(taken.text.endsWith(`An older record.\n\n${REPEATED}\n`)).toBe(true)
      expect(taken.text).not.toMatch(/\n\n\n/)
      expect(
        putBack(
          taken.text,
          taken.moves,
          taken.moves.map((move) => move.body),
        ),
      ).toBe(PLAN)
    }
  })

  it('leaves a stub at the end of the file without a blank line after it', () => {
    const taken = takeOut(PLAN, [{ ...span(LANE2), stub: ['- **Archived.** Elsewhere.'] }])
    expect(taken.text.endsWith(`${REPEATED}\n\n- **Archived.** Elsewhere.\n`)).toBe(true)
    expect(putBack(taken.text, taken.moves, [text(span(LANE2))])).toBe(PLAN)
  })

  it.each([
    ['a nested item alone', span('  - with a nested item under it,'), 'does not start a top-level'],
    [
      'a list item without what hangs under it',
      span(LIST[0], '  - with a nested item under it,'),
      'does not end a top-level block',
    ],
    ['one item of an ordered list', span('1. An ordered item.'), 'does not end a top-level block'],
    ['half a table', span('| Budget | Value |', '| ------ | ----- |'), 'does not end'],
    ['a line inside a fence', span('still inside the fence'), 'does not start a top-level'],
    [
      'a heading',
      span('### M12 — Fixture contracts (D1)', '**Status 2026-10-05: planned.**'),
      'headings stay',
    ],
    ['lines past the end', { first: 9000, last: 9001 }, 'outside the file'],
  ])('refuses %s', (_name, range, message) => {
    expect(() => takeOut(PLAN, [range])).toThrow(message)
  })

  it('refuses overlapping ranges', () => {
    expect(() => takeOut(PLAN, [span(RECORD), span(RECORD)])).toThrow('overlaps')
  })

  it('finds where a passage stands in the plan of the commit a marker names', () => {
    expect(linesOf(PLAN, text(span(RECORD)))).toEqual([span(RECORD).first])
    expect(linesOf(PLAN, text(span(...LIST)))).toEqual([span(...LIST).first])
    expect(linesOf(PLAN, '# Fixture plan\n')).toEqual([1])
    expect(linesOf(PLAN, `${LANE2}\n`)).toEqual([span(LANE2).first])
    expect(linesOf(PLAN, `${REPEATED}\n`)).toEqual([
      span(REPEATED).first,
      PLAN.split('\n').lastIndexOf(REPEATED) + 1,
    ])
    // Whole lines only: the end of one line or the start of another is not the passage.
    expect(linesOf(PLAN, 'which is record.\n')).toEqual([])
    expect(linesOf(PLAN, 'A paragraph of lane\n')).toEqual([])
  })

  it('knows the section a line stands in', () => {
    expect(sectionOf(PLAN, span(HISTORY).first)).toEqual([
      span('### M12 — Fixture contracts (D1)').first,
      span('## 7. Gates').first - 1,
    ])
    // A heading inside a fence does not end the section; the last one runs to the end.
    expect(sectionOf(PLAN, span('still inside the fence').first)).toEqual([
      span('### D1 — Backends (M12, 2026-10-05)').first,
      span('## 3. Open questions').first - 1,
    ])
    expect(sectionOf(PLAN, span(LANE2).first)).toEqual([
      span('## 7. Gates').first,
      PLAN.split('\n').length,
    ])
  })

  it('writes a block whose marker carries its size and hash, and notices any change', () => {
    const body = 'A passage.\n\n- with a list\n'
    const id = 'decisions-abc1234de-12'
    const rendered = renderBlock({ id, firstLine: 12, lastLine: 14, at: COMMIT, body })
    expect(rendered).toBe(
      `<!-- plan-archive:begin id="${id}" lines="12-14" at="${COMMIT}" bytes="26" sha256="${sha256(body)}" -->\n\n${body}\n<!-- plan-archive:end id="${id}" -->\n`,
    )
    // A block of the first move carries no commit; it reads the same way.
    const older = renderBlock({ id: '7-0001', firstLine: 1, lastLine: 3, body })
    expect(older).not.toContain(' at=')
    const file = `# Archive\n\n${rendered}\n${older}`
    expect(archiveBlocks(file).map((block) => [block.id, block.at, block.body])).toEqual([
      [id, COMMIT, body],
      ['7-0001', undefined, body],
    ])
    expect(archiveProblems(file)).toEqual([])
    expect(archiveProblems(file.replace('A passage.', 'A Passage.'))).toEqual([`${id}: sha256`])
    expect(archiveProblems(file.replace('- with a list\n', '- with a list\nmore\n'))).toEqual([
      `${id}: size`,
      `${id}: sha256`,
    ])
    expect(archiveProblems(file.replace('id="7-0001" lines', () => `id="${id}" lines`))).toEqual([
      '2 begin and 2 end markers for 1 whole blocks',
    ])
    expect(archiveProblems(`${file}\n${older}`)).toEqual(['7-0001: id used twice'])
  })

  it('adds blocks under their heading, new or already there', () => {
    const first = addToArchive('# Archive\n\nIntroduction.\n', 'D1 — Backends', [block('a')])
    expect(first).toBe(`# Archive\n\nIntroduction.\n\n## D1 — Backends\n\n${block('a')}`)
    const second = addToArchive(first, 'D2 — Later', [block('b')])
    const third = addToArchive(second, 'D1 — Backends', [block('c'), block('d')])
    expect(third).toBe(
      `# Archive\n\nIntroduction.\n\n## D1 — Backends\n\n${block('a')}\n${block('c')}\n${block('d')}\n## D2 — Later\n\n${block('b')}`,
    )
    expect(archiveProblems(third)).toEqual([])
  })

  it('wraps a summary without starting a line on something Markdown reads as a block', () => {
    const lines = wrapProse(
      `Timed sends are superseded by the later decision and nothing else changes in this one, see item 15) and item 16) of the list - not the others > at all # ever. ${'word '.repeat(40)}`,
    )
    expect(lines.length).toBeGreaterThan(3)
    for (const line of lines) expect(line).not.toMatch(/^(?:\d+[.)]|[-+*>#|])/)
    expect(lines.join(' ')).toContain('item 15) and item 16)')
  })

  it('names the three archive files and the same line as the gate', () => {
    expect(Object.values(PLAN_ARCHIVE_FILES)).toEqual([
      'docs/plan-archive/decisions.md',
      'docs/plan-archive/gates.md',
      'docs/plan-archive/milestones.md',
    ])
    const gate = readFileSync(path.join(root, 'scripts/check-plan.mjs'), 'utf8')
    expect(/const PLAN_ARCHIVE_AT_PERCENT = (\d+)\n/.exec(gate)?.[1]).toBe(
      String(PLAN_ARCHIVE_AT_PERCENT),
    )
  })
})

describe('plan-archive command', () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'plan-archive-'))
  const file = (name) => path.join(folder, name)
  const read = (name) => readFileSync(file(name), 'utf8')
  const DECISIONS = PLAN_ARCHIVE_FILES.decisions
  const GATES = PLAN_ARCHIVE_FILES.gates
  const MILESTONES = PLAN_ARCHIVE_FILES.milestones
  // A throwaway repository: nothing inherited that steers Git.
  const env = fixtureGitEnvironment({
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  })
  function git(...args) {
    const result = spawnSync('git', args, { cwd: folder, env, encoding: 'utf8', windowsHide: true })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }
  function run(...args) {
    return spawnSync(
      process.execPath,
      [path.join(root, 'scripts/plan-archive.mjs'), ...args, '--root', folder],
      { env, encoding: 'utf8', windowsHide: true },
    )
  }
  /** The moved blocks of an archive file as [lines, commit, text]. */
  const blocksIn = (name) =>
    archiveBlocks(read(name)).map((block) => [
      `${String(block.firstLine)}-${String(block.lastLine)}`,
      block.at,
      block.body,
    ])
  let head = ''

  beforeAll(() => {
    git('init', '-q')
    git('config', 'user.name', 'Plan archive test')
    git('config', 'user.email', 'plan-archive@example.invalid')
    writeFileSync(file('PLAN.md'), PLAN)
    git('add', 'PLAN.md')
    git('commit', '-q', '-m', 'fixture')
    head = git('rev-parse', '--short=9', 'HEAD')
  })
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true })
  })
  beforeEach(() => {
    mkdirSync(file('docs/plan-archive'), { recursive: true })
    writeFileSync(file('PLAN.md'), PLAN)
    for (const name of Object.values(PLAN_ARCHIVE_FILES)) writeFileSync(file(name), '# Archive\n')
    writeFileSync(file('summary.txt'), 'The selected backend is used, and item\n15) of nothing.\n')
  })

  const record = span(RECORD)
  const list = span(...LIST)
  const decision = [
    'move',
    'decisions',
    '--heading',
    'D1 — Backends (M12, 2026-10-05)',
    '--lines',
    `${numbers(record)},${numbers(list)}`,
    '--summary',
    file('summary.txt'),
  ]
  const SUMMARY = `The selected backend is used, and item 15) of nothing. Full record:\n[${DECISIONS}](${DECISIONS}).\n`

  it('reports the size against the bound and the gate, and every archive file intact', () => {
    const result = run('status')
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(
      /^PLAN\.md: \d+ bytes, 0\.0% of the plan reader's 4194304-byte bound\ngate \(check:plan\): 85% = 3565158 bytes; \d+ bytes of room\n/,
    )
    expect(result.stdout).toContain(`${GATES}: 10 bytes, 0 hashed blocks, all intact`)
  })

  it('prints the whole report on a dry run and writes nothing', () => {
    const result = run(...decision, '--dry-run')
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`before  PLAN.md: ${String(Buffer.byteLength(PLAN))} bytes`)
    expect(result.stdout).toMatch(/after {3}PLAN\.md: \d+ bytes/)
    expect(result.stdout).toContain(
      `archive ${DECISIONS} under "## D1 — Backends (M12, 2026-10-05)"`,
    )
    expect(result.stdout).toContain(
      `block   decisions-${head}-${String(record.first)}  lines ${numbers(record)} at ${head}  ${String(Buffer.byteLength(text(record)))} bytes  sha256 ${sha256(text(record))}`,
    )
    expect(result.stdout).toContain(
      `block   decisions-${head}-${String(list.first)}  lines ${numbers(list)} at ${head}`,
    )
    expect(result.stdout).toContain(
      `moved   2 blocks, ${String(Buffer.byteLength(text(record) + text(list)))} bytes`,
    )
    expect(result.stdout).toContain(
      `reassembly: identical to the old PLAN.md (sha256 ${sha256(PLAN)})`,
    )
    expect(result.stdout).toContain('parsed facts: identical; format drift after: 0')
    expect(result.stdout).toContain('dry run: nothing written')
    expect(read('PLAN.md')).toBe(PLAN)
    expect(read(DECISIONS)).toBe('# Archive\n')
  })

  it('moves a decision record and leaves its summary with the link', () => {
    const result = run(...decision)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    // The summary's own line break before "15)" is gone: no line may start like a list item.
    expect(read('PLAN.md')).toContain(
      `Use the selected backend.\n\n${SUMMARY}\n1. An ordered item.\n`,
    )
    expect(
      read(DECISIONS).startsWith(
        '# Archive\n\n## D1 — Backends (M12, 2026-10-05)\n\n<!-- plan-archive:begin ',
      ),
    ).toBe(true)
    expect(blocksIn(DECISIONS)).toEqual([
      [numbers(record), head, text(record)],
      [numbers(list), head, text(list)],
    ])
    expect(run('status').status).toBe(0)
    // An edit inside an archived block is what `status` (and the suite that hashes the real files) is for.
    writeFileSync(file(DECISIONS), read(DECISIONS).replace('which is record', 'which was record'))
    const broken = run('status')
    expect(broken.status).toBe(1)
    expect(broken.stdout).toContain(`decisions-${head}-${String(record.first)}: sha256`)
  })

  it('gives a second move before a commit the line numbers of the commit', () => {
    expect(run(...decision).status).toBe(0)
    // PLAN.md is shorter now, so the paragraph stands on another line of it than in the commit.
    const now = span(HISTORY, HISTORY, read('PLAN.md'))
    expect(now.first).not.toBe(span(HISTORY).first)
    const history = run(
      'move',
      'milestones',
      '--heading',
      'M12 — Fixture contracts (D1)',
      '--lines',
      numbers(now),
      '--pointer',
    )
    expect(history.status).toBe(0)
    // History above a field is no fact of the plan.
    expect(history.stdout).toContain('parsed facts: identical')
    expect(blocksIn(MILESTONES)).toEqual([[numbers(span(HISTORY)), head, `${HISTORY}\n`]])
    expect(read('PLAN.md')).toContain(
      `**Status 2026-10-05: planned.**\n\n${pointer(MILESTONES)}\n\n- **Goal.** A stable contract.\n`,
    )
    // A passage the commit holds twice has no line numbers of its own there.
    const before = read('PLAN.md')
    const twice = run(
      'move',
      'gates',
      '--heading',
      'LANE1',
      '--lines',
      numbers(span(REPEATED, REPEATED, before)),
      '--pointer',
    )
    expect(twice.status).toBe(1)
    expect(twice.stdout).toContain(`the passage stands 2 times in PLAN.md at ${head}`)
    expect(read('PLAN.md')).toBe(before)
    expect(read(GATES)).toBe('# Archive\n')
  })

  it('needs the commit that has the text a merge brought in', () => {
    // The plan being edited has a paragraph HEAD does not have.
    const merged = PLAN.replace(
      `${HISTORY}\n`,
      () => `${HISTORY}\n\nA design record from a branch.\n`,
    )
    writeFileSync(file('PLAN.md'), merged)
    const lines = numbers(span('A design record from a branch.', undefined, merged))
    const args = ['move', 'decisions', '--heading', 'D2 — A branch', '--lines', lines, '--pointer']
    const absent = run(...args)
    expect(absent.status).toBe(1)
    expect(absent.stdout).toContain(`the passage stands 0 times in PLAN.md at ${head}`)
    const unknown = run(...args, '--at', COMMIT)
    expect(unknown.status).toBe(2)
    expect(unknown.stderr).toContain(`no PLAN.md at commit "${COMMIT}"`)
    expect(read('PLAN.md')).toBe(merged)
    // The branch's commit has it, on its own line there.
    git('checkout', '-q', '-b', 'branch')
    const branch = PLAN.replace(
      '# Fixture plan\n',
      '# Fixture plan\n\nA design record from a branch.\n',
    )
    writeFileSync(file('PLAN.md'), branch)
    git('commit', '-q', '-a', '-m', 'design')
    const design = git('rev-parse', '--short=9', 'HEAD')
    git('checkout', '-q', '-')
    writeFileSync(file('PLAN.md'), merged)
    expect(run(...args, '--at', 'branch').status).toBe(0)
    expect(blocksIn(DECISIONS)).toEqual([['3-3', design, 'A design record from a branch.\n']])
    expect(read(DECISIONS)).toContain(`id="decisions-${design}-3"`)
    expect(read('PLAN.md')).toBe(
      merged.replace('A design record from a branch.', () => pointer(DECISIONS)),
    )
  })

  it('moves a gate record at the end of the file with a pointer line', () => {
    const gate = span(LANE2)
    const result = run('move', 'gates', '--heading', 'LANE2', '--lines', numbers(gate), '--pointer')
    expect(result.status).toBe(0)
    expect(read('PLAN.md').endsWith(`${REPEATED}\n\n${pointer(GATES)}\n`)).toBe(true)
    expect(blocksIn(GATES)).toEqual([[numbers(gate), head, `${LANE2}\n`]])
  })

  it('stops when the plan reader would parse something else, unless told the milestone is closed', () => {
    const args = [
      'move',
      'milestones',
      '--heading',
      'M12',
      '--lines',
      numbers(span(SWALLOWED)),
      '--pointer',
    ]
    const refused = run(...args)
    expect(refused.status).toBe(1)
    expect(refused.stdout).toContain('parsed facts: CHANGED in milestones: M12')
    expect(refused.stdout).toContain('Nothing written')
    expect(read('PLAN.md')).toBe(PLAN)
    expect(read(MILESTONES)).toBe('# Archive\n')
    const allowed = run(...args, '--allow-fact-change')
    expect(allowed.status).toBe(0)
    expect(read('PLAN.md')).not.toContain(SWALLOWED)
    expect(read(MILESTONES)).toContain(SWALLOWED)
  })

  it('leaves nothing behind only where the section already links to the archive', () => {
    const args = (plan) => [
      'move',
      'milestones',
      '--heading',
      'M12',
      '--lines',
      numbers(span(CHECKED, CHECKED, plan)),
      '--linked',
      '--allow-fact-change',
    ]
    const unlinked = run(...args(PLAN))
    expect(unlinked.status).toBe(1)
    expect(unlinked.stdout).toContain(
      `PROBLEM "M12": --linked, but nothing left in the section around line ${String(span(CHECKED).first)} links to ${MILESTONES}`,
    )
    expect(read('PLAN.md')).toBe(PLAN)
    expect(
      run('move', 'milestones', '--heading', 'M12', '--lines', numbers(span(HISTORY)), '--pointer')
        .status,
    ).toBe(0)
    const pointed = read('PLAN.md')
    expect(run(...args(pointed)).status).toBe(0)
    expect(read('PLAN.md')).toBe(pointed.replace(`${CHECKED}\n\n`, ''))
    expect(blocksIn(MILESTONES).map((block) => block[2])).toEqual([`${HISTORY}\n`, `${CHECKED}\n`])
    expect(run('status').status).toBe(0)
  })

  it('stops on a move that leaves a milestone without its status row', () => {
    const status = run(
      'move',
      'milestones',
      '--heading',
      'M12',
      '--lines',
      numbers(span('**Status 2026-10-05: planned.**')),
      '--pointer',
      '--allow-fact-change',
    )
    expect(status.status).toBe(1)
    expect(status.stdout).toContain('format drift after: 1')
    expect(read('PLAN.md')).toBe(PLAN)
  })

  it('takes a list of moves in the line numbers of one PLAN.md', () => {
    const gate = span(LANE2)
    const history = span(HISTORY)
    const moves = [
      { to: 'gates', heading: 'LANE2', lines: numbers(gate), pointer: true },
      {
        to: 'decisions',
        heading: 'D1 — Backends (M12, 2026-10-05)',
        lines: `${numbers(list)},${numbers(record)}`,
        summary: 'The selected backend is used, and item\n15) of nothing.\n',
      },
      { to: 'milestones', heading: 'M12', lines: numbers(history), pointer: true },
      { to: 'milestones', heading: 'M12', lines: numbers(span(SWALLOWED)), linked: true },
    ]
    writeFileSync(file('moves.json'), JSON.stringify(moves))
    const refused = run('move', '--batch', file('moves.json'))
    expect(refused.status).toBe(1)
    expect(refused.stdout).toContain('parsed facts: CHANGED in milestones: M12')
    expect(read('PLAN.md')).toBe(PLAN)
    const result = run('move', '--batch', file('moves.json'), '--allow-fact-change')
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('moved   5 blocks, ')
    expect(blocksIn(DECISIONS)).toEqual([
      [numbers(record), head, text(record)],
      [numbers(list), head, text(list)],
    ])
    expect(blocksIn(GATES)).toEqual([[numbers(gate), head, `${LANE2}\n`]])
    expect(blocksIn(MILESTONES)).toEqual([
      [numbers(history), head, `${HISTORY}\n`],
      [numbers(span(SWALLOWED)), head, `${SWALLOWED}\n`],
    ])
    expect(read('PLAN.md')).toBe(
      PLAN.replace(`${text(record)}\n${text(list)}`, () => SUMMARY)
        .replace(HISTORY, () => pointer(MILESTONES))
        .replace(`${SWALLOWED}\n\n`, '')
        .replace(LANE2, () => pointer(GATES)),
    )
    expect(run('status').status).toBe(0)
    // One bad range stops the whole list.
    writeFileSync(file('PLAN.md'), PLAN)
    writeFileSync(
      file('moves.json'),
      JSON.stringify([moves[0], { ...moves[2], lines: numbers(gate) }]),
    )
    const overlapping = run('move', '--batch', file('moves.json'))
    expect(overlapping.status).toBe(1)
    expect(overlapping.stderr).toContain('overlaps the range before it')
    expect(read('PLAN.md')).toBe(PLAN)
  })

  it('refuses part of a block with the reason, and bad usage with exit 2', () => {
    const nested = run(
      'move',
      'decisions',
      '--heading',
      'D1',
      '--lines',
      numbers(span('  - with a nested item under it,')),
      '--pointer',
    )
    expect(nested.status).toBe(1)
    expect(nested.stderr).toContain('does not start a top-level block')
    const usage = (...args) => {
      const result = run(...args)
      expect(result.status).toBe(2)
      return result.stderr
    }
    expect(
      usage('move', 'decisions', '--heading', 'D1', '--lines', '1-2', '--pointer', '--linked'),
    ).toContain('exactly one of --summary <file>, --pointer and --linked')
    expect(usage('move', 'decisions', '--heading', 'D1', '--lines', '1-2')).toContain('exactly one')
    expect(usage('move', 'elsewhere', '--heading', 'D1', '--lines', '1-2', '--pointer')).toContain(
      'decisions, gates or milestones',
    )
    expect(usage('move', 'gates', '--heading', 'D1', '--lines', 'ten', '--pointer')).toContain(
      'is not <first>-<last>',
    )
    expect(usage('move', 'gates', '--lines', '1-2', '--pointer')).toContain('heading')
    expect(usage('move', 'gates', '--batch', file('summary.txt'))).toContain('--batch carries')
    expect(usage('move', '--batch', file('summary.txt'))).toContain('JSON list of moves')
    expect(usage('remove')).toContain('plan-archive status')
    expect(usage('status', '--force')).toContain('unknown option --force')
    expect(read('PLAN.md')).toBe(PLAN)
  })
})
