// The glyph for each permission mode, shared by the mode button and the
// Modes menu (the Claude Code set: hand, code, plan, bolt, plus a warning
// triangle for Bypass permissions).

import type { ReactNode } from 'react'
import type { PermissionMode } from '../../shared/constants'
import { BoltIcon, CodeIcon, HandIcon, PlanIcon, WarningIcon } from './icons'

const MODE_ICONS: Readonly<Record<PermissionMode, () => ReactNode>> = {
  manual: () => <HandIcon />,
  acceptEdits: () => <CodeIcon />,
  plan: () => <PlanIcon />,
  auto: () => <BoltIcon />,
  bypassPermissions: () => <WarningIcon />,
}

export function modeIcon(mode: PermissionMode): ReactNode {
  return MODE_ICONS[mode]()
}
