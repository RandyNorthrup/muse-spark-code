import path from 'node:path'
import type { AgentSession } from '../../core/agent/agentBackend'
import type { AcpBackend } from '../../acp/agent'
import type { RuntimeBackend } from '../backends'
import type { Logger } from '../../host/logger'
import { acpQuestionClock } from '../../acp/questionDeferralBundle'
import { runtimeQuestionsLoader } from '../questions/questionRegistryBundle'
import { RUNTIME_QUESTIONS_BUNDLE_FILE, UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import type { RuntimeScheduleDeliveryPorts } from './delivery'
import type * as QuestionsEntry from '../questions/questionRegistryEntry'

/** Backend managers are opened only when a due fire resolves its target. */
export function runtimeScheduleSessionFactory(input: {
  readonly create: (backend: AcpBackend['kind']) => Promise<RuntimeBackend>
  readonly current?: RuntimeBackend
  readonly distDir: string
  readonly dataDir: string
  readonly log: Logger
  readonly allowsContributorModels: boolean
}) {
  const backends = new Map<AcpBackend['kind'], Promise<RuntimeBackend>>()
  if (input.current !== undefined)
    backends.set(input.current.backend.kind, Promise.resolve(input.current))
  const questions = new Map<
    AgentSession,
    ReturnType<typeof QuestionsEntry.createRuntimeQuestionRegistry>
  >()
  const loadQuestions = runtimeQuestionsLoader(
    path.join(input.distDir, RUNTIME_QUESTIONS_BUNDLE_FILE),
    input.log,
  )
  let isClosed = false
  return {
    ports: {
      allowsContributorModels: input.allowsContributorModels,
      async backendFor(kind) {
        if (isClosed) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
        let pending = backends.get(kind)
        if (pending === undefined) {
          pending = input.create(kind)
          backends.set(kind, pending)
        }
        const runtime = await pending
        return runtime.backend
      },
      row: (text) => {
        process.stderr.write(`${text}\n`)
      },
      async deferQuestions(session, backend, event, context) {
        if (isClosed) throw new Error(UI_TEXT.questionAnswerFailed)
        let registry = questions.get(session)
        if (registry === undefined) {
          registry = loadQuestions().createRuntimeQuestionRegistry(
            {
              session,
              clock: acpQuestionClock,
              // No attached editor owns this background session's answers.
              // Keep them durable for the ACP session that later loads it.
              deliver: (message) => {
                const current = questions.get(session)
                if (current === undefined) throw new Error(UI_TEXT.questionAnswerFailed)
                return current.queue(message)
              },
            },
            path.join(input.dataDir, 'questions'),
            backend,
            () => {
              input.log.warn('Scheduled question operation failed')
            },
            UI_TEXT,
            uiLocale(),
          )
          questions.set(session, registry)
        }
        await registry.load()
        await registry.register(event, { askedAt: Date.now(), turnId: context.runId })
        await registry.defer(event.userInputId)
      },
    } satisfies RuntimeScheduleDeliveryPorts,
    async close(): Promise<void> {
      if (isClosed) return
      isClosed = true
      const results = await Promise.allSettled(
        Array.from(questions.values(), async (registry) => {
          registry.dispose()
          await registry.flush()
        }),
      )
      const runtimes = await Promise.allSettled(backends.values())
      const cleanup = await Promise.allSettled(
        runtimes.flatMap((result) =>
          result.status === 'fulfilled' && result.value !== input.current
            ? [result.value.close()]
            : [],
        ),
      )
      if ([...results, ...cleanup].some((result) => result.status === 'rejected'))
        throw new Error(UI_TEXT.scheduleV2.runtime.cleanupFailed)
    },
  }
}
