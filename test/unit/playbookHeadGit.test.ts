// The playbook's dispatch head (`PlaybookOutcomes.head`, M116): every git it
// runs is the git resolved outside the workspace (D24), never a bare `git`
// that the process runner looks up for itself. A real repository and real
// git, a `git` planted inside the workspace and put first on this process's
// PATH, and on Windows the real contained job (the shipped job helper's
// `contained` server, built as the extension builds it), which looks a bare
// name up on its own PATH, this process's.
import { chmodSync, copyFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withoutCredentials } from '../../src/core/credentialEnvironment'
import {
  PlaybookOutcomes,
  type PlaybookHookAdmission,
  type PlaybookHookEffect,
} from '../../src/core/orchestration/playbook/outcomes'
import { processGitPath } from '../../src/host/git'
import { ContainedJob } from '../../src/host/playbook/containedJob'
import { gitWorkspace } from './helpers/playbook/gitWorkspace'
import { compiledJobAssembly, SYSTEM_ROOT } from './helpers/playbook/jobAssembly'
import { removeFolder } from './helpers/temporaryFolders'

const IS_WINDOWS = process.platform === 'win32'
const BUILD_MS = 120_000

describe('the playbook dispatch head', () => {
  const state = { root: '', workspace: '', storage: '', assembly: '', commit: '' }
  const originalPath = process.env['PATH']

  beforeAll(async () => {
    state.root = realpathSync(await mkdtemp(path.join(tmpdir(), 'muse-playbook-head-')))
    state.workspace = path.join(state.root, 'workspace')
    mkdirSync(state.workspace)
    const { git } = gitWorkspace(state.workspace, {
      ...withoutCredentials(process.env),
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    })
    git(['init', '--initial-branch=main'])
    writeFileSync(path.join(state.workspace, 'notes.md'), 'the head\n')
    git(['add', '.'])
    git(['commit', '-m', 'baseline'])
    state.commit = git(['rev-parse', 'HEAD'])
    // A program named git inside the workspace, first on this process's PATH:
    // a bare `git` finds it wherever a lookup reads that PATH.
    const planted = path.join(state.workspace, 'bin')
    mkdirSync(planted)
    if (IS_WINDOWS) {
      copyFileSync(
        path.join(SYSTEM_ROOT, 'System32', 'hostname.exe'),
        path.join(planted, 'git.exe'),
      )
      state.storage = await mkdtemp(path.join(tmpdir(), 'muse-playbook-head-job-'))
      state.assembly = await compiledJobAssembly(state.storage)
    } else {
      writeFileSync(path.join(planted, 'git'), '#!/bin/sh\necho refs/heads/planted\n')
      chmodSync(path.join(planted, 'git'), 0o755)
    }
    process.env['PATH'] = [planted, originalPath ?? ''].join(path.delimiter)
  }, BUILD_MS)

  afterAll(async () => {
    process.env['PATH'] = originalPath
    await removeFolder(state.root)
    if (state.storage !== '') await removeFolder(state.storage)
  })

  it('runs only the git resolved outside the workspace, and reads the branch and its commit', () => {
    const resolved = processGitPath(state.workspace)
    expect(resolved).toBeDefined()
    expect(resolved?.toLowerCase().startsWith(state.workspace.toLowerCase())).toBe(false)
    const admitted: PlaybookHookEffect[] = []
    // Every effect is admitted, and kept to see what each one spawns.
    const isAdmitted = (effect: PlaybookHookEffect): boolean => {
      admitted.push(effect)
      return true
    }
    const contained = IS_WINDOWS
      ? new ContainedJob({
          assemblyPath: state.assembly,
          systemRoot: SYSTEM_ROOT,
          onJob: () => undefined,
        })
      : undefined
    const admission: PlaybookHookAdmission =
      contained === undefined
        ? { admit: isAdmitted }
        : {
            admit: isAdmitted,
            runContained: (effect, options) => contained.run(effect, options),
          }
    try {
      expect(new PlaybookOutcomes(state.workspace, admission).head()).toEqual({
        ref: 'refs/heads/main',
        commit: state.commit,
      })
    } finally {
      contained?.close()
    }
    // The admission approves the absolute path each call spawns.
    expect(admitted.map((effect) => effect.command)).toEqual([resolved, resolved])
  })
})
