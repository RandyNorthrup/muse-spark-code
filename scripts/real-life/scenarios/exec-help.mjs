// A person asks the headless command how it is used.
//
// How long may the answer be? No longer than the longest help other terminal
// agents print for a command, measured on 2026-10-12 with the versions
// installed that day: Claude Code 2.1.288 `claude --help` 310 lines; Codex
// CLI 0.159.0 `codex --help` 137 and `codex exec --help` 112; GitHub CLI
// 2.87.3 `gh pr create --help` 79. The bound is the longest of them.
const LONGEST_HELP_ELSEWHERE = 310

export default {
  title: 'exec --help says how exec is used',
  exec: {
    claims: ['ref/cli/exec/exec---help---h'],
    requests: 0,
    async run(person, see) {
      const help = await person.command(['exec', '--help'])
      see('the command ends with exit code 0', help.code === 0, `exit ${String(help.code)}`)
      for (const flag of ['--max-requests', '--max-budget-usd', '--permission-mode', '--output']) {
        see(
          `it names ${flag}`,
          help.stdout.includes(flag),
          `${String(help.stdout.length)} characters of help`,
        )
      }
      const lines = help.stdout.split('\n').length
      see(
        `it is no longer than the longest help of other terminal agents (${String(LONGEST_HELP_ELSEWHERE)} lines)`,
        lines <= LONGEST_HELP_ELSEWHERE,
        `${String(lines)} lines`,
      )
    },
  },
}
