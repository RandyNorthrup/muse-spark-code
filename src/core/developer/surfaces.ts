// U/H/W bind this controller to their authenticated transports. A remote
// companion can display the page/badge, but cannot unlock or change local
// testing authority. ACP clients and terminal requests are local principals.
import { UI_TEXT, DEVELOPER_COMMAND_ID, DEVELOPER_SETTING_ID } from '../../shared/constants'
import { fill, formatDateTime } from '../../shared/l10n/text'
import {
  developerRequestSchema,
  type DeveloperReply,
  type DeveloperSnapshot,
} from '../../shared/developerOptions'
import { DeveloperOptionsError, type DeveloperOptions } from './developerOptions'

export interface DeveloperSurface {
  readonly id: string
  readonly isLocal: boolean
  readonly kind: 'palette' | 'terminal' | 'page'
}

export async function handleDeveloperRequest(
  owner: DeveloperOptions,
  surface: DeveloperSurface,
  message: unknown,
): Promise<DeveloperReply> {
  const parsed = developerRequestSchema.safeParse(message)
  if (!parsed.success) return { type: 'developer/error', code: 'invalidRequest' }
  const request = parsed.data
  if (!surface.isLocal && request.type !== 'developer/read')
    return { type: 'developer/error', code: 'locked' }
  try {
    await owner.refresh()
    switch (request.type) {
      case 'developer/read': {
        return owner.snapshot()
      }
      case 'developer/versionClick': {
        return await owner.versionClick(surface.id)
      }
      case 'developer/unlock': {
        if (surface.kind === 'page') throw new DeveloperOptionsError('locked')
        return await owner.unlock(surface.kind)
      }
      case 'developer/setMultiple': {
        return await owner.setMultiple(request.enabled)
      }
      case 'developer/addProfile': {
        return await owner.addProfile(request.provider, request.account)
      }
      case 'developer/removeProfile': {
        return await owner.removeProfile(request.id)
      }
      case 'developer/reset': {
        return await owner.reset()
      }
    }
  } catch (error) {
    return {
      type: 'developer/error',
      code: error instanceof DeveloperOptionsError ? error.code : 'unavailable',
    }
  }
}

/** The visible machine setting uses the same confirmations and owner. The
 * host must restore its checkbox from the returned snapshot, even on denial. */
export async function setDeveloperMachineSetting(
  owner: DeveloperOptions,
  isEnabled: boolean,
): Promise<DeveloperSnapshot> {
  if (isEnabled && !owner.snapshot().isUnlocked) await owner.unlock('palette')
  return await owner.setMultiple(isEnabled)
}

/** Metadata read after localization installation; W copies this into its
 * manifest/catalogue, H into /help and terminal help, U into settings. */
export function developerHelpRows() {
  return [
    {
      command: DEVELOPER_COMMAND_ID,
      title: UI_TEXT.developer.title,
      description: UI_TEXT.developer.helpUnlock,
    },
    {
      command: 'developer',
      title: UI_TEXT.developer.title,
      description: UI_TEXT.developer.helpTerminal,
    },
    {
      command: DEVELOPER_SETTING_ID,
      title: UI_TEXT.developer.allowMultiple,
      description: UI_TEXT.developer.multipleWarning,
    },
  ]
}

export function developerBadge(snapshot: DeveloperSnapshot): string | undefined {
  return snapshot.isUnlocked ? UI_TEXT.developer.badge : undefined
}

export function developerConfirmation(question: 'unlock' | 'multiple' | 'reset'): {
  title: string
  message: string
  accept: string
  cancel: string
} {
  const messages = {
    unlock: UI_TEXT.developer.unlockWarning,
    multiple: UI_TEXT.developer.multipleWarning,
    reset: UI_TEXT.developer.resetWarning,
  }
  return {
    title: UI_TEXT.developer.title,
    message: messages[question],
    accept: UI_TEXT.accounts.confirm,
    cancel: UI_TEXT.accounts.cancel,
  }
}

/** ACP/headless/terminal text surfaces share the badge and expiry template. */
export function developerStatusText(snapshot: DeveloperSnapshot): string {
  return !snapshot.isUnlocked || snapshot.expiresAt === null
    ? UI_TEXT.developer.locked
    : fill(UI_TEXT.developer.expires, { time: formatDateTime(snapshot.expiresAt) })
}
