// npm's `prepare` step: husky's install, then fail-closed hook stubs.
//
// husky 9 points core.hooksPath at .husky/_ and writes one stub per Git hook
// there; each sources husky's runtime `h`, which runs .husky/<hook> and exits
// with its status. That status was lost on Windows when the reader of git's
// output went away first (a caller keeping only the first lines, such as
// `git commit 2>&1 | Select-Object -First 5`), and three commits that failed
// lint-staged landed (docs/certification/rel017ci.md):
//
// - after a failing hook, `h` prints "husky - pre-commit script failed"; with
//   the reader gone that write raises SIGPIPE and kills the shell;
// - an MSYS2 process killed by a signal exits with the signal number in the
//   second byte (SIGPIPE: 13 << 8 = 3328), and Git for Windows keeps only the
//   low byte of a hook's exit code, so the killed hook reads as a pass.
//
// The stubs below keep husky's runtime and add, before it starts: SIGPIPE
// ignored (a write to a closed stream then fails with EPIPE and the script
// goes on to exit with the hook's own status), the other catchable
// terminations turned into ordinary non-zero exits, and a marker that
// .husky/pre-commit requires, so a worktree still on husky's stubs refuses
// to commit until `npm run prepare` has run there.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import husky from 'husky'

const HOOKS_DIR = path.join('.husky', '_')
// The exact stub husky 9.1.7 writes; any other shape stops the install.
const HUSKY_STUB = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"'
const REQUIRED_HOOK = 'pre-commit'

const FAIL_CLOSED_STUB = `#!/usr/bin/env sh
# Written by scripts/install-git-hooks.mjs (npm run prepare) over husky's stub.
# A hook that fails must stop Git on every OS, even after its reader is gone.
trap '' PIPE
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
export MUSE_GIT_HOOK_STUB=fail-closed
. "$(dirname "$0")/h"
`

const skipped = husky()
if (skipped === '') {
  const rewritten = []
  for (const name of readdirSync(HOOKS_DIR)) {
    const file = path.join(HOOKS_DIR, name)
    if (readFileSync(file, 'utf8') !== HUSKY_STUB) continue
    writeFileSync(file, FAIL_CLOSED_STUB)
    rewritten.push(name)
  }
  if (!rewritten.includes(REQUIRED_HOOK)) {
    throw new Error(
      `${HOOKS_DIR}/${REQUIRED_HOOK} is not husky's known stub; review scripts/install-git-hooks.mjs against this husky version`,
    )
  }
} else {
  // husky's own outcomes (HUSKY=0, no .git, no git): reported, not fatal.
  process.stdout.write(`${skipped}\n`)
}
