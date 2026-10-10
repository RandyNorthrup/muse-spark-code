// Lane CM80CI-R2: each template's exact shell, as its system runs it, under
// `sh -xe` (Jenkins' own flags, tracing on) in the system's clone, against a
// local package tarball and the fake agent. curl, sha256sum, tar, mktemp,
// mkdir and git are recording shims, so every program the script and the
// launcher's Git start shows its environment and argv; a fabricated key is
// planted in the system's secret variable and must reach the agent's exec
// stdin and nothing else. POSIX only: the templates run on Linux runners.

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { CI_OUT_DIR } from '../../action/lib/ci-run.mjs'
import {
  completedResult,
  NODE,
  PROCESS_SUITE,
  tempLayout,
  type TempLayout,
} from './helpers/actionFixtures'
import {
  agentReports,
  CI_KEY,
  ciPackage,
  cloneFor,
  hasKey,
  REPO_VERSION,
  systemEnv,
  type CiPackage,
} from './helpers/ciFixtures'
import { scriptOf, templateText } from './helpers/ciTemplateText'

const SYSTEMS = ['gitlab', 'azure', 'jenkins', 'bitbucket'] as const
const SHIMMED = ['curl', 'sha256sum', 'tar', 'mktemp', 'mkdir', 'git']
const isPosix = process.platform !== 'win32'
const state: { layout?: TempLayout } = {}

beforeEach(() => {
  state.layout = tempLayout()
})

afterEach(() => {
  state.layout?.cleanup()
})

function layout(): TempLayout {
  if (state.layout === undefined) throw new Error('no layout')
  return state.layout
}

/** Recording shims ahead of the real programs: each logs its env and argv, then runs the real one. */
function shims(): { dir: string; log: string } {
  const dir = path.join(layout().root, 'shims')
  const log = path.join(layout().root, 'shim-log')
  mkdirSync(dir)
  mkdirSync(log)
  for (const name of SHIMMED) {
    const file = path.join(dir, name)
    writeFileSync(
      file,
      [
        '#!/bin/sh',
        `env > '${log}/${name}.'$$'.env'`,
        String.raw`printf '%s\n' "$@" > '${log}/${name}.'$$'.args'`,
        'PATH="${PATH#*:}"',
        `exec ${name} "$@"`,
        '',
      ].join('\n'),
    )
    chmodSync(file, 0o755)
  }
  return { dir, log }
}

/** The template's own variables, as GitLab and Azure put them in the environment. */
function declaredVariables(system: string): Record<string, string> {
  if (system !== 'gitlab' && system !== 'azure') return {}
  const variables = (parse(templateText(system)) as { variables: Record<string, unknown> })
    .variables
  return Object.fromEntries(Object.entries(variables).map(([name, value]) => [name, String(value)]))
}

interface ScriptRun {
  status: number | null
  output: string
  log: string
}

function runTemplate(
  system: string,
  pkg: CiPackage,
  extra: Record<string, string> = {},
): ScriptRun {
  const clone = cloneFor(system, layout())
  const { dir, log } = shims()
  const result = spawnSync('sh', ['-xe', '-c', scriptOf(system)], {
    cwd: layout().workspace,
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${path.dirname(NODE)}:${process.env['PATH'] ?? ''}`,
      HOME: layout().root,
      ...declaredVariables(system),
      ...systemEnv(system, layout(), clone),
      MUSE_AGENT_VERSION: REPO_VERSION,
      MUSE_AGENT_URL: pathToFileURL(pkg.tarball).href,
      MUSE_INPUT_AGENT_PACKAGE_SHA256: pkg.sha256,
      MUSE_INPUT_MAX_BUDGET_USD: '1.00',
      MUSE_MODEL_API_KEY: CI_KEY,
      ...extra,
    },
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}`, log }
}

function shimLogs(log: string): { name: string; text: string }[] {
  return readdirSync(log).map((name) => ({
    name,
    text: readFileSync(path.join(log, name), 'utf8'),
  }))
}

describe.runIf(isPosix)('the exact template scripts', PROCESS_SUITE, () => {
  it.each([...SYSTEMS])(
    '%s: the key reaches exec’s stdin and no program’s environment, argv or log',
    (system) => {
      const pkg = ciPackage(layout().root, { exec: { result: completedResult() } })
      const run = runTemplate(system, pkg)
      expect(run.output).not.toContain('muse-spark: ')
      expect(run.status).toBe(0)
      const outputs = JSON.parse(
        readFileSync(path.join(layout().workspace, CI_OUT_DIR, 'outputs.json'), 'utf8'),
      ) as Record<string, string>
      expect(outputs).toMatchObject({ status: 'completed', 'exit-code': '0' })
      const exec = agentReports(pkg).find((line) => line['command'] === 'exec' && 'keyLine' in line)
      expect(exec?.['keyLine']).toBe(CI_KEY)
      expect(hasKey(JSON.stringify(exec?.['env']))).toBe(false)
      expect(hasKey(JSON.stringify(exec?.['args']))).toBe(false)
      const logs = shimLogs(run.log)
      for (const name of ['curl', 'sha256sum', 'tar', 'mktemp', 'git']) {
        expect(
          logs.some((entry) => entry.name.startsWith(`${name}.`)),
          name,
        ).toBe(true)
      }
      for (const entry of logs) expect(hasKey(entry.text), entry.name).toBe(false)
      expect(hasKey(run.output)).toBe(false)
      const out = path.join(layout().workspace, CI_OUT_DIR)
      const files = readdirSync(out)
      for (const file of files) {
        expect(hasKey(readFileSync(path.join(out, file), 'utf8')), file).toBe(false)
      }
    },
  )

  it('a tarball whose digest differs is never unpacked or run (finding 3)', () => {
    const pkg = ciPackage(layout().root, { exec: { result: completedResult() } })
    const run = runTemplate('gitlab', pkg, { MUSE_INPUT_AGENT_PACKAGE_SHA256: 'e'.repeat(64) })
    expect(run.status).toBe(1)
    expect(run.output).toContain('muse-spark: the agent package does not match')
    expect(shimLogs(run.log).some((entry) => entry.name.startsWith('tar.'))).toBe(false)
    expect(agentReports(pkg)).toEqual([])
    expect(existsSync(path.join(layout().workspace, CI_OUT_DIR))).toBe(false)
  })

  it('an unpinned template refuses before downloading', () => {
    const pkg = ciPackage(layout().root)
    const run = runTemplate('azure', pkg, { MUSE_AGENT_VERSION: '' })
    expect(run.status).toBe(1)
    expect(run.output).toContain('muse-spark: pin MUSE_AGENT_VERSION')
    expect(shimLogs(run.log)).toEqual([])
  })

  it('Bitbucket keeps an explicitly empty budget, which the launcher refuses (finding 11)', () => {
    const pkg = ciPackage(layout().root, { exec: { result: completedResult() } })
    const run = runTemplate('bitbucket', pkg, { MUSE_INPUT_MAX_BUDGET_USD: '' })
    expect(run.status).toBe(1)
    expect(run.output).toContain('max-budget-usd must be a plain decimal number of USD')
    expect(agentReports(pkg)).toEqual([])
  })
})
