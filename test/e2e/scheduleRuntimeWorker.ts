// Fake-only stdio fixture: real runtime delivery and Model API over loopback.
import path from 'node:path'
import { Writable } from 'node:stream'
import { ndJsonStream } from '@agentclientprotocol/sdk'
import { createAcpAgent } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import { acpQuestionClock } from '../../src/acp/questionDeferralBundle'
import { createRuntimeQuestionRegistry } from '../../src/runtime/questions/acpRegistry'
import { createAcpQuestions, acpElicitation } from '../../src/acp/questionDeferralEntry'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { webReadable } from '../../src/runtime/webStreams'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { Usd, sumUsd } from '../../src/shared/usd'
import { fakeModelApiClientSettings, FAKE_MODEL_API_ACCOUNT_ID } from '../unit/helpers/fakeModelApi'
import { FakeScheduleBackground } from '../unit/helpers/schedules/background'
import { fakeModelApiHostDeps } from '../unit/helpers/modelApiHostDeps'
import { memoryToolIo } from '../unit/helpers/fakeToolIo'

async function main() {
  const [mode, root, data, origin, paid] = process.argv.slice(2)
  if (root === undefined || data === undefined || origin === undefined)
    throw new Error('missing fixture arguments')
  const log = {
    trace() {
      /* Fixture trace stays off the protocol stream. */
    },
    info() {
      /* Fixture info stays off the protocol stream. */
    },
    warn(text: string) {
      process.stderr.write(`${text}\n`)
    },
    error(text: string) {
      process.stderr.write(`${text}\n`)
    },
  }
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: new ModelApiClient({ ...fakeModelApiClientSettings(log), baseUrl: origin, fetch }),
      workspaceRoot: root,
      io: memoryToolIo({}, root),
      log,
    }),
    platform: process.platform,
    isPaidFeatureOn: () => true,
  })
  const backend = {
    kind: 'modelApi' as const,
    readiness: () => Promise.resolve({ state: 'ready' as const }),
    hostFor: () => Promise.resolve(host),
  }
  const registries: ReturnType<typeof createRuntimeQuestionRegistry>[] = []
  const questions = (session: Parameters<typeof createRuntimeQuestionRegistry>[0]['session']) => {
    const registry: ReturnType<typeof createRuntimeQuestionRegistry> =
      createRuntimeQuestionRegistry(
        { session, clock: acpQuestionClock, deliver: (message) => registry.queue(message) },
        path.join(data, 'questions'),
        'modelApi',
        () => {
          process.stderr.write('Question persistence failed\n')
        },
      )
    registries.push(registry)
    return registry
  }
  const engine = createScheduleEngine({
    fs: createNodeScheduleFs(path.join(data, 'schedules')),
    queue: createNodeScheduleQueue(path.join(data, 'schedules')),
    runtimeDelivery: {
      backendFor: () => Promise.resolve(backend),
      allowsContributorModels: false,
      row: (text) => {
        process.stderr.write(`${text}\n`)
      },
      deferQuestions: async (session, _backend, event, context) => {
        const registry = questions(session)
        await registry.load()
        await registry.register(event, { askedAt: Date.now(), turnId: context.runId })
        await registry.defer(event.userInputId)
      },
      ...(paid === 'on' && {
        paid: (_schedule, session) => {
          let spent = Usd.from(0).toAmount()
          let isUnknown = false
          return Promise.resolve({
            policy: {
              modelId: session.modelId,
              accountId: FAKE_MODEL_API_ACCOUNT_ID,
              allows: (feature) => feature === 'scheduledPrompts',
              reserve: () =>
                Promise.resolve({
                  claimId: 'fake-runtime-ledger',
                  reservedUsd: Usd.from(1).toAmount(),
                  check: () => ({ spentUsd: spent, hasUnknownHistoricalFees: isUnknown }),
                  settle: (cost, isUncertain = false) => {
                    spent = sumUsd(spent, cost)
                    isUnknown ||= isUncertain
                    return Promise.resolve({ spentUsd: spent, hasUnknownHistoricalFees: isUnknown })
                  },
                }),
            },
            cost: () =>
              Promise.resolve({
                usd: spent,
                certainty: isUnknown ? ('unknown' as const) : ('exact' as const),
                retainedLiabilityUsd: Usd.from(0).toAmount(),
              }),
          })
        },
      }),
    },
    verifyWake: () => Promise.resolve({ scheduledPrompts: false }),
    platform: 'linux',
    backgroundEntry: new FakeScheduleBackground(),
  })
  try {
    if (mode === 'run-due') {
      const result = await engine.runtime.command(
        { operation: 'run-due', isJson: true },
        path.dirname(root),
      )
      process.stdout.write(`${result.output}\n`)
      process.exitCode = result.exitCode
    } else {
      const agent = createAcpAgent({
        backend,
        version: '0.0.0-test',
        defaultCwd: root,
        options: {
          canBypass: false,
          allowsContributorModels: false,
          initialMode: 'manual',
          scheduleAuthorization: { scheduledPrompts: true, maxBudgetUsd: Usd.from(1).toAmount() },
        },
        signIn: { id: 'fake', name: 'fake', description: 'fake', args: [], command: 'fake' },
        paid: new AcpPaidUse({
          flagged: [],
          canRemember: () => false,
          grants: {
            read: () => new Set(),
            add: () => Promise.resolve(),
            forget: () => Promise.resolve(),
          },
          log,
        }),
        questions: ({ session }) => questions(session),
        questionBundle: () => ({ createAcpQuestions, acpElicitation }),
        schedules: engine.runtime,
        log,
      })
      await agent.connect(ndJsonStream(Writable.toWeb(process.stdout), webReadable(process.stdin)))
        .closed
    }
  } finally {
    await engine.runtime.close()
    for (const registry of registries) {
      registry.dispose()
      await registry.flush()
    }
    await host.close()
  }
}
void main().catch(() => {
  process.stderr.write('fake schedule worker failed\n')
  process.exitCode = 1
})
