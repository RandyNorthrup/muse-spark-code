// Lane CM80CI-R2: validators for the four other-CI templates, parsed with
// the repository's YAML parser (Jenkins: its declarative blocks by
// structure). Each template is a thin wrapper: the same bootstrap (key out
// of the environment first, pinned download, SHA-256 before anything of the
// package runs, exec of the Action's launcher), the system's own mechanism
// keeping untrusted runs away from the credential, a job timeout the
// launcher accepts, and only inputs the launcher consumes.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { parseCiInputs, requiredJobMinutes } from '../../action/lib/ci-run.mjs'
import { CI_LAUNCHER_SOURCES } from '../../scripts/lib/acpNativeSources.mjs'
import { byText, REPO_ROOT } from './helpers/actionFixtures'
import { bootstrapOf, jenkinsStage, templateText } from './helpers/ciTemplateText'

const INPUTS = [
  'MUSE_INPUT_MODE',
  'MUSE_INPUT_MAX_BUDGET_USD',
  'MUSE_INPUT_MAX_REQUESTS',
  'MUSE_INPUT_TIMEOUT_MINUTES',
  'MUSE_INPUT_MODEL',
  'MUSE_INPUT_EFFORT',
  'MUSE_INPUT_ALLOW_CONTRIBUTOR_MODELS',
  'MUSE_INPUT_IMAGE_GENERATION',
  'MUSE_INPUT_MAX_DIFF_BYTES',
  'MUSE_INPUT_EXTRA_INSTRUCTIONS',
  'MUSE_INPUT_TRUST_PULL_REQUESTS',
]
const SYSTEMS = ['gitlab', 'azure', 'jenkins', 'bitbucket'] as const

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

/** Every MUSE_INPUT_* name a template mentions. */
function inputNames(text: string): string[] {
  return [...new Set(text.match(/MUSE_INPUT_[A-Z0-9_]+/g))].toSorted(byText)
}

describe('one bootstrap, the same in every template', () => {
  it.each([...SYSTEMS])(
    '%s: key out first, digest before anything runs, exec of the launcher',
    (system) => {
      const lines = bootstrapOf(system)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
      expect(lines.slice(0, 4)).toEqual([
        'set +x',
        'set -eu',
        'muse_key="${MUSE_MODEL_API_KEY:-}"',
        'unset MUSE_MODEL_API_KEY',
      ])
      const digest = lines.findIndex((line) => line.startsWith('if [ "${muse_sum%% *}"'))
      const unpack = lines.findIndex((line) => line.startsWith('tar -xzf'))
      expect(digest).toBeGreaterThan(0)
      expect(unpack).toBeGreaterThan(digest)
      const last = lines.at(-1) ?? ''
      expect(last).toBe(
        `MUSE_SPARK_MODEL_API_KEY="$muse_key" MUSE_CI_TEMP="$muse_dir" MUSE_INPUT_AGENT_PACKAGE="$muse_dir/agent.tgz" exec node "$muse_dir/launcher/package/ci/lib/ci-run.mjs" ${system}`,
      )
      // The key appears only where it is taken and on the exec line.
      const withKey = lines.filter(
        (line) => line.includes('muse_key') || line.includes('MODEL_API_KEY'),
      )
      expect(withKey).toEqual([lines[2], lines[3], last])
    },
  )

  it('is byte-identical across the four templates but for the system name', () => {
    const bodies = SYSTEMS.map((system) =>
      bootstrapOf(system)
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .replace(new RegExp(` ${system}$`, 'm'), ' SYSTEM'),
    )
    expect(new Set(bodies).size).toBe(1)
  })
})

describe('inputs: only what the launcher consumes, the Action’s grammar', () => {
  it.each([...SYSTEMS])('%s carries the launcher’s inputs and nothing GitHub-only', (system) => {
    const names = inputNames(templateText(system))
    for (const name of INPUTS) expect(names, name).toContain(name)
    for (const name of names) {
      expect(
        [
          ...INPUTS,
          'MUSE_INPUT_AGENT_PACKAGE',
          'MUSE_INPUT_AGENT_PACKAGE_SHA256',
          'MUSE_INPUT_HTTPS_PROXY',
          'MUSE_INPUT_NO_PROXY',
          'MUSE_INPUT_EXTRA_CA_CERTS',
        ],
        name,
      ).toContain(name)
    }
  })

  it.each(['gitlab', 'azure'] as const)(
    '%s defaults parse with the launcher’s own grammar',
    (system) => {
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
    },
  )

  it('Bitbucket keeps an explicitly empty value instead of reinstating a default (finding 11)', () => {
    const text = templateText('bitbucket')
    expect(text).not.toMatch(/\$\{MUSE_INPUT_[A-Z_]+:-/)
    expect(text).toContain('export MUSE_INPUT_MAX_BUDGET_USD="${MUSE_INPUT_MAX_BUDGET_USD-2.00}"')
  })
})

describe('job timeouts cover the launcher’s bounds (finding 12)', () => {
  const needed = requiredJobMinutes({ timeoutMinutes: 20 })

  it('GitLab: the job timeout, which the launcher reads as CI_JOB_TIMEOUT', () => {
    const job = record(yamlOf('gitlab')['muse-spark'])
    expect(job['timeout']).toBe('35m')
    expect(35).toBeGreaterThanOrEqual(needed)
  })

  it('Azure: timeoutInMinutes equals the declared MUSE_CI_JOB_TIMEOUT_MINUTES', () => {
    const document = yamlOf('azure')
    const job = record((document['jobs'] as unknown[])[0])
    const declared = Number(record(document['variables'])['MUSE_CI_JOB_TIMEOUT_MINUTES'])
    expect(job['timeoutInMinutes']).toBe(declared)
    expect(declared).toBeGreaterThanOrEqual(needed)
  })

  it('Jenkins: options timeout equals the declared MUSE_CI_JOB_TIMEOUT_MINUTES', () => {
    const text = templateText('jenkins')
    const timeout = /options \{ timeout\(time: (\d+), unit: 'MINUTES'\) \}/.exec(text)?.[1]
    const declared = /MUSE_CI_JOB_TIMEOUT_MINUTES = '(\d+)'/.exec(text)?.[1]
    expect(timeout).toBe(declared)
    expect(Number(declared)).toBeGreaterThanOrEqual(needed)
  })

  it('Bitbucket: max-time equals the exported MUSE_CI_JOB_TIMEOUT_MINUTES', () => {
    const step = bitbucketStep()
    const exported = (step['script'] as string[]).find((line) =>
      line.startsWith('export MUSE_CI_JOB_TIMEOUT_MINUTES='),
    )
    expect(step['max-time']).toBe(Number(exported?.split('=', 2)[1]))
    expect(Number(step['max-time'])).toBeGreaterThanOrEqual(needed)
  })
})

function bitbucketStep(): Yaml {
  const definitions = record(yamlOf('bitbucket')['definitions'])
  const steps = definitions['steps'] as unknown[]
  return record(record(steps[0])['step'])
}

describe('each system’s own mechanism keeps untrusted runs from the credential', () => {
  it('GitLab: the only job never runs for forks, untrusted or unprotected merge requests, unprotected refs or tags', () => {
    const document = yamlOf('gitlab')
    expect(Object.keys(document).toSorted(byText)).toEqual(['muse-spark', 'variables'])
    const job = record(document['muse-spark'])
    const rules = (job['rules'] as unknown[]).map((rule) => record(rule))
    expect(rules.map((rule) => [rule['if'], rule['when']])).toEqual([
      [
        '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_SOURCE_PROJECT_ID != $CI_PROJECT_ID',
        'never',
      ],
      [
        '$CI_PIPELINE_SOURCE == "merge_request_event" && $MUSE_INPUT_TRUST_PULL_REQUESTS != "true"',
        'never',
      ],
      [
        '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_SOURCE_BRANCH_PROTECTED != "true"',
        'never',
      ],
      [
        '$CI_PIPELINE_SOURCE != "merge_request_event" && $CI_COMMIT_REF_PROTECTED != "true"',
        'never',
      ],
      ['$CI_COMMIT_TAG', 'never'],
      [undefined, 'on_success'],
    ])
    expect(record(job['variables'])['GIT_DEPTH']).toBe('0')
    expect(record(job['artifacts'])['paths']).toEqual(['muse-spark-out/'])
    // The secret is a project variable, never declared in the file.
    expect(Object.keys(record(document['variables']))).not.toContain('MUSE_MODEL_API_KEY')
  })

  it('Azure: the job condition excludes forks and untrusted pull requests; only the run step maps the secret', () => {
    const document = yamlOf('azure')
    const job = record((document['jobs'] as unknown[])[0])
    expect(job['condition']).toBe(
      "and(succeeded(), or(ne(variables['Build.Reason'], 'PullRequest'), and(eq(variables['MUSE_INPUT_TRUST_PULL_REQUESTS'], 'true'), eq(variables['System.PullRequest.IsFork'], 'False'))))",
    )
    const steps = (job['steps'] as unknown[]).map((step) => record(step))
    const withEnv = steps.filter((step) => step['env'] !== undefined)
    expect(withEnv).toHaveLength(1)
    expect(record(withEnv[0]?.['env'])).toEqual({ MUSE_MODEL_API_KEY: '$(MUSE_MODEL_API_KEY)' })
    expect(typeof withEnv[0]?.['bash']).toBe('string')
    expect(steps[0]).toMatchObject({ checkout: 'self', fetchDepth: 0, persistCredentials: false })
    expect(Object.keys(record(document['variables']))).not.toContain('MUSE_MODEL_API_KEY')
  })

  it('Jenkins: the credential is bound only inside the stage whose when excludes forks and untrusted change requests (finding 2)', () => {
    const text = templateText('jenkins')
    expect(text.match(/withCredentials\(/g)).toHaveLength(1)
    const stage = jenkinsStage(text)
    const when = stage.slice(stage.indexOf('when {'), stage.indexOf('steps {'))
    expect(when).toContain('beforeAgent true')
    expect(when).toContain('expression { env.CHANGE_FORK == null }')
    expect(when).toContain('not { changeRequest() }')
    expect(when).toContain('expression { params.MUSE_INPUT_TRUST_PULL_REQUESTS }')
    expect(stage.indexOf('when {')).toBeLessThan(stage.indexOf('withCredentials('))
    expect(text).toContain(
      "string(credentialsId: 'muse-model-api-key', variable: 'MUSE_MODEL_API_KEY')",
    )
  })

  it('Bitbucket: the step parses into a real step and is listed only under branches and custom (finding 5)', () => {
    const document = yamlOf('bitbucket')
    const step = bitbucketStep()
    expect(step['name']).toBe('Muse Spark')
    expect(Array.isArray(step['script'])).toBe(true)
    expect(step['artifacts']).toEqual(['muse-spark-out/**'])
    const pipelines = record(document['pipelines'])
    expect(Object.keys(pipelines).toSorted(byText)).toEqual(['branches', 'custom'])
    const main = (record(pipelines['branches'])['main'] as unknown[]).map((item) => record(item))
    const custom = (record(pipelines['custom'])['muse-spark'] as unknown[]).map((item) =>
      record(item),
    )
    // The anchors resolve to the very step, script and all.
    expect(main[0]?.['step']).toEqual(step)
    expect(custom[0]?.['step']).toEqual(step)
    expect(record(document['clone'])['depth']).toBe('full')
  })
})

describe('the launcher ships in the package', () => {
  it('package-acp.mjs copies action/lib and action/prompts into ci/ and lists it in files', () => {
    expect(CI_LAUNCHER_SOURCES).toEqual([
      path.join('action', 'lib'),
      path.join('action', 'prompts'),
    ])
    const script = readFileSync(path.join(REPO_ROOT, 'scripts', 'package-acp.mjs'), 'utf8')
    expect(script).toContain(
      "cpSync(source, path.join(STAGE, 'ci', path.basename(source)), { recursive: true })",
    )
    expect(script).toMatch(/files: \[\n\s+'ci',/)
  })
})
