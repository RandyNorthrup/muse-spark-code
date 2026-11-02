// Muse Desktop (M111, D91.16) lane ST1: the settings app's shell, shared
// with ST2. The nav lists every page with roving focus; the main column
// shows the active page's title and its bound state. Without a client
// (lane SY's transport has not landed) the shell says the service is
// unavailable instead of rendering dead pages.

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import {
  SETTINGS_SYSTEM_PAGE_IDS,
  type SettingsSystemClient,
  type SettingsSystemPageId,
} from '../../../shared/desktop/settings'
import { webviewKey } from '../../../shared/keybindings'
import { SystemPages } from './SystemPages'

function pageTitle(id: SettingsSystemPageId): string {
  const text = UI_TEXT.settingsSystem
  switch (id) {
    case 'appearance': {
      return text.navAppearance
    }
    case 'displays': {
      return text.navDisplays
    }
    case 'sound': {
      return text.navSound
    }
    case 'network': {
      return text.navNetwork
    }
    case 'bluetooth': {
      return text.navBluetooth
    }
    case 'cellular': {
      return text.navCellular
    }
    case 'power': {
      return text.navPower
    }
    case 'printers': {
      return text.navPrinters
    }
    case 'storage': {
      return text.navStorage
    }
    case 'datetime': {
      return text.navDateTime
    }
    case 'locale': {
      return text.navLocale
    }
  }
}

export function SettingsNav({
  active,
  onSelect,
}: {
  readonly active: SettingsSystemPageId
  readonly onSelect: (id: SettingsSystemPageId) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const buttons = useRef(new Map<SettingsSystemPageId, HTMLButtonElement>())

  const onNavKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = SETTINGS_SYSTEM_PAGE_IDS.indexOf(active)
    let next: SettingsSystemPageId | undefined
    switch (webviewKey('settings.nav', event)) {
      case 'next': {
        next = SETTINGS_SYSTEM_PAGE_IDS[(index + 1) % SETTINGS_SYSTEM_PAGE_IDS.length]
        break
      }
      case 'previous': {
        next =
          SETTINGS_SYSTEM_PAGE_IDS[
            (index - 1 + SETTINGS_SYSTEM_PAGE_IDS.length) % SETTINGS_SYSTEM_PAGE_IDS.length
          ]
        break
      }
      case 'first': {
        next = SETTINGS_SYSTEM_PAGE_IDS[0]
        break
      }
      case 'last': {
        next = SETTINGS_SYSTEM_PAGE_IDS.at(-1)
        break
      }
      case 'accept': {
        next = active
        break
      }
      default: {
        break
      }
    }
    if (next === undefined) {
      return
    }
    event.preventDefault()
    onSelect(next)
    buttons.current.get(next)?.focus()
  }

  return (
    <nav className="muse-settings-nav" aria-label={text.title}>
      <div className="muse-settings-nav-title">{text.title}</div>
      <div role="listbox" aria-label={text.title} onKeyDown={onNavKeyDown}>
        {SETTINGS_SYSTEM_PAGE_IDS.map((id) => (
          <button
            key={id}
            ref={(element) => {
              if (element === null) {
                buttons.current.delete(id)
              } else {
                buttons.current.set(id, element)
              }
            }}
            type="button"
            role="option"
            aria-selected={id === active}
            tabIndex={id === active ? 0 : -1}
            className="muse-settings-nav-button"
            data-active={id === active}
            onClick={() => {
              onSelect(id)
            }}
          >
            {pageTitle(id)}
          </button>
        ))}
      </div>
    </nav>
  )
}

export function SettingsApp({
  client,
}: {
  readonly client: SettingsSystemClient | undefined
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const [active, setActive] = useState<SettingsSystemPageId>('appearance')

  if (client === undefined) {
    return (
      <div className="muse-settings">
        <div className="muse-settings-unavailable" role="alert">
          <h1 className="muse-settings-unavailable-title">{text.unavailableTitle}</h1>
          <p className="muse-settings-unavailable-detail">{text.unavailableDetail}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="muse-settings">
      <SettingsNav active={active} onSelect={setActive} />
      <main className="muse-settings-main">
        <h1 className="muse-settings-page-title">{pageTitle(active)}</h1>
        <SystemPages id={active} client={client} />
      </main>
    </div>
  )
}
