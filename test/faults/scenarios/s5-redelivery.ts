// S5: redelivery performs nothing twice (M110r Y4). A step delivered
// twice records once: the tool sink (a real file) shows one effect and
// the repeat gets the recorded outcome. A git push redelivered under an
// old epoch never reaches git: the epoch gate refuses first, and the
// remote's own hook counter proves it ran once.
import { execFile } from 'node:child_process'
import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { splitByEpoch } from '../../../src/core/devices/lease'
import { intakeResult } from '../../../src/core/devices/resultQueue'
import { OutcomeTable, stepKey } from '../../../src/core/devices/stepKeys'
import { checkFact } from '../../../scripts/lib/faultRig.mjs'
import type { FaultScenario } from '../scenario'

/** A hook the remote's git user runs: owner writes, everyone reads and runs. */
const HOOK_MODE = 0o755

function git(repo: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repo, ...args], (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args.join(' ')}: ${stderr.trim()}`))
      else resolve(stdout)
    })
  })
}

export const scenario: FaultScenario = {
  name: 's5-redelivery',
  needs: 'git',
  run: async (): Promise<void> => {
    // The tool sink: a redelivered step performs once.
    const sinkDir = await mkdtemp(path.join(tmpdir(), 'fault-sink-'))
    const sink = path.join(sinkDir, 'effects.txt')
    const table = new OutcomeTable()
    const identity = { pair: 'p', task: 't', attempt: 'a', epoch: 3, step: 9 }
    const input = { path: 'notes.txt', text: 'once' }
    const key = stepKey(identity, input)
    const perform = async (): Promise<string> => {
      const recorded = table.lookup(key)
      if (recorded !== undefined) return recorded.outcome
      await appendFile(sink, 'wrote notes.txt\n', 'utf8')
      const outcome = 'wrote notes.txt'
      table.record({ key, task: 't', step: 9, outcome })
      return outcome
    }
    const first = await perform()
    const second = await perform()
    checkFact(first === second, 'the redelivery gets the recorded outcome')
    checkFact((await readFile(sink, 'utf8')) === 'wrote notes.txt\n', 'the sink shows one effect')

    // The git remote: a stale-epoch push never reaches it.
    const remoteDir = await mkdtemp(path.join(tmpdir(), 'fault-remote-'))
    await git(remoteDir, ['init', '--bare', '--initial-branch=main'])
    const counter = path.join(remoteDir, 'pushes.count')
    await writeFile(counter, '0\n', 'utf8')
    await writeFile(
      path.join(remoteDir, 'hooks', 'pre-receive'),
      `#!/bin/sh\ncount=$(cat "${counter}")\necho $((count + 1)) > "${counter}"\n`,
      { mode: HOOK_MODE },
    )
    const workDir = await mkdtemp(path.join(tmpdir(), 'fault-work-'))
    await git(workDir, ['init', '--initial-branch=main'])
    await git(workDir, [
      '-c',
      'user.email=fault@rig',
      '-c',
      'user.name=fault',
      'commit',
      '--allow-empty',
      '-m',
      'one',
    ])
    await git(workDir, ['remote', 'add', 'origin', remoteDir])
    const push = async (epoch: number): Promise<'landed' | 'refused-stale'> => {
      const split = splitByEpoch([{ id: 'push-1', epoch }], 3)
      if (split.stale.length > 0) return 'refused-stale'
      await git(workDir, ['push', 'origin', 'main'])
      return 'landed'
    }
    const landed = await push(3)
    checkFact(landed === 'landed', 'the current epoch pushes')
    const refused = await push(2)
    checkFact(refused === 'refused-stale', 'the old epoch refuses before git')
    const pushes = await readFile(counter, 'utf8')
    checkFact(pushes.trim() === '1', 'the remote saw one push')
    checkFact(
      intakeResult(3, {
        id: 'r-redelivered',
        taskId: 't1',
        attemptId: 'a-old',
        epoch: 2,
        kind: 'result',
        stepKey: key,
        body: { lines: 1 },
        enqueuedAtWall: Date.now(),
      }).status === 'quarantined',
      'the old epoch quarantines at intake, never lands',
    )
  },
}
