// A workspace that is a repository of its own with one commit, for the
// runtime panel git suites (M104 lane B, M123): the user's own git makes
// it in a fresh run folder. A remote URL is only named, never contacted.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { testGit, type TestGit } from './nativeGitHarness'
import { createPanelRun, type PanelRun } from './panelRun'

/** A prepared run whose workspace is a repository with one commit, and the git that made it. */
export function repositoryRun(
  runs: PanelRun[],
  prefix: string,
  remoteUrl?: string,
): { readonly run: PanelRun; readonly git: TestGit } {
  const run = createPanelRun(prefix)
  runs.push(run)
  run.prepare()
  const git = testGit(run.folder)
  git.run(run.workspace, 'init', '-q', '-b', 'main')
  for (const [key, value] of [
    ['user.name', 'Panel Suite'],
    ['user.email', 'panel@example.invalid'],
    ['commit.gpgsign', 'false'],
  ] as const)
    git.run(run.workspace, 'config', key, value)
  writeFileSync(path.join(run.workspace, 'base.txt'), 'base\n')
  git.run(run.workspace, 'add', 'base.txt')
  git.run(run.workspace, 'commit', '-q', '-m', 'Base')
  if (remoteUrl !== undefined) git.run(run.workspace, 'remote', 'add', 'origin', remoteUrl)
  return { run, git }
}
