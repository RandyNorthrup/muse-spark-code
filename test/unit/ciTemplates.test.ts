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
import { bootstrapOf, bootstrapSource, jenkinsStage, templateText } from './helpers/ciTemplateText'

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

describe('one bootstrap, generated from one source into every template', () => {
  it.each([...SYSTEMS])('%s: the generated block matches the source', (system) => {
    const expected = bootstrapSource()
      .split('@MUSE_SYSTEM@')
      .join(system)
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
    const actual = bootstrapOf(system)
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
    expect(actual).toBe(expected)
  })

  it.each([...SYSTEMS])(
    '%s: aliases out first, key into a private file, stdin to the launcher',
    (system) => {
      const lines = bootstrapOf(system)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
      expect(lines.slice(0, 3)).toEqual(['set +x', 'set -eu', 'umask 077'])
      // The holders are unset before assignment (an exported holder cannot
      // keep its export attribute), then every secret name and alias is
      // unset before any child runs.
      expect(lines.slice(3, 7)).toEqual([
        'unset muse_key muse_key_file',
        'muse_key="${MUSE_MODEL_API_KEY:-}"',
        'muse_key_file="${MUSE_MODEL_API_KEY_FILE:-}"',
        'unset MUSE_MODEL_API_KEY MUSE_MODEL_API_KEY_FILE MUSE_SPARK_MODEL_API_KEY META_API_KEY',
      ])
      // The holder is never exported: no export, no key on the exec line.
      expect(lines.some((line) => line.startsWith('export'))).toBe(false)
      expect(lines.some((line) => line.includes('MUSE_SPARK_MODEL_API_KEY='))).toBe(false)
      // The temp directory is owned by a trap on every exit path.
      expect(lines).toContain('trap \'rm -rf "$muse_dir"\' EXIT HUP INT TERM')
      // The File variable is read as a file; the value holder is transient.
      expect(lines.some((line) => line.startsWith('cp "$muse_key_file"'))).toBe(true)
      expect(lines).toContain('printf \'%s\' "$muse_key" > "$muse_dir/key"')
      expect(lines).toContain('chmod 600 "$muse_dir/key"')
      expect(lines.filter((line) => line === 'unset muse_key muse_key_file')).toHaveLength(2)
      const digest = lines.findIndex((line) => line.startsWith('if [ "${muse_sum%% *}"'))
      const unpack = lines.findIndex((line) => line.startsWith('tar -xzf'))
      expect(digest).toBeGreaterThan(0)
      expect(unpack).toBeGreaterThan(digest)
      const last = lines.at(-1) ?? ''
      expect(last).toBe(
        `MUSE_CI_TEMP="$muse_dir" MUSE_CI_BOOTSTRAP_START_MS="$muse_start_ms" MUSE_INPUT_AGENT_PACKAGE="$muse_dir/agent.tgz" exec node "$muse_dir/launcher/package/ci/lib/ci-run.mjs" ${system} < "$muse_dir/key"`,
      )
    },
  )

  it('is byte-identical across the four templates but for the system name', () => {
    const bodies = SYSTEMS.map((system) =>
      bootstrapOf(system)
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .replace(new RegExp(` ${system} <`, 'm'), ' SYSTEM <'),
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
    const timeout = /options \{ timeout\(time: (\d+), unit: 'MINUTES'\)/.exec(text)?.[1]
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
    // A File-type variable: source preparation and upload see only the path.
    const text = templateText('gitlab')
    expect(text).toContain('MUSE_MODEL_API_KEY_FILE')
    expect(text).toMatch(/File-type variable/)
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

  it('Jenkins: stale output is deleted before checkout; only publisher files archive (findings 3, 4)', () => {
    const text = templateText('jenkins')
    expect(text).toContain('skipDefaultCheckout(true)')
    const stage = jenkinsStage(text)
    const steps = stage.slice(stage.indexOf('steps {'), stage.indexOf('post {'))
    // The vendor start time reaches the launcher for the remaining deadline.
    expect(steps).toContain('env.MUSE_CI_JOB_START_MS = String(currentBuild.startTimeInMillis)')
    // Deletion before checkout: a reused workspace never uploads stale files.
    expect(steps).toContain("sh 'rm -rf muse-spark-out'")
    expect(steps).toContain('checkout scm')
    expect(steps.indexOf('rm -rf muse-spark-out')).toBeLessThan(steps.indexOf('checkout scm'))
    expect(steps.indexOf('checkout scm')).toBeLessThan(steps.indexOf('withCredentials('))
    // The credential stays bound only around the launcher step.
    expect(steps.indexOf('MUSE_CI_JOB_START_MS')).toBeLessThan(steps.indexOf('withCredentials('))
    // Only the publisher's fixed file set archives, never a workspace glob.
    const post = stage.slice(stage.indexOf('post {'))
    expect(post).not.toContain('**')
    for (const name of [
      'outputs.json',
      'result.json',
      'events.jsonl',
      'fix.patch',
      'manifest.json',
    ]) {
      expect(post).toContain(`muse-spark-out/${name}`)
    }
  })

  it('no template passes the key through the environment (stdin only)', () => {
    for (const system of SYSTEMS) {
      expect(templateText(system)).not.toContain('MUSE_SPARK_MODEL_API_KEY=')
    }
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
