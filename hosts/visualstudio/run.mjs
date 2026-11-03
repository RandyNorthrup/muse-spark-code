import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conformHost } from '../../test/hostApi/harness.mjs'

const NEED = 'Windows with Visual Studio 2022/2026 and the experimental instance'
// The harness installs through VSIXInstaller /shutdownprocesses and ends these by name. It never starts while
// one is running: a window a person has open is not this run's to close.
const OTHERS_OPEN = [
  'devenv.exe',
  'VSIXInstaller.exe',
  'VsJITDebugger.exe',
  'DbgCLR.exe',
  'dexplore.exe',
]

function openElsewhere() {
  if (process.platform !== 'win32') return []
  const listed = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' }).toLowerCase()
  return OTHERS_OPEN.filter((name) => listed.includes(`"${name.toLowerCase()}"`))
}

const open = openElsewhere()
await conformHost({
  host: 'visualstudio',
  tool: open.length > 0 ? false : 'powershell',
  need: open.length > 0 ? `${NEED}, with ${open.join(', ')} closed first` : NEED,
  args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'conformance.ps1'],
  directory: path.dirname(fileURLToPath(import.meta.url)),
  platforms: ['win32'],
})
