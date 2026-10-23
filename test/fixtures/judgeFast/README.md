# judgeFast fixtures (M125 lanes R, K)

Recorded real tool exchanges the reflex tests feed the deterministic
checks, and the accuracy tests feed the failure-count parser. Each file
holds the command's merged stdout+stderr exactly as captured on linuxlt
on 2026-10-22.

| File                 | Command                                                                                                                                       | Exit          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| vitest-pass.txt      | `npx vitest run test/unit/judgeFastApply.test.ts --maxWorkers=3 2>&1 \| tail -8` (raw; ANSI escapes kept)                                     | 0             |
| git-status-clean.txt | `git status` in a scratch repository with a committed tree                                                                                    | 0             |
| ls-missing.txt       | `ls /nonexistent-rlm125`                                                                                                                      | 2             |
| node-traceback.txt   | `node -e "throw new Error('boom-rlm125')"`                                                                                                    | 1             |
| grep-nomatch.txt     | `grep "zzz-no-such-token-rlm125" package.json` (no output)                                                                                    | 1             |
| git-log.txt          | `git log --oneline -3` in the lane worktree                                                                                                   | 0             |
| tsc-error.txt        | `tsc --noEmit --strict "$TMPDIR/tsc-scratch.ts"` from `$TMPDIR`; the scratch held `const x: number = "rlm125-type-error"` and a `console.log` | 2             |
| vitest-failure.txt   | `npx vitest run test/unit/inspectNative.test.ts --maxWorkers=3`, run-log lines 43–100 (raw; ANSI escapes kept)                                | 1 (whole run) |
| vitest-summary.txt   | `npx vitest run test/unit/inspectNative.test.ts --maxWorkers=3 2>&1 \| tail -12` (raw; ANSI escapes kept)                                     | 1 (whole run) |
