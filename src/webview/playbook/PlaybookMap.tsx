// The map's settings navigation belongs to the playbook's own lazy closure.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { UI_TEXT } from '../../shared/constants'
import type { PlaybookSurfacePort } from '../../runtime/playbook/command'
import { PlaybookPanel } from './PlaybookPanel'

export function PlaybookMap({
  port,
  children,
}: {
  readonly port: PlaybookSurfacePort
  readonly children: ReactNode
}) {
  const [isOpen, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const previouslyOpen = useRef(isOpen)
  useEffect(() => {
    if (!isOpen && previouslyOpen.current) opener.current?.focus()
    previouslyOpen.current = isOpen
  }, [isOpen])
  return isOpen ? (
    <>
      <button
        type="button"
        className="tool-more"
        onClick={() => {
          setOpen(false)
        }}
      >
        {UI_TEXT.agentBack}
      </button>
      <PlaybookPanel port={port} />
    </>
  ) : (
    <>
      <button
        ref={opener}
        type="button"
        className="tool-more"
        onClick={() => {
          setOpen(true)
        }}
      >
        {UI_TEXT.playbookSettings}
      </button>
      {children}
    </>
  )
}
