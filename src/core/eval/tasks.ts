// The M75 task set (PLAN.md D49): small repository fixtures, each with one
// planted defect and a verifier, split into accept tasks (mechanism work may
// tune against these) and held-out tasks (which judge it).
//
// A verifier is a Node ES module run after the turn, outside the workspace,
// so the model never sees it. It imports the fixed files and asserts what
// they do, so any correct fix passes however it is spelled. It exits 0 when
// the defect is fixed; an assertion or a thrown error fails it.

import * as z from 'zod/mini'
import { EVAL_SPLITS, type EvalSplit } from '../../shared/constants'

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
})
export type EvalTask = z.infer<typeof evalTaskSchema>

/** A fixture path: relative, forward slashes, no `.` or `..` segment. */
const EVAL_PATH_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/u

export function isEvalPath(path: string): boolean {
  const segments = new Set(path.split('/'))
  return EVAL_PATH_PATTERN.test(path) && !segments.has('.') && !segments.has('..')
}

/**
 * What every verifier starts with. It runs with the workspace as its first
 * argument and its own folder (beside the workspace) as the working folder,
 * where it may write scratch files.
 */
export const EVAL_VERIFY_PRELUDE = [
  "import assert from 'node:assert/strict'",
  "import { existsSync, readFileSync, writeFileSync } from 'node:fs'",
  "import { join } from 'node:path'",
  "import { pathToFileURL } from 'node:url'",
  'const workspace = process.argv[2]',
  'const load = (file) => import(pathToFileURL(join(workspace, file)).href)',
  "const read = (file) => readFileSync(join(workspace, file), 'utf8')",
  '',
].join('\n')

/** Every fixture is an ES module package, as a new Node project is. */
const PACKAGE_JSON = { path: 'package.json', content: '{\n  "type": "module"\n}\n' }

export const EVAL_TASKS: readonly EvalTask[] = [
  {
    id: 'accept-off-by-one',
    title: 'Fix the loop bound that reads past the end',
    split: 'accept',
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
]

/** The task set's slice for one split, in task-set order. */
export function evalTasksOfSplit(split: EvalSplit): readonly EvalTask[] {
  return EVAL_TASKS.filter((task) => task.split === split)
}
