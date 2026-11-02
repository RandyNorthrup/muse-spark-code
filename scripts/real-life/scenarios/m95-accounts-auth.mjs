// M95: accounts and providers from the terminal.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/e2e/acpStdio.e2e.test.ts, `the ACP agent over stdio (M63) > asks for sign-in
//   when Muse Code is signed out, and for the key on the Model API backend`
// - test/e2e/acpStdio.e2e.test.ts, `the ACP agent over stdio (M63) > reads Muse Code's
//   readiness from the credential file, and asks the CLI where only it can say (PR #49)`
// - test/unit/runtimeAccountsService.test.ts, the installed service rows
//   (list, thresholds, refused providers file as its own sentence)
//
// What the run's own setup covers (add, test) is not repeated here: this is
// the read side (status, list, models) plus a key that is not there.
//
// Expected model attempts: 0. Dollar cap: $0.00.
const NO_SUCH_PROVIDER = 'no-such-provider-real-life'

export default {
  title: 'auth status and providers list read what is stored',
  exec: {
    claims: ['ref/cli/auth/auth-status', 'ref/cli/providers-list', 'ref/feature/providers'],
    requests: 0,
    maxUsd: '0.00',
    async run(person, see) {
      const { route } = person
      const missing = await person.command(['auth', 'status', '--provider', NO_SUCH_PROVIDER])
      see(
        'a provider with no key is not reported as ready',
        missing.code !== 0,
        `exit ${String(missing.code)}`,
      )
      see(
        'the answer says why in its own words',
        `${missing.stdout} ${missing.stderr}`.trim() !== '',
        `${missing.stdout} ${missing.stderr}`.trim(),
      )
      const listed = await person.command(['providers', 'list'])
      see('providers list ends with exit code 0', listed.code === 0, `exit ${String(listed.code)}`)
      if (route.provider === undefined) {
        person.skip(
          'the listing names the route provider',
          'no provider on a Meta route: the key rides on standard input',
        )
        person.skip(
          'the entry lists the route model',
          'no provider on a Meta route: the key rides on standard input',
        )
        return
      }
      see(
        'the listing names the provider this route stored',
        listed.stdout.includes(route.provider),
        listed.stdout.trim(),
      )
      const status = await person.command(['auth', 'status', '--provider', route.provider])
      see(
        'the stored provider reports ready',
        status.code === 0,
        `exit ${String(status.code)}: ${`${status.stdout} ${status.stderr}`.trim()}`,
      )
      const models = await person.command(['providers', 'models', route.provider])
      see(
        'the entry lists its models with exit code 0',
        models.code === 0,
        `exit ${String(models.code)}`,
      )
      see(
        'the route model is among them',
        models.stdout.includes(route.model),
        models.stdout.trim(),
      )
    },
  },
}
