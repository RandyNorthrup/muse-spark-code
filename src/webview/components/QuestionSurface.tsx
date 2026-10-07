// The small startup store shared by docked cards and transcript markers.
import {
  createContext,
  type ReactNode,
  useContext,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
} from 'react'
import { DOCK_TYPING_GRACE_MS } from '../../shared/constants'
import type { UiState } from '../state/uiState'

export interface QuestionDraft {
  readonly chosen: readonly string[]
  readonly isOther: boolean
  readonly other: string
}

export interface CardDraft {
  readonly choices: Readonly<Record<string, QuestionDraft>>
  readonly activeIndex: number
  readonly isExplaining: boolean
  readonly explanation: string
}
export const EMPTY_CARD_DRAFT: CardDraft = {
  choices: {},
  activeIndex: 0,
  isExplaining: false,
  explanation: '',
}
interface DockCard {
  readonly kind: 'question' | 'elicitation'
  readonly id: string
}
interface AttentionSurface {
  readonly sessionId: string | undefined
  readonly drafts: Readonly<Record<string, CardDraft>>
  readonly update: (id: string, change: Partial<CardDraft>) => void
  readonly navigation: UiState['questionNavigation']
  readonly dockCard: DockCard | undefined
  readonly dockRequests: number
  readonly selectDockCard: (card: DockCard | undefined) => void
  readonly onDismiss: (id: string) => void
}
const AttentionContext = createContext<AttentionSurface | undefined>(undefined)
export function useAttentionSurface() {
  return useContext(AttentionContext)
}

/** Keep the dock's draft through lazy remounts; a session boundary discards it. */
export function QuestionSurface({
  children,
  navigation,
  sessionId,
  onDismiss,
}: {
  readonly children: ReactNode
  readonly navigation: UiState['questionNavigation']
  readonly sessionId: string | undefined
  readonly onDismiss: (id: string) => void
}) {
  const [draftSession, setDraftSession] = useState(sessionId)
  const [drafts, setDrafts] = useState<Readonly<Record<string, CardDraft>>>({})
  const [dockCard, setDockCard] = useState<DockCard>()
  const [dockRequests, setDockRequests] = useState(0)
  const selectDockCard = useCallback((card: DockCard | undefined) => {
    setDockCard(card)
    if (card !== undefined) setDockRequests((previous) => previous + 1)
  }, [])
  const update = useCallback((id: string, change: Partial<CardDraft>) => {
    setDrafts((previous) => ({
      ...previous,
      [id]: { ...(previous[id] ?? EMPTY_CARD_DRAFT), ...change },
    }))
  }, [])
  const value = useMemo(
    () => ({
      sessionId,
      drafts,
      update,
      navigation,
      dockCard,
      dockRequests,
      selectDockCard,
      onDismiss,
    }),
    [sessionId, drafts, update, navigation, dockCard, dockRequests, selectDockCard, onDismiss],
  )
  if (draftSession !== sessionId) {
    setDraftSession(sessionId)
    setDrafts({})
    setDockCard(undefined)
    setDockRequests(0)
  }
  return <AttentionContext value={value}>{children}</AttentionContext>
}

/**
 * Whether the user is typing where focus is: a field holding text, or one
 * that took a key a moment ago. A card arriving then leaves focus there.
 * An empty composer that merely kept focus after a send is not typing.
 */
function isTyping(element: Element | null, lastKeyAt: number): boolean {
  const isRecentKey = Date.now() - lastKeyAt < DOCK_TYPING_GRACE_MS
  const isTextField = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
  return isTextField
    ? element.value !== '' || isRecentKey
    : (element instanceof HTMLSelectElement ||
        (element instanceof HTMLElement && element.isContentEditable)) &&
        isRecentKey
}

export function useAttentionFocus<T extends HTMLElement>(
  focusKey: string | undefined,
  selector: string,
  isInert: boolean,
) {
  const dock = useRef<T>(null)
  const lastKeyAt = useRef(0)
  useEffect(() => {
    const onKey = () => {
      lastKeyAt.current = Date.now()
    }
    document.addEventListener('keydown', onKey, { capture: true })
    return () => {
      document.removeEventListener('keydown', onKey, { capture: true })
    }
  }, [])
  useEffect(() => {
    if (focusKey === undefined || isInert || isTyping(document.activeElement, lastKeyAt.current))
      return
    dock.current?.querySelector<HTMLElement>(selector)?.focus()
  }, [focusKey, selector, isInert])
  return dock
}
