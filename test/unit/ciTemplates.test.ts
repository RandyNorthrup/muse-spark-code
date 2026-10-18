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
import { checkJobDeadline, parseCiInputs } from '../../action/lib/ci-run.mjs'
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
      const start = lines.findIndex((line) => /^muse_(?:ci_internal_)?start_ms="\$\{/.test(line))
      const trap = lines.findLastIndex((line) => line.startsWith("trap '("))
      expect(start).toBeGreaterThan(-1)
      expect(trap).toBeGreaterThan(start)
      const parent = lines.slice(start, trap + 1).join('\n')
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
})
