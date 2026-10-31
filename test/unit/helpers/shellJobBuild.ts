// The shell-job helper (the type commands join their job with, and the program
// the resource governor's calls run), built through the product's own builder
// into a new temporary folder. The real execFile runner compiles it: a bare
// test process has no resource host to compile under.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { shellJobAssembly } from '../../../src/host/backend/shellJob'
import { runProgram } from '../../../src/host/processTree'
import { readJobSource } from './jobSource'

export async function buildShellJobHelper(
  prefix: string,
  systemRoot: string,
): Promise<{ readonly storageDir: string; readonly assembly: string }> {
  const storageDir = await mkdtemp(path.join(tmpdir(), prefix))
  const buildLog: string[] = []
  const assembly = await shellJobAssembly({
    storageDir,
    systemRoot,
    log: (message) => {
      buildLog.push(message)
    },
    readJobSource,
    run: runProgram,
  })()
  if (assembly === undefined)
    throw new Error(`the shell-job helper did not build here: ${buildLog.join('; ')}`)
  return { storageDir, assembly }
}
