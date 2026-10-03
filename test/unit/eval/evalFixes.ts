// Fixes for the M75 task set: what a correct run writes. The unit tests use
// them to prove every verifier accepts a fix (the canonical one and one
// spelled differently) and to script the fake Model API's correct runs.

import type { EvalTask } from '../../../src/core/eval/tasks'
import { MODEL_API_TOOLS } from '../../../src/shared/constants'
import type { ScriptedReply } from '../helpers/fakeModelApi'

export interface EvalFix {
  readonly path: string
  readonly content: string
}

/** Whole-file replacements per task id. */
export const EVAL_CANONICAL_FIXES: Readonly<Record<string, readonly EvalFix[]>> = {
  'accept-off-by-one': [
    {
      path: 'total.js',
      content:
        'export function sumAll(items) {\n  let sum = 0\n  for (let i = 0; i < items.length; i += 1) {\n    sum += items[i]\n  }\n  return sum\n}\n',
    },
  ],
  'accept-null-guard': [
    {
      path: 'greet.js',
      content:
        "export function greet(name) {\n  if (name == null) {\n    return 'Hello, friend!'\n  }\n  return 'Hello, ' + name.trim() + '!'\n}\n",
    },
  ],
  'accept-await-read': [
    {
      path: 'load.js',
      content:
        "import { readFile } from 'node:fs/promises'\n\nexport async function loadConfig(path) {\n  const text = await readFile(path, 'utf8')\n  return JSON.parse(text)\n}\n",
    },
  ],
  'accept-import-path': [
    {
      path: 'main.js',
      content:
        "import { formatName } from './utils.js'\n\nexport function label(user) {\n  return formatName(user)\n}\n",
    },
  ],
  'accept-no-secret': [
    {
      path: 'config.js',
      content:
        'export const config = {\n  apiKey: process.env.MUSE_SPARK_API_KEY,\n  retries: 3,\n}\n',
    },
  ],
  'accept-empty-average': [
    {
      path: 'average.js',
      content:
        'export function average(values) {\n  if (values.length === 0) {\n    return 0\n  }\n  const sum = values.reduce((a, b) => a + b, 0)\n  return sum / values.length\n}\n',
    },
  ],
  'heldout-strict-equal': [
    {
      path: 'auth.js',
      content: "export function isAdmin(role) {\n  return role === 'admin'\n}\n",
    },
  ],
  'heldout-clear-timer': [
    {
      path: 'poll.js',
      content:
        "export function poll(fetchStatus, onDone, intervalMs = 1000) {\n  const timer = setInterval(async () => {\n    const status = await fetchStatus()\n    if (status === 'ready') {\n      clearInterval(timer)\n      onDone(status)\n    }\n  }, intervalMs)\n  return timer\n}\n",
    },
  ],
  'heldout-sort-numbers': [
    {
      path: 'ranking.js',
      content: 'export function ranking(scores) {\n  return scores.sort((a, b) => a - b)\n}\n',
    },
  ],
  'heldout-await-write': [
    {
      path: 'save.js',
      content:
        "import { writeFile } from 'node:fs/promises'\n\nexport async function saveSettings(path, settings) {\n  await writeFile(path, JSON.stringify(settings))\n}\n",
    },
  ],
  'accept-long-middle-value': [{ path: 'answer.js', content: 'export const answer = 314159\n' }],
  'heldout-long-middle-rule': [
    { path: 'transform.js', content: 'export const transform = (value) => value * 7 + 11\n' },
  ],
}

/**
 * The same fixes in another spelling a model might choose: the verifiers
 * judge behaviour, so these pass too.
 */
export const EVAL_OTHER_FIXES: Readonly<Record<string, readonly EvalFix[]>> = {
  'accept-off-by-one': [
    {
      path: 'total.js',
      content:
        'export function sumAll(items) {\n  return items.reduce((sum, item) => sum + item, 0)\n}\n',
    },
  ],
  'accept-null-guard': [
    {
      path: 'greet.js',
      content:
        "export function greet(name) {\n  return name ? 'Hello, ' + name.trim() + '!' : 'Hello, friend!'\n}\n",
    },
  ],
  'accept-await-read': [
    {
      path: 'load.js',
      content:
        "import { readFile } from 'node:fs/promises'\n\nexport function loadConfig(path) {\n  return readFile(path, 'utf8').then((text) => JSON.parse(text))\n}\n",
    },
  ],
  'accept-import-path': [
    {
      path: 'main.js',
      content:
        'import * as utils from "./utils.js"\n\nexport function label(user) {\n  return utils.formatName(user)\n}\n',
    },
  ],
  'accept-no-secret': [
    {
      path: 'config.js',
      content:
        'const { MUSE_SPARK_API_KEY: apiKey } = process.env\n\nexport const config = { apiKey, retries: 3 }\n',
    },
  ],
  'accept-empty-average': [
    {
      path: 'average.js',
      content:
        'export function average(values) {\n  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0\n}\n',
    },
  ],
  'heldout-strict-equal': [
    {
      path: 'auth.js',
      content:
        "export function isAdmin(role) {\n  return typeof role === 'string' && role == 'admin'\n}\n",
    },
  ],
  'heldout-clear-timer': [
    {
      path: 'poll.js',
      content:
        "export function poll(fetchStatus, onDone, intervalMs = 1000) {\n  let isDone = false\n  const timer = setInterval(async () => {\n    if (isDone) return\n    const status = await fetchStatus()\n    if (status === 'ready') {\n      isDone = true\n      clearInterval(timer)\n      onDone(status)\n    }\n  }, intervalMs)\n  return timer\n}\n",
    },
  ],
  'heldout-sort-numbers': [
    {
      path: 'ranking.js',
      content:
        'export function ranking(scores) {\n  return [...scores].sort((left, right) => left - right)\n}\n',
    },
  ],
  'heldout-await-write': [
    {
      path: 'save.js',
      content:
        "import { writeFile } from 'node:fs/promises'\n\nexport function saveSettings(path, settings) {\n  return writeFile(path, JSON.stringify(settings))\n}\n",
    },
  ],
  'accept-long-middle-value': [
    { path: 'answer.js', content: 'const value = 314_159\n\nexport { value as answer }\n' },
  ],
  'heldout-long-middle-rule': [
    {
      path: 'transform.js',
      content: 'export function transform(value) {\n  return 11 + 7 * value\n}\n',
    },
  ],
}

/** The task's fixture files with the given fixes applied. */
export function withFixes(task: EvalTask, fixes: readonly EvalFix[]): EvalTask {
  const files = new Map(task.files.map((file) => [file.path, file.content] as const))
  for (const fix of fixes) {
    files.set(fix.path, fix.content)
  }
  return { ...task, files: [...files].map(([path, content]) => ({ path, content })) }
}

export function fixesFor(
  table: Readonly<Record<string, readonly EvalFix[]>>,
  task: EvalTask,
): readonly EvalFix[] {
  const fixes = table[task.id]
  if (fixes === undefined) {
    throw new Error(`no fix for eval task ${task.id}`)
  }
  return fixes
}

/** A reply that reads one file. */
export function readReply(path: string, callId: string): ScriptedReply {
  return { calls: [{ name: 'read_file', arguments: JSON.stringify({ path }), callId }] }
}

/**
 * A long-output task as the phases direct: read the evidence, then each
 * phase file in a request of its own, then recall the middle (or read the
 * evidence again without packing), then write the canonical fix.
 */
export function longTaskReplies(
  task: EvalTask,
  isPacking: boolean,
  offset: number,
): ScriptedReply[] {
  const [fix] = fixesFor(EVAL_CANONICAL_FIXES, task)
  if (fix === undefined) {
    throw new Error(`no canonical fix for ${task.id}`)
  }
  return [
    readReply('evidence.txt', 'evidence'),
    readReply('phase-one.txt', 'phase-one'),
    readReply('phase-two.txt', 'phase-two'),
    isPacking
      ? {
          calls: [
            {
              name: MODEL_API_TOOLS.recallOutput,
              arguments: JSON.stringify({ id: 'evidence', offset }),
              callId: 'recall',
            },
          ],
        }
      : readReply('evidence.txt', 'reread'),
    { calls: [{ name: 'write_file', arguments: JSON.stringify(fix) }] },
    { text: 'Recovered and fixed.' },
  ]
}
