// Keep settings, journal schemas and formatting out of the startup closure.
import { lazy, Suspense, type ReactNode } from 'react'
import type { PlaybookRecord, PlaybookWhyNote } from '../../shared/playbook'
import type { PlaybookPanelProps } from './PlaybookPanel'

const Panel = lazy(async () => {
  const { PlaybookPanel } = await import('./PlaybookPanel')
  return { default: PlaybookPanel }
})
const Notes = lazy(async () => {
  const { PlaybookNoteRows } = await import('./PlaybookRows')
  return { default: PlaybookNoteRows }
})
const Badge = lazy(async () => {
  const { PlaybookStrikeBadge } = await import('./PlaybookRows')
  return { default: PlaybookStrikeBadge }
})
const Details = lazy(async () => {
  const { PlaybookAgentDetails } = await import('./PlaybookRows')
  return { default: PlaybookAgentDetails }
})
const Map = lazy(async () => {
  const { PlaybookMap } = await import('./PlaybookMap')
  return { default: PlaybookMap }
})

export function DeferredPlaybookMap(props: PlaybookPanelProps & { readonly children: ReactNode }) {
  return (
    <Suspense fallback={<span data-deferred-loading="playbook" />}>
      <Map {...props} />
    </Suspense>
  )
}

export function DeferredPlaybookPanel(props: PlaybookPanelProps) {
  return (
    <Suspense fallback={<span data-deferred-loading="playbook" />}>
      <Panel {...props} />
    </Suspense>
  )
}
export function DeferredPlaybookNotes(props: { readonly notes: readonly PlaybookWhyNote[] }) {
  return (
    <Suspense fallback={<span data-deferred-loading="playbook" />}>
      <Notes {...props} />
    </Suspense>
  )
}
export function DeferredPlaybookBadge(props: { readonly records: readonly PlaybookRecord[] }) {
  return (
    <Suspense fallback={<span data-deferred-loading="playbook" />}>
      <Badge {...props} />
    </Suspense>
  )
}

export function DeferredPlaybookDetails(props: { readonly records: readonly PlaybookRecord[] }) {
  return (
    <Suspense fallback={<span data-deferred-loading="playbook" />}>
      <Details {...props} />
    </Suspense>
  )
}
