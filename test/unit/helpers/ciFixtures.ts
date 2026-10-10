// Fixtures for the other-CI launcher's tests (lane CM80CI-R2): a package
// tarball laid out as muse-spark-code-acp ships it (ci/lib from action/lib,
// ci/prompts from action/prompts, a bin that runs the fake agent), a CI
// system's own clone of a fixture origin, each system's predefined
// variables, and a fabricated key. No network, no model call.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ACTION_DIR,
  FAKE_AGENT,
  fixtureRepo,
  plainGit,
  REPO_ROOT,
  type FixtureRepo,
  type TempLayout,
} from './actionFixtures'

export const CI_KEY = `LLM_${'c'.repeat(28)}`
export const PACKAGE_NAME = 'muse-spark-code-acp'
export const REPO_VERSION = (
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string }
).version

export interface CiPackage {
  readonly tarball: string
  readonly sha256: string
  /** The fake agent's working folder: its scenario in, its report out. */
  readonly reportDir: string
}

export interface PackageOptions {
  readonly exec?: Record<string, unknown>
  readonly scan?: Record<string, unknown>
  readonly name?: string
  readonly scripts?: Record<string, string>
  readonly missingLauncherModule?: string
}

/**
 * A tarball shaped like the published package: package/package.json,
 * package/ci/{lib,prompts} copied from action/, and package/dist/acp.js,
 * which moves into the report folder and runs test/action/fake-agent.mjs.
 */
export function ciPackage(root: string, options: PackageOptions = {}): CiPackage {
  const base = mkdtempSync(path.join(root, 'pkg-'))
  const reportDir = path.join(base, 'report')
  const stage = path.join(base, 'stage', 'package')
  mkdirSync(reportDir)
  mkdirSync(path.join(stage, 'dist'), { recursive: true })
  cpSync(path.join(ACTION_DIR, 'lib'), path.join(stage, 'ci', 'lib'), { recursive: true })
  cpSync(path.join(ACTION_DIR, 'prompts'), path.join(stage, 'ci', 'prompts'), { recursive: true })
  if (options.missingLauncherModule !== undefined)
    rmSync(path.join(stage, 'ci', 'lib', options.missingLauncherModule))
  writeFileSync(
    path.join(stage, 'package.json'),
    JSON.stringify({
      name: options.name ?? PACKAGE_NAME,
      version: REPO_VERSION,
      bin: { [PACKAGE_NAME]: 'dist/acp.js' },
      ...(options.scripts !== undefined && { scripts: options.scripts }),
    }),
  )
  writeFileSync(
    path.join(stage, 'dist', 'acp.js'),
    `process.chdir(${JSON.stringify(reportDir)})\nawait import(${JSON.stringify(pathToFileURL(FAKE_AGENT).href)})\n`,
  )
  writeFileSync(path.join(stage, 'dist', 'package.json'), '{"type":"module"}\n')
  writeFileSync(
    path.join(reportDir, 'fake-scenario.json'),
    JSON.stringify({ exec: options.exec ?? {}, scan: options.scan ?? {} }),
  )
  const tarball = path.join(base, 'agent.tgz')
  execFileSync('tar', ['-czf', tarball, '-C', path.join(base, 'stage'), 'package'])
  return {
    tarball,
    sha256: createHash('sha256').update(readFileSync(tarball)).digest('hex'),
    reportDir,
  }
}

/** The fake agent's report lines. */
export function agentReports(pkg: CiPackage): Record<string, unknown>[] {
  try {
    return readFileSync(path.join(pkg.reportDir, 'fake-report.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  } catch {
    return []
  }
}

export interface CiClone {
  readonly repo: FixtureRepo
  /** The merge commit a pull request checkout holds (Azure's layout). */
  readonly merge: string
}

/**
 * The system's own clone in the workspace: a full clone of a fixture origin
 * (origin/main at the base, origin/feature at the head), detached at the
 * head, or at a merge of the head into main when `isAtMerge` is set.
 */
export function ciClone(layout: TempLayout, isAtMerge = false): CiClone {
  const repo = fixtureRepo(layout)
  plainGit(layout, layout.workspace, ['clone', '--quiet', repo.bare, '.'])
  plainGit(layout, layout.workspace, ['checkout', '--quiet', '--detach', 'origin/main'])
  plainGit(layout, layout.workspace, ['merge', '--quiet', '--no-ff', '--no-edit', 'origin/feature'])
  const merge = plainGit(layout, layout.workspace, ['rev-parse', 'HEAD'])
  if (!isAtMerge) plainGit(layout, layout.workspace, ['checkout', '--quiet', '--detach', repo.head])
  return { repo, merge }
}

/** Each system's predefined variables for a trusted run of `clone`. */
export function systemEnv(
  system: string,
  layout: TempLayout,
  clone: CiClone,
): Record<string, string> {
  const { head, base } = clone.repo
  switch (system) {
    case 'gitlab': {
      return {
        CI_PROJECT_DIR: layout.workspace,
        CI_JOB_ID: '7001',
        CI_JOB_TIMEOUT: '2100',
        CI_JOB_STARTED_AT: new Date().toISOString(),
        CI_PIPELINE_SOURCE: 'merge_request_event',
        CI_COMMIT_SHA: head,
        CI_MERGE_REQUEST_IID: '12',
        CI_PROJECT_ID: '41',
        CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '41',
        CI_MERGE_REQUEST_SOURCE_BRANCH_PROTECTED: 'true',
        CI_MERGE_REQUEST_DIFF_BASE_SHA: base,
        CI_MERGE_REQUEST_TITLE: 'Notes for @someone',
        CI_MERGE_REQUEST_DESCRIPTION: 'Untrusted body',
        MUSE_INPUT_TRUST_PULL_REQUESTS: 'true',
      }
    }
    case 'azure': {
      return {
        BUILD_SOURCESDIRECTORY: layout.workspace,
        BUILD_BUILDID: '7002',
        SYSTEM_JOBATTEMPT: '1',
        BUILD_REASON: 'PullRequest',
        BUILD_SOURCEVERSION: clone.merge,
        SYSTEM_PULLREQUEST_ISFORK: 'False',
        SYSTEM_PULLREQUEST_PULLREQUESTID: '13',
        MUSE_INPUT_TRUST_PULL_REQUESTS: 'True',
        MUSE_CI_JOB_TIMEOUT_MINUTES: '35',
        MUSE_CI_PIPELINE_STARTED_AT: new Date().toISOString(),
      }
    }
    case 'jenkins': {
      return {
        WORKSPACE: layout.workspace,
        BUILD_NUMBER: '7003',
        GIT_COMMIT: head,
        CHANGE_ID: '14',
        CHANGE_TARGET: 'main',
        CHANGE_TITLE: 'Notes',
        MUSE_INPUT_TRUST_PULL_REQUESTS: 'true',
        MUSE_CI_JOB_TIMEOUT_MINUTES: '35',
        MUSE_CI_JOB_START_MS: String(Date.now()),
      }
    }
    default: {
      return {
        BITBUCKET_CLONE_DIR: layout.workspace,
        BITBUCKET_BUILD_NUMBER: '7004',
        BITBUCKET_COMMIT: head,
        BITBUCKET_BRANCH: 'feature',
        MUSE_CI_JOB_TIMEOUT_MINUTES: '35',
      }
    }
  }
}

/** The system each fixture uses: the merge checkout only for Azure's pull request. */
export function cloneFor(system: string, layout: TempLayout): CiClone {
  return ciClone(layout, system === 'azure')
}

/** True when `text` holds the key in any form a log or file could carry it. */
export function hasKey(text: string): boolean {
  return text.includes(CI_KEY) || text.includes(encodeURIComponent(CI_KEY))
}
