// Muse Desktop (M111, D91.16) lane ST1: the mounted system page. ST2 adds
// its own cases beside these; the nav ids and titles in SettingsApp grow
// with them.

import type { ReactNode } from 'react'
import type { SettingsSystemClient, SettingsSystemPageId } from '../../../shared/desktop/settings'
import { appearancePageBinding } from '../system/AppearancePage'
import { BluetoothPageLoader } from '../system/BluetoothPage'
import { cellularPageBinding } from '../system/CellularPage'
import { dateTimePageBinding } from '../system/DateTimePage'
import { displaysPageBinding } from '../system/DisplaysPage'
import { localePageBinding } from '../system/LocalePage'
import { networkPageBinding } from '../system/NetworkPage'
import { powerPageBinding } from '../system/PowerPage'
import { printersPageBinding } from '../system/PrintersPage'
import { soundPageBinding } from '../system/SoundPage'
import { storagePageBinding } from '../system/StoragePage'
import { BoundPage } from './BoundPage'

export function SystemPages({
  id,
  client,
}: {
  readonly id: SettingsSystemPageId
  readonly client: SettingsSystemClient
}): ReactNode {
  switch (id) {
    case 'appearance': {
      return <BoundPage binding={appearancePageBinding} client={client} />
    }
    case 'displays': {
      return <BoundPage binding={displaysPageBinding} client={client} />
    }
    case 'sound': {
      return <BoundPage binding={soundPageBinding} client={client} />
    }
    case 'network': {
      return <BoundPage binding={networkPageBinding} client={client} />
    }
    case 'bluetooth': {
      return <BluetoothPageLoader client={client} />
    }
    case 'cellular': {
      return <BoundPage binding={cellularPageBinding} client={client} />
    }
    case 'power': {
      return <BoundPage binding={powerPageBinding} client={client} />
    }
    case 'printers': {
      return <BoundPage binding={printersPageBinding} client={client} />
    }
    case 'storage': {
      return <BoundPage binding={storagePageBinding} client={client} />
    }
    case 'datetime': {
      return <BoundPage binding={dateTimePageBinding} client={client} />
    }
    case 'locale': {
      return <BoundPage binding={localePageBinding} client={client} />
    }
  }
}
