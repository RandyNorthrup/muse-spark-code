// The four other-CI templates as a person runs them: the generated shared
// bootstrap must match its one source, the GitLab/Azure default variables
// must parse through the launcher's real grammar, Azure's declared job
// timeout must satisfy the launcher's real remaining-time admission, and
// the shipped shell must refuse an unpinned run and clean its temp
// directory when Node is missing, executed by the real shells. Vendor
// rules text is not asserted line by line (the owner's no-stand-ins rule:
// tests that only check text exists were deleted repo-wide); what each
// vendor's mechanism does needs a hosted receipt
// (docs/real-life/unproven.md).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { checkJobDeadline, CI_PUBLISHED_FILES, parseCiInputs } from '../../action/lib/ci-run.mjs'
import { bootstrapOf, bootstrapSource, templateText } from './helpers/ciTemplateText'

const SYSTEMS = ['gitlab', 'azure', 'jenkins', 'bitbucket'] as const
const CI_KEY = `LLM_${'c'.repeat(28)}`
const isPosix = process.platform !== 'win32'

type Yaml = Record<string, unknown>

function yamlOf(name: string): Yaml {
  return parse(templateText(name)) as Yaml
}

function record(value: unknown): Yaml {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected a mapping')
  }
  return value as Yaml
}

function normalize(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
}

/** The shells this machine really has, of the ones the templates run under. */
function shells(): string[] {
  return ['sh', 'bash', 'dash'].filter(
    (shell) => spawnSync(shell, ['-c', 'true'], { encoding: 'utf8' }).error === undefined,
  )
}

describe('one bootstrap, generated from one source into every template', () => {
  it.each([...SYSTEMS])(
    '%s: generated bootstrap matches its source and key-name list',
    (system) => {
      expect(normalize(bootstrapOf(system))).toBe(
        normalize(bootstrapSource().split('@MUSE_SYSTEM@').join(system)),
      )
    },
  )
})

describe('template defaults through the launcher’s own grammar', () => {
  it.each(['gitlab', 'azure'] as const)('%s defaults parse with parseCiInputs', (system) => {
    const variables = record(yamlOf(system)['variables'])
    const env = Object.fromEntries(
      Object.entries(variables).map(([name, value]) => [name, String(value)]),
    )
    const inputs = parseCiInputs(
      {
        ...env,
        MUSE_INPUT_AGENT_PACKAGE: '/tmp/agent.tgz',
        MUSE_INPUT_AGENT_PACKAGE_SHA256: 'f'.repeat(64),
      },
      system,
    )
    expect(inputs).toMatchObject({
      mode: 'review',
      maxBudgetUsd: '2.00',
      maxRequests: 30,
      timeoutMinutes: 20,
      trustPullRequests: false,
    })
  })

  it('Azure: the key arrives only through a variable group the change cannot modify', () => {
    // The group (with its branch-control check) is defined outside the
    // repository, so YAML pushed by a change under test cannot rebind the
    // key; the job condition is only a second layer.
    const document = yamlOf('azure')
    const job = record((document['jobs'] as unknown[])[0])
    const variables = job['variables'] as unknown[]
    expect(
      variables.some(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry as Yaml)['group'] === 'muse-spark-secrets',
      ),
    ).toBe(true)
  })

  it('Azure: the declared job timeout covers a 20-minute turn under checkJobDeadline', () => {
    const document = yamlOf('azure')
    const job = record((document['jobs'] as unknown[])[0])
    const declared = Number(record(document['variables'])['MUSE_CI_JOB_TIMEOUT_MINUTES'])
    expect(job['timeoutInMinutes']).toBe(declared)
    const now = Date.now()
    expect(() => {
      checkJobDeadline(
        {
          MUSE_CI_JOB_TIMEOUT_MINUTES: String(declared),
          MUSE_CI_BOOTSTRAP_START_MS: String(now - 120_000),
        },
        'azure',
        { timeoutMinutes: 20 },
        now,
      )
    }).not.toThrow()
  })
})

describe('result transport out of external temp', () => {
  // GitLab and Bitbucket upload only paths inside the clone, so both
  // templates declare exactly the publisher's fixed filenames (the real
  // CI_PUBLISHED_FILES list), never a directory glob.
  const published = [...CI_PUBLISHED_FILES].map((file) => `muse-spark-out/${file}`)

  it('GitLab declares the five published files as always-uploaded artifacts', () => {
    const job = record(record(yamlOf('gitlab'))['muse-spark'])
    expect(record(job['artifacts'])['paths']).toEqual(published)
  })

  it('Bitbucket declares the five published files as step artifacts', () => {
    const definitions = record(record(yamlOf('bitbucket'))['definitions'])
    const steps = record((definitions['steps'] as unknown[])[0])['step']
    expect(record(steps)['artifacts']).toEqual(published)
  })
})

describe.runIf(isPosix)('the shipped bootstrap under the real shells', () => {
  it.each([...SYSTEMS])(
    '%s: an unpinned bootstrap refuses before downloading, with no shell parse failure',
    (system) => {
      for (const shell of shells()) {
        const result = spawnSync(shell, ['-c', bootstrapOf(system)], {
          encoding: 'utf8',
          env: {
            PATH: process.env['PATH'] ?? '',
            MUSE_AGENT_VERSION: '',
            MUSE_INPUT_AGENT_PACKAGE_SHA256: '',
          },
        })
        const output = `${result.stdout}${result.stderr}`
        expect(result.status, shell).toBe(1)
        expect(output, shell).toContain('muse-spark: pin MUSE_AGENT_VERSION')
        expect(output, shell).not.toMatch(/syntax error/)
      }
    },
  )

  it.each([...SYSTEMS])(
    '%s: parent cleanup survives alias unsetting and a missing Node keeps 127',
    (system) => {
      const lines = bootstrapOf(system)
        .split('\n')
        .map((line) => line.trim())
      // The probe selects the trap's one bounded removal up front; it runs
      // first so the variable resolves under `set -u`.
      const probe = lines.find((line) => line.includes("muse_ci_internal_rm='"))
      if (probe === undefined) throw new Error('missing removal-command probe')
      const start = lines.findIndex((line) => /^muse_(?:ci_internal_)?start_ms="\$\{/.test(line))
      const trap = lines.findLastIndex((line) => line.startsWith("trap '("))
      expect(start).toBeGreaterThan(-1)
      expect(trap).toBeGreaterThan(start)
      const parent = [probe, ...lines.slice(start, trap + 1)].join('\n')
      const setupName = /\$\{([A-Za-z_][A-Za-z0-9_]*)%%:\*\}/.exec(parent)?.[1]
      if (setupName === undefined) throw new Error('missing bootstrap result holder')
      const root = mkdtempSync(path.join(tmpdir(), 'ci-templates-'))
      try {
        for (const shell of shells()) {
          const dir = path.join(root, `trap-temp-${shell}`)
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
          expect(result.status, shell).toBe(127)
          expect(`${result.stdout}${result.stderr}`, shell).not.toMatch(
            /unbound variable|parameter not set/,
          )
          expect(existsSync(dir), `${shell} left ${dir} behind`).toBe(false)
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  it.each([...SYSTEMS])(
    '%s: without timeout on PATH the probe still cleans up with plain rm',
    (system) => {
      const lines = bootstrapOf(system)
        .split('\n')
        .map((line) => line.trim())
      const probe = lines.find((line) => line.includes("muse_ci_internal_rm='"))
      if (probe === undefined) throw new Error('missing removal-command probe')
      const start = lines.findIndex((line) => /^muse_(?:ci_internal_)?start_ms="\$\{/.test(line))
      const trap = lines.findLastIndex((line) => line.startsWith("trap '("))
      expect(start).toBeGreaterThan(-1)
      expect(trap).toBeGreaterThan(start)
      const parent = [probe, ...lines.slice(start, trap + 1)].join('\n')
      const setupName = /\$\{([A-Za-z_][A-Za-z0-9_]*)%%:\*\}/.exec(parent)?.[1]
      if (setupName === undefined) throw new Error('missing bootstrap result holder')
      // A bin directory with rm but no timeout: the probe must select plain
      // rm, so cleanup still runs and the missing binary still keeps 127.
      const bin = mkdtempSync(path.join(tmpdir(), 'ci-templates-bin-'))
      const root = mkdtempSync(path.join(tmpdir(), 'ci-templates-'))
      try {
        const rm = ['/bin/rm', '/usr/bin/rm'].find((candidate) => existsSync(candidate))
        if (rm === undefined) throw new Error('no rm to link')
        spawnSync('ln', ['-s', rm, path.join(bin, 'rm')], { encoding: 'utf8' })
        for (const shell of shells()) {
          const absolute = ['/bin', '/usr/bin']
            .map((directory) => path.join(directory, shell))
            .find((candidate) => existsSync(candidate))
          if (absolute === undefined) throw new Error(`no absolute path for ${shell}`)
          const dir = path.join(root, `no-timeout-${shell}`)
          mkdirSync(dir, { mode: 0o700 })
          const result = spawnSync(
            absolute,
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
              env: { PATH: bin, MUSE_MODEL_API_KEY: CI_KEY },
            },
          )
          expect(result.status, shell).toBe(127)
          expect(`${result.stdout}${result.stderr}`, shell).not.toMatch(
            /unbound variable|parameter not set/,
          )
          expect(existsSync(dir), `${shell} left ${dir} behind`).toBe(false)
        }
      } finally {
        rmSync(bin, { recursive: true, force: true })
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  it.each([...SYSTEMS])('%s: an unreadable CA file refuses before any download', (system) => {
    for (const shell of shells()) {
      const result = spawnSync(shell, ['-c', bootstrapOf(system)], {
        encoding: 'utf8',
        env: {
          PATH: process.env['PATH'] ?? '',
          MUSE_AGENT_VERSION: '0.0.0-test',
          MUSE_INPUT_AGENT_PACKAGE_SHA256: 'f'.repeat(64),
          MUSE_INPUT_EXTRA_CA_CERTS: path.join(tmpdir(), 'ci-templates-missing-ca.pem'),
        },
      })
      expect(result.status, shell).toBe(1)
      expect(`${result.stdout}${result.stderr}`, shell).toContain(
        'muse-spark: MUSE_INPUT_EXTRA_CA_CERTS is not readable',
      )
    }
  })
})
