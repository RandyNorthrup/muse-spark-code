// The playbook's surfaces stay out of the startup closure: the chat loads
// them on first use through the shared deferred boundary, which announces
// loading with a status and retries a failed chunk without taking the chat
// down (the application error boundary is never the fallback).
import type { ReactNode } from 'react'
import type { PlaybookRecord, PlaybookWhyNote } from '../../shared/playbook'
import { deferred } from '../components/DeferredSurface'
import type { PlaybookPanelProps } from './PlaybookPanel'

const PlaybookMapSurface = deferred(async () => {
  const { PlaybookMap } = await import('./PlaybookMap')
  return { default: PlaybookMap }
}, false)

const PlaybookPanelSurface = deferred(async () => {
  const { PlaybookPanel } = await import('./PlaybookPanel')
  return { default: PlaybookPanel }
}, false)

const PlaybookNotesSurface = deferred(async () => {
  const { PlaybookNoteRows } = await import('./PlaybookRows')
  return { default: PlaybookNoteRows }
}, false)

const PlaybookBadgeSurface = deferred(async () => {
  const { PlaybookStrikeBadge } = await import('./PlaybookRows')
  return { default: PlaybookStrikeBadge }
}, false)

const PlaybookDetailsSurface = deferred(async () => {
  const { PlaybookAgentDetails } = await import('./PlaybookRows')
  return { default: PlaybookAgentDetails }
}, false)

export function DeferredPlaybookMap(props: PlaybookPanelProps & { readonly children: ReactNode }) {
  return <PlaybookMapSurface {...props} />
}

export function DeferredPlaybookPanel(props: PlaybookPanelProps) {
  return <PlaybookPanelSurface {...props} />
}
export function DeferredPlaybookNotes(props: { readonly notes: readonly PlaybookWhyNote[] }) {
  return <PlaybookNotesSurface {...props} />
}
export function DeferredPlaybookBadge(props: { readonly records: readonly PlaybookRecord[] }) {
  return <PlaybookBadgeSurface {...props} />
}

export function DeferredPlaybookDetails(props: { readonly records: readonly PlaybookRecord[] }) {
  return <PlaybookDetailsSurface {...props} />
}
