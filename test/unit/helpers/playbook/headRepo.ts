// A baseline git repository on `main` for the playbook head suites, and the
// recording admission that runs each effect through a real contained job.
// Shared by playbookHeadGit and jobHostHijack so the one setup is not copied.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { withoutCredentials } from '../../../../src/core/credentialEnvironment'
import type {
  PlaybookHookAdmission,
  PlaybookHookEffect,
} from '../../../../src/core/orchestration/playbook/outcomes'
import type { ContainedJob } from '../../../../src/host/playbook/containedJob'
import { gitWorkspace } from './gitWorkspace'

/** Inits a repo on `main`, commits one file, and returns the commit the head should read. */
export function baselineHead(workspace: string): string {
  const { git } = gitWorkspace(workspace, {
    ...withoutCredentials(process.env),
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  })
  git(['init', '--initial-branch=main'])
  writeFileSync(path.join(workspace, 'notes.md'), 'the head\n')
  git(['add', '.'])
  git(['commit', '-m', 'baseline'])
  return git(['rev-parse', 'HEAD'])
}

/**
An admission that records every admitted effect. With a contained job
(Windows) each effect runs through it; without one (POSIX) the dispatch runs
each effect directly.
*/
export function recordingHeadAdmission(contained?: ContainedJob): {
  readonly admission: PlaybookHookAdmission
  readonly admitted: PlaybookHookEffect[]
} {
  const admitted: PlaybookHookEffect[] = []
  const admission: PlaybookHookAdmission = {
    admit: (effect) => {
      admitted.push(effect)
      return true
    },
    ...(contained !== undefined && {
      runContained: (effect, options) => contained.run(effect, options),
    }),
  }
  return { admission, admitted }
}
