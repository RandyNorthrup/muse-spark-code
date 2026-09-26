// The language the agent speaks (PLAN.md D33, D62): the terminal's locale
// (`LC_ALL`, `LC_MESSAGES`, `LANG`, as POSIX orders them), else the one the
// runtime reports (Windows sets none of the variables). `de_DE.UTF-8`
// becomes `de-de`, which the table lookup reads as German.

const POSIX_DEFAULT_LOCALES: ReadonlySet<string> = new Set(['', 'C', 'POSIX'])
const LOCALE_VARIABLES = ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const

export function displayLanguage(env: NodeJS.ProcessEnv, runtimeLocale: string): string {
  const posix = LOCALE_VARIABLES.map((name) => env[name]).find(
    (value) => value !== undefined && value !== '',
  )
  const tag =
    posix === undefined || POSIX_DEFAULT_LOCALES.has(posix.split('.', 1)[0] ?? '')
      ? runtimeLocale
      : (posix.split(/[.@]/, 1)[0] ?? posix).replaceAll('_', '-')
  return tag.toLowerCase()
}
