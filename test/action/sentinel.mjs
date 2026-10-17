// A test-owned fixture program for the Action's Git isolation tests (M80
// lane C, G23/G25): configured as an fsmonitor, filter, hook, signer,
// credential helper, pager, editor or external diff, it records that it ran
// by creating `<directory>/<name>-<pid>`. The isolation tests require that
// no such file ever appears; the arming tests prove plain Git does run it.

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const [directory = '.', name = 'program'] = process.argv.slice(2)
writeFileSync(path.join(directory, `${name}-${String(process.pid)}`), '')
// A filter's clean or smudge command must pass its input through.
if (name.startsWith('filter')) process.stdin.pipe(process.stdout)
