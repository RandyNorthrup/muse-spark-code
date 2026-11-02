// M63: the agent names itself on the command line.
//
// Deleted titles (docs/real-life/unproven.md, test/e2e/acpStdio.e2e.test.ts):
// - `the ACP agent over stdio (M63) > prints its version and help, and refuses an argument it does not know`
//
// Expected model attempts: 0. Dollar cap: $0.00.
export default {
  title: 'The agent prints its version and help, and refuses an unknown argument',
  exec: {
    claims: ['ref/cli/agent/version', 'ref/cli/agent/help'],
    requests: 0,
    maxUsd: '0.00',
    async run(person, see) {
      const version = await person.command(['--version'])
      see('the version ends with exit code 0', version.code === 0, `exit ${String(version.code)}`)
      see(
        'the version is a dotted number',
        /^\d+\.\d+\.\d+/.test(version.stdout.trim()),
        version.stdout.trim() || '(empty)',
      )
      const help = await person.command(['--help'])
      see('the help ends with exit code 0', help.code === 0, `exit ${String(help.code)}`)
      see(
        'the help names the headless command',
        help.stdout.includes('exec'),
        `${String(help.stdout.length)} characters of help`,
      )
      const unknown = await person.command(['frobnicate-command'])
      see(
        'an unknown argument is refused with exit code 2',
        unknown.code === 2,
        `exit ${String(unknown.code)}`,
      )
      see('the refusal says why', unknown.stderr.trim() !== '', unknown.stderr.trim())
    },
  },
}
