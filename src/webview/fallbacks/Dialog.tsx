import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Modal } from '../components/Modal'

/** The page behind the dialog is inert; closing restores the opener's focus. */
export function Dialog({
  title,
  onCancel,
  children,
}: {
  readonly title: string
  readonly onCancel: () => void
  readonly children: ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const opener = document.activeElement
    const siblings: HTMLElement[] = []
    let branch: HTMLElement | null = container.current
    while (branch !== null && branch.parentElement !== null) {
      const parent = branch.parentElement
      for (const element of parent.children) {
        if (element !== branch && element instanceof HTMLElement) siblings.push(element)
      }
      if (parent === document.body) break
      branch = parent
    }
    const previous = siblings.map((element) => ({ element, inert: element.inert }))
    for (const { element } of previous) element.inert = true
    return () => {
      for (const { element, inert } of previous) element.inert = inert
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  return (
    <div ref={container} className="fallback-dialog">
      <Modal title={title} titleId="fallback-title" onClose={onCancel}>
        {children}
      </Modal>
    </div>
  )
}
