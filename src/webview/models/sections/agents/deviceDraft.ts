// M100 phase 2 (lane W): the unsent peer-invitation draft survives a Devices
// document reload (the QR chunk's Retry reloads it). The draft is public
// invitation text, never a key; the document's own webview state keeps it.
import { createContext } from 'react'

export interface DeviceDraftStore {
  /** The draft the document had before it reloaded. */
  readonly initial: string
  save(text: string): void
}

export const DeviceDraftContext = createContext<DeviceDraftStore | undefined>(undefined)
