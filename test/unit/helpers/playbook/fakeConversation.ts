// A conversation's playbook as its controller sees it (M116, C-M116-6): it
// records what it was asked and, by default, lets everything through exactly
// as a conversation with nothing under review would have it.
import { vi } from 'vitest'
import type {
  PlaybookConversation,
  PlaybookConversationHost,
  PlaybookReviewRequest,
} from '../../../../src/host/playbook/playbookEntry'

type Review = PlaybookReviewRequest<{ readonly turnId: string }>

export interface FakeDispatch {
  readonly kind: string
  readonly sessionId: string | undefined
  readonly targetId: string | undefined
}

export interface FakeConversationOptions {
  /** What a review turn is sent with; by default the parts it came with. */
  readonly review?: (request: Review) => Promise<{ readonly turnId: string }>
  /** Thrown instead of running a dispatch's work. */
  readonly refusal?: Error
}

export function fakePlaybookConversation(options: FakeConversationOptions = {}) {
  const hosts: PlaybookConversationHost[] = []
  const reviews: Review[] = []
  const dispatches: FakeDispatch[] = []
  const playbook: PlaybookConversation = {
    review: async <T extends { readonly turnId: string }>(
      request: PlaybookReviewRequest<T>,
    ): Promise<T> => {
      reviews.push(request)
      await options.review?.(request)
      return await request.submit(request.parts)
    },
    dispatch: async <T>(
      kind: string,
      sessionId: string | undefined,
      targetId: string | undefined,
      effect: () => Promise<T>,
    ): Promise<T> => {
      dispatches.push({ kind, sessionId, targetId })
      if (options.refusal !== undefined) throw options.refusal
      return await effect()
    },
    observed: vi.fn(() => Promise.resolve()),
    ended: vi.fn(),
    act: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
  }
  return {
    playbook,
    hosts,
    reviews,
    dispatches,
    /** `ConversationDeps.playbook`: the window's lazy bundle, as the controller calls it. */
    factory: vi.fn((host: PlaybookConversationHost) => {
      hosts.push(host)
      return playbook
    }),
  }
}
