// What the AuthService suites share: backend facts over one real
// `CliAccount`, as activation wires them. The CLI resolution and the
// backend restart stay the caller's: each suite drives its own.
import type { AuthBackendFacts } from '../../../src/host/auth/authService'
import type { CliAccount } from '../../../src/host/auth/cliAccount'

export function cliAccountBackendFacts(
  account: CliAccount,
  file: string,
  resolveCli: AuthBackendFacts['resolveCli'],
  restartBackend: () => Promise<unknown>,
): AuthBackendFacts {
  return {
    resolveCli,
    cliSignIn: (isUserAction) => account.signIn(isUserAction),
    peekCliSignIn: () => account.peekFile(),
    abandonCliProbe: () => {
      account.abandonProbe()
    },
    forgetCliAnswers: () => {
      account.forgetAnswers()
    },
    credentialFilePath: () => file,
    credentialFileModifiedAt: () => undefined,
    hasEnvironmentKey: () => false,
    getBackendMode: () => 'auto',
    restartBackend: async () => {
      await restartBackend()
    },
    logOutCli: () => Promise.resolve(false),
  }
}
