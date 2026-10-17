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
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { CI_BOOTSTRAP_UNSET, CI_OUT_DIR } from '../../action/lib/ci-run.mjs'
import { completedResult, NODE, PROCESS_SUITE } from './helpers/actionFixtures'
import {
  agentReports,
  CI_KEY,
  ciPackage,
  ciTestLayout,
  cloneFor,
  hasKey,
  REPO_VERSION,
  systemEnv,
  type CiPackage,
} from './helpers/ciFixtures'
import { bootstrapOf, scriptOf, templateText } from './helpers/ciTemplateText'

const SYSTEMS = ['gitlab', 'azure', 'jenkins', 'bitbucket'] as const
const SHIMMED = ['date', 'curl', 'sha256sum', 'tar', 'mktemp', 'mkdir', 'git', 'cp']
const isPosix = process.platform !== 'win32'
const layout = ciTestLayout()

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
  const copyProbe = path.join(dir, 'cp')
  writeFileSync(
    copyProbe,
    [
      '#!/bin/sh',
      `env > '${log}/cp.'$$'.env'`,
      String.raw`printf '%s\n' "$@" > '${log}/cp.'$$'.args'`,
      'if [ -f "$1" ]; then',
      '  IFS= read -r muse_probe < "$1" || :',
      `  if [ "$muse_probe" = '${CI_KEY}' ]; then printf 'held-key' > '${log}/cp-input'; fi`,
      'fi',
      'PATH="${PATH#*:}"',
      'exec cp "$@"',
      '',
    ].join('\n'),
  )
  chmodSync(copyProbe, 0o755)
  // mktemp also records every directory it makes: the bootstrap calls it
  // once, and nothing else in the run shells out to the mktemp binary.
  const mktemp = path.join(dir, 'mktemp')
  writeFileSync(
    mktemp,
    [
      '#!/bin/sh',
      `env > '${log}/mktemp.'$$'.env'`,
      String.raw`printf '%s\n' "$@" > '${log}/mktemp.'$$'.args'`,
      'PATH="${PATH#*:}"',
      'result="$(mktemp "$@")"',
      `printf '%s\n' "$result" >> '${log}/mktemp-paths'`,
      String.raw`printf '%s\n' "$result"`,
      '',
    ].join('\n'),
  )
  chmodSync(mktemp, 0o755)
  return { dir, log }
}

/** Every temp directory the bootstrap's mktemp made during the run. */
function madeTemps(log: string): string[] {
  try {
    return readFileSync(path.join(log, 'mktemp-paths'), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
  } catch {
    return []
  }
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
  prepareWorkspace?: () => void,
): ScriptRun {
  const clone = cloneFor(system, layout())
  prepareWorkspace?.()
  const { dir, log } = shims()
  const result = spawnSync('sh', ['-xe', '-c', scriptOf(system)], {
    cwd: layout().workspace,
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${path.dirname(NODE)}:${process.env['PATH'] ?? ''}`,
      HOME: layout().root,
      TMPDIR: layout().runnerTemp,
      MUSE_CI_OUTPUT_ROOT: path.join(layout().root, 'output'),
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

/** The bootstrap's temp directory: its only mktemp call. */
function tempOf(log: string): string {
  const temps = madeTemps(log)
  if (temps.length !== 1 || temps[0] === undefined) {
    throw new Error(`expected one bootstrap temp, saw ${String(temps.length)}`)
  }
  return temps[0]
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
        readFileSync(path.join(layout().root, 'output', CI_OUT_DIR, 'outputs.json'), 'utf8'),
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
      const out = path.join(layout().root, 'output', CI_OUT_DIR)
      const files = readdirSync(out)
      for (const file of files) {
        expect(hasKey(readFileSync(path.join(out, file), 'utf8')), file).toBe(false)
      }
      // The launcher owns the temp directory now: nothing of it survives.
      expect(existsSync(tempOf(run.log))).toBe(false)
    },
  )

  it.each([...SYSTEMS])(
    '%s: aliases and an exported holder never reach a child (P1 finding 2)',
    (system) => {
      const pkg = ciPackage(layout().root, { exec: { result: completedResult() } })
      const run = runTemplate(system, pkg, {
        MUSE_SPARK_MODEL_API_KEY: CI_KEY,
        MUSE_CI_KEY_ALIASES:
          'RENAMED_BINDING ARBITRARY_ALIAS muse_cleanup_dir muse_rm_dir muse_setup muse_dir muse_start_ms muse_sum muse_alias',
        muse_cleanup_dir: CI_KEY,
        muse_rm_dir: CI_KEY,
        muse_dir: CI_KEY,
        muse_start_ms: CI_KEY,
        muse_sum: CI_KEY,
        RENAMED_BINDING: CI_KEY,
        ARBITRARY_ALIAS: CI_KEY,
        META_API_KEY: CI_KEY,
        muse_key: CI_KEY,
        muse_setup: CI_KEY,
        muse_alias: CI_KEY,
        muse_key_file: '/nonexistent-decoy',
      })
      for (const entry of shimLogs(run.log)) expect(hasKey(entry.text), entry.name).toBe(false)
      expect(run.status).toBe(0)
      const exec = agentReports(pkg).find((line) => line['command'] === 'exec' && 'keyLine' in line)
      expect(exec?.['keyLine']).toBe(CI_KEY)
      for (const entry of shimLogs(run.log)) expect(hasKey(entry.text), entry.name).toBe(false)
      expect(hasKey(run.output)).toBe(false)
      expect(existsSync(tempOf(run.log))).toBe(false)
    },
  )

  it.each(
    SYSTEMS.flatMap((system) =>
      [
        'muse_ci_internal_dir',
        'MUSE_CI_TEMP',
        'MUSE_CI_BOOTSTRAP_START_MS',
        'MUSE_INPUT_AGENT_PACKAGE',
        'MUSE_AGENT_VERSION',
      ].map((alias) => ({ system, alias })),
    ),
  )(
    'R6-P2-2: $system refuses reserved alias $alias before a bootstrap child starts',
    ({ system, alias }) => {
      const pkg = ciPackage(layout().root)
      const run = runTemplate(system, pkg, {
        MUSE_CI_KEY_ALIASES: alias,
        [alias]: CI_KEY,
      })
      expect(run.status).toBe(1)
      expect(run.output).toContain('muse-spark: invalid or reserved key alias name')
      expect(shimLogs(run.log)).toEqual([])
      expect(agentReports(pkg)).toEqual([])
      expect(hasKey(run.output)).toBe(false)
    },
  )

  it('R4-P1-1: GitLab File variable is read only by Node; no key file copying child', () => {
    const keyFile = path.join(layout().root, 'model-api-key')
    writeFileSync(keyFile, CI_KEY)
    const pkg = ciPackage(layout().root, { exec: { result: completedResult() } })
    const run = runTemplate('gitlab', pkg, {
      MUSE_MODEL_API_KEY: '',
      MUSE_MODEL_API_KEY_FILE: keyFile,
    })
    expect(existsSync(path.join(run.log, 'cp-input'))).toBe(false)
    expect(shimLogs(run.log).some((entry) => entry.name.startsWith('cp.'))).toBe(false)
    expect(run.status).toBe(0)
    const exec = agentReports(pkg).find((line) => line['command'] === 'exec' && 'keyLine' in line)
    expect(exec?.['keyLine']).toBe(CI_KEY)
    for (const entry of shimLogs(run.log)) {
      expect(hasKey(entry.text), entry.name).toBe(false)
      // The shells saw the path, never the value.
      if (entry.name.startsWith('mktemp.') || entry.name.startsWith('curl.')) {
        expect(entry.text).not.toContain(CI_KEY)
      }
    }
    expect(hasKey(run.output)).toBe(false)
  })

  it.each([...SYSTEMS])(
    'R4-P1-3: %s early bootstrap failure never selects repository artifacts',
    (system) => {
      const pkg = ciPackage(layout().root)
      // runTemplate creates the clone first; the shim's first-child probe sees
      // every exported alias. The planted directory models files restored by checkout.
      const run = runTemplate(system, pkg, { MUSE_AGENT_VERSION: '' }, () => {
        const planted = path.join(layout().workspace, CI_OUT_DIR)
        mkdirSync(planted)
        writeFileSync(path.join(planted, 'outputs.json'), '{"status":"completed","exit-code":"0"}')
      })
      expect(run.status).toBe(1)
      expect(existsSync(path.join(layout().root, 'output', CI_OUT_DIR))).toBe(false)
      const template = templateText(system)
      switch (system) {
        case 'gitlab': {
          expect(template).not.toContain('  artifacts:')
          break
        }
        case 'bitbucket': {
          expect(template).not.toContain('        artifacts:')
          break
        }
        case 'azure': {
          expect(template).toContain('publish: $(Agent.TempDirectory)/')
          expect(template).toContain("eq(variables['MUSE_CI_OUTPUT_READY'], 'true')")
          break
        }
        default: {
          expect(template).toContain('dir(env.MUSE_CI_OUTPUT_ROOT)')
          break
        }
      }
    },
  )

  it('R4-P2-7: malformed launcher facts clean the whole bootstrap after exec', () => {
    const pkg = ciPackage(layout().root)
    const run = runTemplate('jenkins', pkg, { GIT_COMMIT: 'malformed' })
    expect(run.status).toBe(1)
    expect(existsSync(tempOf(run.log))).toBe(false)
    expect(agentReports(pkg)).toEqual([])
  })

  it('R4-P2-7: module-load failure keeps an exit owner before importing the proposal', () => {
    const pkg = ciPackage(layout().root, { missingLauncherModule: 'ci-adapters.mjs' })
    const run = runTemplate('gitlab', pkg)
    expect(run.status).toBe(1)
    expect(run.output).toContain('the launcher could not start')
    expect(existsSync(tempOf(run.log))).toBe(false)
    expect(agentReports(pkg)).toEqual([])
    for (const entry of shimLogs(run.log)) expect(hasKey(entry.text), entry.name).toBe(false)
  })

  it('a tarball whose digest differs is never unpacked or run (finding 3)', () => {
    const pkg = ciPackage(layout().root, { exec: { result: completedResult() } })
    const run = runTemplate('gitlab', pkg, { MUSE_INPUT_AGENT_PACKAGE_SHA256: 'e'.repeat(64) })
    expect(run.status).toBe(1)
    expect(run.output).toContain('muse-spark: the agent package does not match')
    expect(shimLogs(run.log).some((entry) => entry.name.startsWith('tar.'))).toBe(false)
    expect(agentReports(pkg)).toEqual([])
    expect(existsSync(path.join(layout().root, 'output', CI_OUT_DIR))).toBe(false)
    // The trap owns the temp directory on the digest failure path too.
    expect(existsSync(tempOf(run.log))).toBe(false)
  })

  it.each([...SYSTEMS])(
    'R6-P2-2: %s parent cleanup survives alias unsetting under sh, dash and bash',
    (system) => {
      const lines = bootstrapOf(system)
        .split('\n')
        .map((line) => line.trim())
      const start = lines.findIndex((line) => /^muse_(?:ci_internal_)?start_ms="\$\{/.test(line))
      const trap = lines.findLastIndex((line) => line.startsWith("trap '("))
      expect(start).toBeGreaterThan(-1)
      expect(trap).toBeGreaterThan(start)
      const parent = lines.slice(start, trap + 1).join('\n')
      const setupName = /\$\{([A-Za-z_][A-Za-z0-9_]*)%%:\*\}/.exec(parent)?.[1]
      if (setupName === undefined) throw new Error('missing bootstrap result holder')
      // dash is a Linux runner check; macOS ships sh/bash without dash.
      const shells = process.platform === 'linux' ? ['sh', 'dash', 'bash'] : ['sh', 'bash']
      for (const shell of shells) {
        const dir = path.join(layout().root, `trap-temp-${shell}`)
        mkdirSync(dir, { mode: 0o700 })
        const aliases = [
          'muse_cleanup_dir',
          'muse_rm_dir',
          'muse_setup',
          'muse_dir',
          'muse_start_ms',
          'muse_sum',
          'muse_alias',
        ]
        const result = spawnSync(
          shell,
          [
            '-e',
            '-c',
            [
              'set -eu',
              `${setupName}="1700000000000:${dir}"`,
              parent,
              'muse-spark-exec-probe-missing-binary',
            ].join('\n'),
          ],
          {
            encoding: 'utf8',
            env: {
              PATH: process.env['PATH'],
              MUSE_MODEL_API_KEY: CI_KEY,
              MUSE_CI_KEY_ALIASES: aliases.join(' '),
              ...Object.fromEntries(aliases.map((name) => [name, CI_KEY])),
            },
          },
        )
        expect(result.status).toBe(127)
        expect(`${result.stdout}${result.stderr}`).not.toMatch(/unbound variable|parameter not set/)
        expect(existsSync(dir), `${shell} left ${dir} behind`).toBe(false)
      }
    },
  )

  it('R6-P2-2: generated unset names cannot touch reserved parent holders', () => {
    expect(CI_BOOTSTRAP_UNSET.some((name: string) => name.startsWith('muse_ci_internal_'))).toBe(
      false,
    )
    for (const system of SYSTEMS) {
      const body = bootstrapOf(system)
      const holders = Array.from(
        body.matchAll(/\b(muse_ci_internal_[a-z_]+)=/g),
        (match) => match[1],
      )
      expect(holders.length).toBeGreaterThan(0)
      for (const name of holders) expect(CI_BOOTSTRAP_UNSET).not.toContain(name)
    }
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
