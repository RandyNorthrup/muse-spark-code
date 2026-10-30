// M104 lane D: the panel's ThemePort, fed by MHP `theme` frames. A frame's
// `--muse-*` tokens name the same suffix as each host role's `--ms-*`
// variable in consumers.json; tokens with no role are the host's own and
// stay out of the snapshot. Before the first frame the snapshot is the
// system mode with no roles, so the generated Muse palette paints.
import { hostRoles } from '../../../../design/tokens/generated/consumers.json'
import { panelThemePayloadSchema } from '../../../shared/hostApi/panel'
import type { MessageSource } from '../../hostBridge'
import type { ThemePort } from './themeBridge'

const roleByToken = new Map<string, string>(
  Object.entries(hostRoles).map(([role, { variable }]) => [
    `--muse-${variable.replace(/^--ms-/, '')}`,
    role,
  ]),
)

const modes = {
  light: 'light',
  dark: 'dark',
  highContrastLight: 'hc-light',
  highContrastDark: 'hc-dark',
} as const

export function panelThemePort(source: MessageSource, isSystemDark: boolean): ThemePort {
  let current: unknown = { mode: isSystemDark ? 'dark' : 'light', roles: {} }
  const receivers = new Set<(snapshot: unknown) => void>()
  source.addEventListener('message', (event: MessageEvent<unknown>) => {
    const parsed = panelThemePayloadSchema.safeParse(event.data)
    if (!parsed.success) return
    const roles: Record<string, string> = {}
    for (const [token, value] of Object.entries(parsed.data.theme.tokens)) {
      const role = roleByToken.get(token)
      if (role !== undefined) roles[role] = value
    }
    current = { mode: modes[parsed.data.theme.kind], roles }
    for (const receive of receivers) receive(current)
  })
  return {
    current: () => current,
    subscribe: (receive) => {
      receivers.add(receive)
      return () => {
        receivers.delete(receive)
      }
    },
  }
}
