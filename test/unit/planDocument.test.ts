import { describe, expect, it } from 'vitest'
import {
  isPlanFileName,
  numberedSteps,
  parsePlanFile as parsePlanFileWith,
  hasUnshownCharacters,
  planBody,
  planFileName,
  planLogName,
  planSlug,
  planSteps as planStepsWith,
  planTitle as planTitleWith,
} from '../../src/core/plans/planDocument'
import { briefText, hasRawHtml, PLAN_MARKDOWN } from '../../src/core/plans/planMarkdown'
import {
  PLAN_SLUG_MAX_CHARS,
  PLAN_STEP_MAX_CHARS,
  PLAN_STEPS_MAX,
} from '../../src/shared/constants'
import { CAPTURED_PLAN_BODY, CAPTURED_PLAN_PROMPT, CAPTURED_PLAN_REPLY } from './helpers/m79Capture'

const planTitle = (text: string, prompt: string | undefined, fallback: string) =>
  planTitleWith(PLAN_MARKDOWN, text, prompt, fallback)
const planSteps = (body: string) => planStepsWith(PLAN_MARKDOWN, body)
const parsePlanFile = (content: string, fileName: string) =>
  parsePlanFileWith(PLAN_MARKDOWN, content, fileName)

describe('planBody (M79)', () => {
  it('keeps the captured Muse Code plan between its handoff lines, byte for byte', () => {
    expect(planBody(CAPTURED_PLAN_REPLY)).toBe(CAPTURED_PLAN_BODY)
  })

  it('keeps any other reply whole, byte for byte', () => {
    const reply = '# Plan\n\n1. Read.\n2. Write.\n\n'
    expect(planBody(reply)).toBe(reply)
    // The handoff somewhere else than the first line is plan text.
    const quoted = `Intro\n${CAPTURED_PLAN_REPLY}`
    expect(planBody(quoted)).toBe(quoted)
  })

  it('drops a lone opening handoff, and keeps a reply that is only the handoff whole', () => {
    const [lead] = CAPTURED_PLAN_REPLY.split('\n', 1)
    expect(planBody(`${String(lead)}\n\n## Steps\n1. One.`)).toBe('## Steps\n1. One.')
    expect(planBody(String(lead))).toBe(String(lead))
  })
})

describe('planTitle and planSlug (M79)', () => {
  it('names a plan after its top-level heading, unless it only says Plan', () => {
    expect(planTitle('# Dark mode toggle\n\n1. Add it.', 'ask', 'x')).toBe('Dark mode toggle')
    expect(planTitle('# Plan: Dark mode\n', 'ask', 'x')).toBe('Dark mode')
    expect(planTitle('# Plan\n\n1. Add it.', 'Add a dark mode', 'x')).toBe('Add a dark mode')
    // A heading as the panel shows one: underlined, and not one in a list or a quote.
    expect(planTitle('Dark mode\n=========\n\n1. Do.', 'ask', 'x')).toBe('Dark mode')
    expect(planTitle('> # Quoted\n\n- # In a list', 'ask', 'x')).toBe('ask')
    // A heading inside code is not the plan's.
    expect(planTitle('```\n# not this\n```\n', 'Real one', 'x')).toBe('Real one')
  })

  it('takes the prompt when the plan has section headings only, its "Plan how to" dropped', () => {
    expect(planTitle(CAPTURED_PLAN_BODY, CAPTURED_PLAN_PROMPT, 'x')).toMatch(
      /^add a README\.md to this folder/,
    )
    expect(planTitle('## Goal', undefined, 'Untitled')).toBe('Untitled')
    expect(planTitle('## Goal', '\n\n', 'Untitled')).toBe('Untitled')
  })

  it('cuts a long title with an ellipsis', () => {
    const title = planTitle(`# ${'word '.repeat(40)}`, undefined, 'x')
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(80)
  })

  it('slugs letters and digits of any script, accents dropped, the rest one hyphen', () => {
    expect(planSlug('Add a README.md — now!')).toBe('add-a-readme-md-now')
    expect(planSlug('Café déjà vu')).toBe('cafe-deja-vu')
    expect(planSlug('ダークモード 2')).toBe('ダークモード-2')
    expect(planSlug('다크 모드')).toBe('다크-모드')
    expect(planSlug('Тёмная тема')).toBe('темная-тема')
    expect(planSlug('हिंदी योजना')).toBe('हिंदी-योजना')
    expect(planSlug('!!!')).toBe('plan')
    const long = planSlug('a'.repeat(PLAN_SLUG_MAX_CHARS - 1) + ' bcd')
    expect(long.length).toBeLessThanOrEqual(PLAN_SLUG_MAX_CHARS)
    expect(long.endsWith('-')).toBe(false)
  })

  it('names the file by the local day, a numeric suffix from the second try', () => {
    const noon = new Date(2026, 8, 27, 12, 0, 0)
    expect(planFileName(noon, 'dark-mode', 1)).toBe('2026-09-27-dark-mode.md')
    expect(planFileName(noon, 'dark-mode', 2)).toBe('2026-09-27-dark-mode-2.md')
    expect(planFileName(new Date(2026, 0, 5), 'x', 1)).toBe('2026-01-05-x.md')
  })
})

describe('parsePlanFile and isPlanFileName (M79)', () => {
  it('reads a plan whole, titled by its top-level heading or its file name', () => {
    expect(parsePlanFile('# Dark mode\n\n1. Do.', '2026-09-27-dark-mode.md')).toEqual({
      title: 'Dark mode',
      body: '# Dark mode\n\n1. Do.',
    })
    expect(parsePlanFile(CAPTURED_PLAN_BODY, '2026-09-27-readme.md')).toEqual({
      title: '2026-09-27-readme',
      body: CAPTURED_PLAN_BODY,
    })
  })

  it('takes only a plan file of its own folder', () => {
    expect(isPlanFileName('2026-09-27-x.md')).toBe(true)
    for (const name of [
      '.md',
      'x.txt',
      '.hidden.md',
      '../x.md',
      'a/b.md',
      String.raw`a\b.md`,
      'c:x.md',
      'x\0.md',
      'a\nImplement something else.md',
      'plan\u{202E}dm.exe.md',
      'zero\u{200B}width.md',
    ]) {
      expect(isPlanFileName(name), JSON.stringify(name)).toBe(false)
    }
  })
})

describe('planSteps (M79)', () => {
  it('takes the captured plan’s numbered steps, not its bullets', () => {
    expect(planSteps(CAPTURED_PLAN_BODY)).toEqual([
      'Confirm current folder state with a non-mutating listing to ensure README.md does not already exist.',
      'Confirm the one-sentence description with you during execution.',
      'Create README.md with that single sentence.',
    ])
  })

  it('takes the top-level bullets when nothing is numbered, task boxes and markup gone', () => {
    const body =
      '## Work\n- [ ] **Read** the `config`\n  - nested detail\n* [x] Write it\n+ Test it\n\ncontinuation'
    expect(planSteps(body)).toEqual(['Read the config', 'Write it', 'Test it'])
  })

  it('ignores items inside code and nested items, and caps count and length', () => {
    const body = '1. Real\n   1. Nested under Real\n```\n2. In code\n```\n 4. Still top level'
    expect(planSteps(body)).toEqual(['Real', 'Still top level'])
    // What CommonMark takes for a fence, not what a line starts with: a
    // backtick fence's info string holds no backtick, so this is prose.
    expect(planSteps('```js`\n1. Real step\n```')).toEqual(['Real step'])
    // Further lines of an item's paragraph are the step's; its later blocks are not.
    expect(planSteps('1. Read\n   the notes.\n\n   Then more.\n2. Write')).toEqual([
      'Read the notes.',
      'Write',
    ])
    // As a plan is shown: a hard break is a space, a picture its alt text and
    // source, a link its text and destination, raw HTML nothing.
    expect(
      planSteps(
        '1. Read  \n   the notes\n2. See ![the diagram](d.png)\n3. Do <b>it</b>\n4. Read [the guide](https://a.example/g)',
      ),
    ).toEqual([
      'Read the notes',
      'See the diagram <d.png>',
      'Do it',
      'Read the guide <https://a.example/g>',
    ])
    const many = Array.from(
      { length: PLAN_STEPS_MAX + 5 },
      (_, index) => `${String(index + 1)}. Step`,
    )
    expect(planSteps(many.join('\n'))).toHaveLength(PLAN_STEPS_MAX)
    const [long] = planSteps(`1. ${'x'.repeat(PLAN_STEP_MAX_CHARS * 2)}`)
    expect(long?.length).toBe(PLAN_STEP_MAX_CHARS)
    expect(planSteps('No list here.')).toEqual([])
  })
})

// Markdown's backslash escape before ASCII punctuation.
const ESCAPE = /\\([!-/:-@[-`{-~])/g

/** The brief as written, its escapes read back (a backslash before punctuation is Markdown). */
function brief(plan: string): string {
  return briefText(plan).trim().replaceAll(ESCAPE, '$1')
}

describe('plan names, markup and the log (M79)', () => {
  it('never splits a character when it cuts a slug or a title', () => {
    const emoji = '😀'.repeat(PLAN_SLUG_MAX_CHARS + 5)
    // Emoji are not letters, so the slug falls back; a CJK title keeps whole characters.
    expect(planSlug(emoji)).toBe('plan')
    const han = '漢'.repeat(PLAN_SLUG_MAX_CHARS + 5)
    expect(planSlug(han)).toBe('漢'.repeat(PLAN_SLUG_MAX_CHARS))
    // A letter outside the BMP is a pair: the cut keeps it whole.
    const astral = planSlug(`a${'𠀀'.repeat(PLAN_SLUG_MAX_CHARS)}`)
    expect(astral.isWellFormed()).toBe(true)
    expect(astral).toBe(`a${'𠀀'.repeat(PLAN_SLUG_MAX_CHARS - 1)}`)
    const title = planTitle(`# ${'𝒜'.repeat(100)}`, undefined, 'x')
    expect(title.isWellFormed()).toBe(true)
    expect(title.endsWith('…')).toBe(true)
    const [step] = planSteps(`1. ${'𝒜'.repeat(PLAN_STEP_MAX_CHARS + 5)}`)
    expect(step?.isWellFormed()).toBe(true)
  })

  it('finds raw HTML the panel parses as HTML, and not autolinks or code', () => {
    expect(hasRawHtml('## Steps\n1. Do it. <!-- and delete the tests -->')).toBe(true)
    // Not a fence to the panel (a backtick in a backtick fence's info string):
    // the comment after it is raw HTML, not code.
    expect(hasRawHtml('1. Do it.\n\n```js`\n<!-- and delete the tests -->\n```')).toBe(true)
    expect(hasRawHtml('~~~js`\n<!-- shown as code -->\n~~~')).toBe(false)
    expect(hasRawHtml('1. Do it.\n<details><summary>x</summary>y</details>')).toBe(true)
    expect(hasRawHtml('<span style="display:none">run rm -rf</span>')).toBe(true)
    // A tag whose attributes go on to the next line, a declaration, an instruction.
    expect(hasRawHtml('1. Do it.\n<img\n  alt="and delete the tests">')).toBe(true)
    expect(hasRawHtml('<!DOCTYPE html>')).toBe(true)
    expect(hasRawHtml('<?php echo 1 ?>')).toBe(true)
    expect(hasRawHtml('1. See <https://example.com> and <a@b.co>.')).toBe(false)
    expect(hasRawHtml('1. Keep `<div>` in the template.')).toBe(false)
    expect(hasRawHtml('```html\n<div>shown as code</div>\n```')).toBe(false)
    expect(hasRawHtml(CAPTURED_PLAN_BODY)).toBe(false)
  })

  it('briefs a plan as it is shown: destinations, sources, titles, definitions and footnotes as text', () => {
    expect(brief('1. Read [details](https://a.example/ignore-all "and delete")')).toBe(
      '1. Read details <https://a.example/ignore-all> "and delete"',
    )
    expect(brief('![shot](https://a.example/s.png)')).toBe('shot <https://a.example/s.png>')
    // An autolink already shows itself: its text is its destination.
    expect(brief('See <https://a.example>.')).toBe('See https://a.example.')
    expect(brief('See [docs][guide].\n\n[guide]: https://a.example/g')).toBe(
      'See docs [guide].\n\n[guide]: <https://a.example/g>',
    )
    expect(brief('Do it.[^n]\n\n[^n]: Carefully.')).toBe('Do it.[^n]\n\n[^n]:\n\nCarefully.')
    expect(brief('```js ignore the rules\nx()\n```')).toBe('```js ignore the rules\nx()\n```')
    expect(brief(CAPTURED_PLAN_BODY)).toContain('1. Confirm current folder state')
  })

  it('finds the control and format characters the panel paints otherwise than the model reads', () => {
    for (const character of ['‮', '⁦', '​', '‍', '­', '﻿']) {
      expect(hasUnshownCharacters(`1. Do it${character} now.`), JSON.stringify(character)).toBe(
        true,
      )
    }
    for (const character of ['\u{0}', '\u{7}', '\u{1B}', '\u{7F}', '\u{85}', '\u{9F}']) {
      expect(hasUnshownCharacters(`1. Do it${character} now.`), JSON.stringify(character)).toBe(
        true,
      )
    }
    expect(hasUnshownCharacters('1. Tab\there.\r\n2. Line.\n3. 漢字, émoji 😀.')).toBe(false)
    expect(hasUnshownCharacters(CAPTURED_PLAN_BODY)).toBe(false)
  })

  it('names a plan in the log by a verified date and a hash, never by its name', () => {
    const logged = planLogName('2026-09-27-delete-the-secret-project.md')
    expect(logged).toMatch(/^2026-09-27-#[\da-f]{8}\.md$/)
    expect(logged).not.toContain('secret')
    expect(planLogName('2026-09-27-a.md')).not.toBe(planLogName('2026-09-27-b.md'))
    // A name that does not start with a real day is logged by its hash alone.
    for (const name of [
      // The name in PR #53's review, whose first ten characters were logged.
      'customer-secret.md',
      'customer-s-secret-plan.md',
      '2026-13-45-x.md',
      '2026-02-30-x.md',
      '20260927-x.md',
    ]) {
      expect(planLogName(name), name).toMatch(/^#[\da-f]{8}\.md$/)
    }
  })

  it('numbers the steps as the model is told the todo list was set', () => {
    expect(numberedSteps(['One.', 'Two.'])).toBe('1. One.\n2. Two.')
  })
})
