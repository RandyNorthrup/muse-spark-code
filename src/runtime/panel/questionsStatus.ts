// The open-questions count on MHP's status item (M112, D92): the runtime
// publishes one item per session; each bridge maps it to its tool window,
// and the companion page renders it in its status strip. Counts only —
// question text never enters a status frame.
import { failureForLog } from '../../core/backends/musecode/logText'
import type { Logger } from '../../host/logger'
import { logRejection } from '../../host/logger'
import type { MhpParams, MhpResult } from '../../shared/hostApi/methods'

/** The host calls the count needs: its status item, and a notice when that item fails. */
export interface QuestionsStatusHost {
  request<M extends 'ui/status' | 'ui/notify'>(
    method: M,
    params: MhpParams<M>,
    signal?: AbortSignal,
  ): Promise<MhpResult<M>>
}
import { UI_TEXT } from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import type { OpenQuestionsSnapshot } from '../../shared/questions'

export function questionsStatusId(sessionId: string): string {
  return `open-questions:${sessionId}`
}

export function questionsStatusText(count: number): string {
  return plural(UI_TEXT.openQuestionsTabCount, count)
}

export function openQuestionsCount(snapshot: OpenQuestionsSnapshot): number {
  return snapshot.questions.filter((entry) => entry.state === 'open').length
}

export interface QuestionsStatusPublisher {
  update(snapshot: OpenQuestionsSnapshot): void
  releaseSession(sessionId: string): void
  close(): void
}

export function createQuestionsStatusPublisher(
  host: QuestionsStatusHost,
  log: Logger,
): QuestionsStatusPublisher {
  const lastBySession = new Map<string, number>()
  let isClosed = false
  let isFailureSaid = false
  const logFailure = logRejection(log, 'questions status')
  const publish = (sessionId: string, count: number, isVisible: boolean): void => {
    void host
      .request('ui/status', {
        id: questionsStatusId(sessionId),
        text: questionsStatusText(count),
        visible: isVisible,
      })
      .then(() => {
        isFailureSaid = false
      })
      .catch((error: unknown) => {
        log.error(`questions status failed: ${failureForLog(error)}`)
        // What the editor shows is now stale: the next update publishes again
        // even at this count, and the person hears it once, not per update.
        if (lastBySession.get(sessionId) === count) lastBySession.delete(sessionId)
        if (isClosed || isFailureSaid) return
        isFailureSaid = true
        void host
          .request('ui/notify', {
            severity: 'warning',
            message: UI_TEXT.openQuestionsStatusFailed,
          })
          .catch(logFailure)
      })
  }
  return {
    update: (snapshot) => {
      if (isClosed) return
      const count = openQuestionsCount(snapshot)
      if (lastBySession.get(snapshot.sessionId) === count) return
      lastBySession.set(snapshot.sessionId, count)
      publish(snapshot.sessionId, count, count > 0)
    },
    releaseSession: (sessionId) => {
      if (isClosed || !lastBySession.delete(sessionId)) return
      publish(sessionId, 0, false)
    },
    close: () => {
      isClosed = true
      for (const sessionId of lastBySession.keys()) publish(sessionId, 0, false)
      lastBySession.clear()
    },
  }
}
