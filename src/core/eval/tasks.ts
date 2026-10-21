// The M75 task set (PLAN.md D49): small repository fixtures, each with one
// planted defect and a verifier, split into accept tasks (mechanism work may
// tune against these) and held-out tasks (which judge it). Two (M73) read a
// long file whose middle record is needed after several more requests, so a
// mechanism for long outputs has something to act on. Two more (M101) carry
// their long log in the prompt itself, so the first request already fills
// the auto-compaction arm's window, and two carry two defects in one file
// for the multi-edit pair.
//
// A verifier is a Node ES module run after the turn, outside the workspace,
// so the model never sees it. It imports the fixed files and asserts what
// they do, so any correct fix passes however it is spelled. It reports
// completed assertions with a private run token; exit 0 alone cannot pass.
// An assertion or a thrown error fails it.

import * as z from 'zod/mini'
import {
  EVAL_COMPACT_BULK_LINE_CHARS,
  EVAL_COMPACT_BULK_LINES,
  EVAL_COMPACT_VALUE_LINE,
  EVAL_COMPACT_WINDOW_TOKENS,
  EVAL_LONG_EVIDENCE_LINE_CHARS,
  EVAL_LONG_EVIDENCE_LINES,
  EVAL_LONG_EVIDENCE_MIDDLE_LINE,
  EVAL_LONG_EVIDENCE_RECALL_OFFSET,
  EVAL_SPLITS,
  type EvalSplit,
} from '../../shared/constants'

export const evalFileSchema = z.object({
  path: z.string(),
  content: z.string(),
})

export const evalTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  split: z.enum(EVAL_SPLITS),
  /** The user's message for the turn. */
  prompt: z.string(),
  files: z.array(evalFileSchema),
  /** The verifier's body, after `EVAL_VERIFY_PRELUDE`. */
  verify: z.string(),
  /** Successful assertions required before the verifier can report completion. */
  assertions: z.number().check(z.int(), z.minimum(0)),
  /**
  Built so one tool output is long enough to pack and is needed again
  after it would be (M73): a packing arm must engage on it.
  */
  isLongOutput: z.optional(z.literal(true)),
  /**
  Built so the first request already fills nine tenths of the
  auto-compaction arm's window (M101): the prompt carries the long log
  itself, since file reads are capped at half a window in characters. An
  auto-compaction arm must engage on it.
  */
  isLongContext: z.optional(z.literal(true)),
})
export type EvalTask = z.infer<typeof evalTaskSchema>

/** A fixture path: relative, forward slashes, no `.` or `..` segment. */
const EVAL_PATH_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/u

export function isEvalPath(path: string): boolean {
  const segments = new Set(path.split('/'))
  return EVAL_PATH_PATTERN.test(path) && !segments.has('.') && !segments.has('..')
}

/**
What every verifier starts with. It runs with the workspace as its first
argument and its own folder (beside the workspace) as the working folder,
where it may write scratch files.
*/
export const EVAL_VERIFY_PRELUDE = [
  "import rawAssert from 'node:assert/strict'",
  "import { existsSync, readFileSync, writeFileSync, writeSync } from 'node:fs'",
  "import { join } from 'node:path'",
  "import { pathToFileURL } from 'node:url'",
  // Consume the private pipe before any solution loads; the token is never
  // in a file, argument, environment variable or model-visible workspace.
  "const completionToken = readFileSync(0, 'utf8')",
  'const verifierExit = process.exit',
  'const report = writeSync.bind(undefined, 1)',
  'const encode = JSON.stringify.bind(JSON)',
  'let assertions = 0',
  'let assertionFailed = false',
  'const counted = (check) => (...args) => {',
  '  try { check(...args); assertions += 1 }',
  '  catch (error) { assertionFailed = true; throw error }',
  '}',
  'const rejectCheck = rawAssert.rejects.bind(rawAssert)',
  'const assert = Object.freeze({',
  '  equal: counted(rawAssert.equal.bind(rawAssert)),',
  '  deepEqual: counted(rawAssert.deepEqual.bind(rawAssert)),',
  '  rejects: async (...args) => {',
  '    try { await rejectCheck(...args); assertions += 1 }',
  '    catch (error) { assertionFailed = true; throw error }',
  '  },',
  '})',
  'const complete = () => {',
  '  if (!assertionFailed && process.exit === verifierExit) report(`\\n${encode({ token: completionToken, assertions })}\\n`)',
  '}',
  'const workspace = process.argv[2]',
  'const load = (file) => import(pathToFileURL(join(workspace, file)).href)',
  "const read = (file) => readFileSync(join(workspace, file), 'utf8')",
  '',
].join('\n')

/** Every fixture is an ES module package, as a new Node project is. */
const PACKAGE_JSON = { path: 'package.json', content: '{\n  "type": "module"\n}\n' }

/**
A long evidence file (M73): numbered records padded to one width, with
the one that matters in the middle, outside the first and last lines a
packed placeholder keeps.
*/
function evidenceFile(middle: string): string {
  const lines = Array.from({ length: EVAL_LONG_EVIDENCE_LINES }, (_, index) =>
    (index + 1 === EVAL_LONG_EVIDENCE_MIDDLE_LINE
      ? middle
      : `record ${String(index + 1)}: ordinary fixture evidence`
    ).padEnd(EVAL_LONG_EVIDENCE_LINE_CHARS, '.'),
  )
  return `${lines.join('\n')}\n`
}

// Each phase read takes a request of its own, so the evidence has ridden
// whole twice before the answer is written: a packing arm has packed it.
const PHASE_FILES = [
  {
    path: 'phase-one.txt',
    content:
      'Read phase-two.txt next, in a separate response. Do not batch its read with this one.\n',
  },
  {
    path: 'phase-two.txt',
    content: `Recover line ${String(EVAL_LONG_EVIDENCE_MIDDLE_LINE)} of evidence.txt before writing the fix. If recall_output is offered, call it with the evidence output's id and offset ${String(EVAL_LONG_EVIDENCE_RECALL_OFFSET)}; otherwise read evidence.txt again. Use the record you recovered.\n`,
  },
]

const LONG_OUTPUT_PROMPT =
  'Read evidence.txt entirely first. Then read phase-one.txt and follow its instructions; each phase read must be a separate response. Recover the middle record as phase-two.txt directs, then'

/**
A long log carried by the prompt itself (M101): numbered lines padded to
one width, with the one that matters on the value line.
*/
function compactBulk(middle: string): string {
  const lines = Array.from({ length: EVAL_COMPACT_BULK_LINES }, (_, index) =>
    (index + 1 === EVAL_COMPACT_VALUE_LINE
      ? middle
      : `log ${String(index + 1)}: routine build output`
    ).padEnd(EVAL_COMPACT_BULK_LINE_CHARS, '.'),
  )
  return `${lines.join('\n')}\n`
}

const LONG_CONTEXT_PROMPT =
  'A long build log follows; one numbered line holds the record you need. Track the work with todo_write (one item per step below) and mark each item completed as you finish it. Recover the record first, then'

export const EVAL_TASKS: readonly EvalTask[] = [
  {
    id: 'accept-long-compaction',
    title: 'Recover a build number from a long log and record it',
    split: 'accept',
    assertions: 1,
    prompt: `${LONG_CONTEXT_PROMPT} create answer.js exporting the build number as the number answer. Do not write answer.js before recovering the record.\n\n${compactBulk('required_build=781924')}`,
    files: [PACKAGE_JSON],
    verify: ["const { answer } = await load('answer.js')", 'assert.equal(answer, 781924)'].join(
      '\n',
    ),
    isLongContext: true,
  },
  {
    id: 'heldout-long-compaction',
    title: 'Apply a rule from a long log to a transform',
    split: 'heldout',
    assertions: 4,
    prompt: `${LONG_CONTEXT_PROMPT} create transform.js exporting transform(value), which applies the record's mapping. Do not write transform.js before recovering the record.\n\n${compactBulk('required mapping: add 4 to the input, then multiply by 6')}`,
    files: [PACKAGE_JSON],
    verify: [
      "const { transform } = await load('transform.js')",
      'assert.equal(transform(-3), 6)',
      'assert.equal(transform(0), 24)',
      'assert.equal(transform(2), 36)',
      'assert.equal(transform(8), 72)',
    ].join('\n'),
    isLongContext: true,
  },
  {
    id: 'accept-long-middle-value',
    title: 'Recover a value from the middle of a long tool output',
    split: 'accept',
    assertions: 1,
    prompt: `${LONG_OUTPUT_PROMPT} create answer.js exporting the record's required value as the number answer. Do not write answer.js before recovering the record.`,
    files: [
      PACKAGE_JSON,
      { path: 'evidence.txt', content: evidenceFile('required_value=314159') },
      ...PHASE_FILES,
    ],
    verify: ["const { answer } = await load('answer.js')", 'assert.equal(answer, 314159)'].join(
      '\n',
    ),
    isLongOutput: true,
  },
  {
    id: 'heldout-long-middle-rule',
    title: 'Apply a rule from the middle of a long tool output',
    split: 'heldout',
    assertions: 4,
    prompt: `${LONG_OUTPUT_PROMPT} create transform.js exporting transform(value), which applies the record's mapping. Do not write transform.js before recovering the record.`,
    files: [
      PACKAGE_JSON,
      {
        path: 'evidence.txt',
        content: evidenceFile('required mapping: multiply the input by 7, then add 11'),
      },
      ...PHASE_FILES,
    ],
    verify: [
      "const { transform } = await load('transform.js')",
      'assert.equal(transform(-3), -10)',
      'assert.equal(transform(0), 11)',
      'assert.equal(transform(2), 25)',
      'assert.equal(transform(8), 67)',
    ].join('\n'),
    isLongOutput: true,
  },
  {
    id: 'accept-off-by-one',
    title: 'Fix the loop bound that reads past the end',
    split: 'accept',
    assertions: 2,
    prompt:
      'In total.js, sumAll steps one element past the end of items and adds undefined to the sum. Fix the loop bound so it visits exactly the elements of items.',
    files: [
      PACKAGE_JSON,
      {
        path: 'total.js',
        content:
          'export function sumAll(items) {\n  let sum = 0\n  for (let i = 0; i <= items.length; i += 1) {\n    sum += items[i]\n  }\n  return sum\n}\n',
      },
    ],
    verify: [
      "const { sumAll } = await load('total.js')",
      'assert.equal(sumAll([1, 2, 3]), 6)',
      'assert.equal(sumAll([]), 0)',
    ].join('\n'),
  },
  {
    id: 'accept-null-guard',
    title: 'Greet a friend when the name is missing',
    split: 'accept',
    assertions: 3,
    prompt:
      "In greet.js, greet throws when name is missing (undefined or null). Return 'Hello, friend!' in that case, and keep the greeting for a real name as it is.",
    files: [
      PACKAGE_JSON,
      {
        path: 'greet.js',
        content: "export function greet(name) {\n  return 'Hello, ' + name.trim() + '!'\n}\n",
      },
    ],
    verify: [
      "const { greet } = await load('greet.js')",
      "assert.equal(greet(), 'Hello, friend!')",
      "assert.equal(greet(null), 'Hello, friend!')",
      "assert.equal(greet('  Ada '), 'Hello, Ada!')",
    ].join('\n'),
  },
  {
    id: 'accept-await-read',
    title: 'Await the file read before parsing',
    split: 'accept',
    assertions: 1,
    prompt:
      'In load.js, loadConfig does not wait for the file read, so JSON.parse gets a promise instead of the text. Fix it.',
    files: [
      PACKAGE_JSON,
      {
        path: 'load.js',
        content:
          "import { readFile } from 'node:fs/promises'\n\nexport async function loadConfig(path) {\n  const text = readFile(path, 'utf8')\n  return JSON.parse(text)\n}\n",
      },
    ],
    verify: [
      "const { loadConfig } = await load('load.js')",
      "const file = join(process.cwd(), 'config.json')",
      'writeFileSync(file, JSON.stringify({ port: 8080 }))',
      'assert.deepEqual(await loadConfig(file), { port: 8080 })',
    ].join('\n'),
  },
  {
    id: 'accept-import-path',
    title: 'Point the import at the file that exists',
    split: 'accept',
    assertions: 2,
    prompt:
      'main.js fails to load: its import names ./util.js, but the helper lives in utils.js. Fix the import in main.js; do not add or rename files.',
    files: [
      PACKAGE_JSON,
      {
        path: 'main.js',
        content:
          "import { formatName } from './util.js'\n\nexport function label(user) {\n  return formatName(user)\n}\n",
      },
      {
        path: 'utils.js',
        content: "export function formatName(user) {\n  return user.first + ' ' + user.last\n}\n",
      },
    ],
    verify: [
      "assert.equal(existsSync(join(workspace, 'util.js')), false)",
      "const { label } = await load('main.js')",
      "assert.equal(label({ first: 'Ada', last: 'Lovelace' }), 'Ada Lovelace')",
    ].join('\n'),
  },
  {
    id: 'accept-no-secret',
    title: 'Read the API key from the environment',
    split: 'accept',
    assertions: 3,
    prompt:
      'config.js hardcodes an API key. Remove it and read the key from the MUSE_SPARK_API_KEY environment variable instead; keep retries as it is.',
    files: [
      PACKAGE_JSON,
      {
        path: 'config.js',
        content: "export const config = {\n  apiKey: 'hardcoded-demo-key',\n  retries: 3,\n}\n",
      },
    ],
    verify: [
      "process.env.MUSE_SPARK_API_KEY = 'from-the-environment'",
      "const { config } = await load('config.js')",
      "assert.equal(config.apiKey, 'from-the-environment')",
      'assert.equal(config.retries, 3)',
      "assert.equal(read('config.js').includes('hardcoded-demo-key'), false)",
    ].join('\n'),
  },
  {
    id: 'accept-empty-average',
    title: 'Return 0 for the average of nothing',
    split: 'accept',
    assertions: 2,
    prompt:
      'In average.js, average divides by zero for an empty array and returns NaN. Return 0 when values is empty.',
    files: [
      PACKAGE_JSON,
      {
        path: 'average.js',
        content:
          'export function average(values) {\n  const sum = values.reduce((a, b) => a + b, 0)\n  return sum / values.length\n}\n',
      },
    ],
    verify: [
      "const { average } = await load('average.js')",
      'assert.equal(average([]), 0)',
      'assert.equal(average([2, 4, 9]), 5)',
    ].join('\n'),
  },
  {
    id: 'heldout-strict-equal',
    title: 'Compare the role with strict equality',
    split: 'heldout',
    assertions: 3,
    prompt:
      "In auth.js, isAdmin uses loose equality, so a value that only converts to 'admin' gets in. Make it accept the string 'admin' only.",
    files: [
      PACKAGE_JSON,
      {
        path: 'auth.js',
        content: "export function isAdmin(role) {\n  return role == 'admin'\n}\n",
      },
    ],
    verify: [
      "const { isAdmin } = await load('auth.js')",
      "assert.equal(isAdmin('admin'), true)",
      "assert.equal(isAdmin(['admin']), false)",
      "assert.equal(isAdmin({ toString: () => 'admin' }), false)",
    ].join('\n'),
  },
  {
    id: 'heldout-clear-timer',
    title: 'Stop polling once the status is ready',
    split: 'heldout',
    assertions: 2,
    prompt:
      "In poll.js, polling goes on after the status is 'ready' and onDone runs again on every tick. Stop polling once it is ready, so onDone runs once; keep poll's parameters as they are.",
    files: [
      PACKAGE_JSON,
      {
        path: 'poll.js',
        content:
          "export function poll(fetchStatus, onDone, intervalMs = 1000) {\n  const timer = setInterval(async () => {\n    const status = await fetchStatus()\n    if (status === 'ready') {\n      onDone(status)\n    }\n  }, intervalMs)\n  return timer\n}\n",
      },
    ],
    verify: [
      "const { poll } = await load('poll.js')",
      'let checks = 0',
      'let done = 0',
      "const fetchStatus = () => { checks += 1; return Promise.resolve('ready') }",
      'const timer = poll(fetchStatus, () => { done += 1 }, 5)',
      'await new Promise((resolve) => setTimeout(resolve, 200))',
      'clearInterval(timer)',
      'assert.equal(done, 1)',
      'assert.equal(checks, 1)',
    ].join('\n'),
  },
  {
    id: 'heldout-sort-numbers',
    title: 'Sort numbers by value, smallest first',
    split: 'heldout',
    assertions: 1,
    prompt:
      'In ranking.js, ranking sorts the numbers as text, so 10 comes before 9. Sort them by value, smallest first.',
    files: [
      PACKAGE_JSON,
      {
        path: 'ranking.js',
        content: 'export function ranking(scores) {\n  return scores.sort()\n}\n',
      },
    ],
    verify: [
      "const { ranking } = await load('ranking.js')",
      'assert.deepEqual(ranking([10, 9, 1, 100, 25]), [1, 9, 10, 25, 100])',
    ].join('\n'),
  },
  {
    id: 'heldout-await-write',
    title: 'Await the settings write',
    split: 'heldout',
    assertions: 2,
    prompt:
      'In save.js, saveSettings does not wait for the write, so a failed write goes unnoticed and callers go on before the file is there. Fix it.',
    files: [
      PACKAGE_JSON,
      {
        path: 'save.js',
        content:
          "import { writeFile } from 'node:fs/promises'\n\nexport async function saveSettings(path, settings) {\n  writeFile(path, JSON.stringify(settings))\n}\n",
      },
    ],
    verify: [
      "const { saveSettings } = await load('save.js')",
      "const file = join(process.cwd(), 'settings.json')",
      "await saveSettings(file, { theme: 'dark' })",
      "assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { theme: 'dark' })",
      "await assert.rejects(saveSettings(join(process.cwd(), 'missing', 'settings.json'), {}))",
    ].join('\n'),
  },
  {
    id: 'accept-multi-edit',
    title: 'Fix the case of two helpers in one file',
    split: 'accept',
    assertions: 2,
    prompt:
      'In voice.js, shout lowercases the text when it should uppercase it, and whisper uppercases the text when it should lowercase it. Fix both helpers; keep the punctuation as it is.',
    files: [
      PACKAGE_JSON,
      {
        path: 'voice.js',
        content:
          "export function shout(text) {\n  return text.toLowerCase() + '!!!'\n}\n\nexport function whisper(text) {\n  return text.toUpperCase() + '...'\n}\n",
      },
    ],
    verify: [
      "const { shout, whisper } = await load('voice.js')",
      "assert.equal(shout('hey there'), 'HEY THERE!!!')",
      "assert.equal(whisper('HEY THERE'), 'hey there...')",
    ].join('\n'),
  },
  {
    id: 'heldout-multi-edit',
    title: 'Clamp both bounds without overshooting',
    split: 'heldout',
    assertions: 4,
    prompt:
      'In clamp.js, clampLow returns one above the minimum and clampHigh returns one below the maximum. Fix both helpers so each returns exactly its bound.',
    files: [
      PACKAGE_JSON,
      {
        path: 'clamp.js',
        content:
          'export function clampLow(value, min) {\n  return value < min ? min + 1 : value\n}\n\nexport function clampHigh(value, max) {\n  return value > max ? max - 1 : value\n}\n',
      },
    ],
    verify: [
      "const { clampLow, clampHigh } = await load('clamp.js')",
      'assert.equal(clampLow(3, 5), 5)',
      'assert.equal(clampLow(7, 5), 7)',
      'assert.equal(clampHigh(9, 5), 5)',
      'assert.equal(clampHigh(2, 5), 2)',
    ].join('\n'),
  },
]

/** The task set's slice for one split, in task-set order. */
export function evalTasksOfSplit(split: EvalSplit): readonly EvalTask[] {
  return EVAL_TASKS.filter((task) => task.split === split)
}

/**
The context window a task runs under, on every arm alike (M101 R2): the
evaluation window for a long-context task, so the first request fills it
and the arm can compact at its first settled tool boundary; undefined
elsewhere, so the driver keeps the shipped window (a long-output task's
evidence needs whole file reads). The window is harness condition, never
a mechanism: the frozen digest pins this rule's source and each task's
resolved window beside the arm behaviour.
*/
export function evalWindowTokens(task: EvalTask): number | undefined {
  return task.isLongContext === true ? EVAL_COMPACT_WINDOW_TOKENS : undefined
}
