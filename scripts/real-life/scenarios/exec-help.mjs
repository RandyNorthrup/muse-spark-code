// A person asks the headless command how it is used.
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
        'it is short enough to read at a terminal (at most 80 lines)',
        lines <= 80,
        `${String(lines)} lines`,
      )
    },
  },
}
