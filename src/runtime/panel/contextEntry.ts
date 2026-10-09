import path from 'node:path'
import { createPlanFiles, createPlanIo } from '../../host/planFeatures'
import { planMarkdownLoader } from '../../host/planMarkdownBundle'
import { withCheckpointEdit } from '../../host/checkpoints/checkpointHost'
import type { RuntimeFeatureContext } from './runtimeFeatures'
import { ACP_PAID_OPTIONS, PLAN_MARKDOWN_BUNDLE_FILE, UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

/** Saved plans reuse the confined bounded store, the actual recorder and fresh-session controller. */
export async function createRuntimePlans(
  context: RuntimeFeatureContext,
  distDir: string,
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  const { ports } = context
  const check = () => {
    context.signal?.throwIfAborted()
    if (!ports.options.trustWorkspace) throw new Error('MHP_WORKSPACE_UNTRUSTED')
  }
  const checkpoints = await ports.runtime.checkpointsFor?.(ports.workspaceRoot)
  if (checkpoints === undefined) throw new Error('MHP_CHECKPOINT_NAMESPACE_UNAVAILABLE')
  const manager = await ports.runtime.modelApiFor?.(ports.workspaceRoot)
  return createPlanFiles({
    workspaceRoot: ports.workspaceRoot,
    platform: process.platform,
    io: createPlanIo({
      log: ports.log,
      now: Date.now,
      edit: async (work) => {
        await withCheckpointEdit(checkpoints.port, ports.log, check, () => work(check))
      },
    }),
    markdown: planMarkdownLoader({
      bundlePath: path.join(distDir, PLAN_MARKDOWN_BUNDLE_FILE),
      log: ports.log,
    }),
    pick: async (items, title, placeholder) => {
      check()
      const picked = await ports.host.request(
        'ui/pick',
        {
          title,
          placeholder,
          items: items.map((item) => ({
            id: item.id,
            title: item.label,
            ...(item.description !== undefined && { description: item.description }),
            ...(item.detail !== undefined && { detail: item.detail }),
          })),
          multiple: false,
        },
        context.signal,
      )
      check()
      return typeof picked?.[0] === 'string' ? picked[0] : undefined
    },
    confirm: async (message, detail, action) => {
      check()
      const answer = await ports.host.request(
        'ui/confirm',
        {
          title: message,
          message: detail,
          choices: [
            { id: ACP_PAID_OPTIONS.allowOnce, title: action },
            { id: ACP_PAID_OPTIONS.deny, title: UI_TEXT.paidDeny },
          ],
        },
        context.signal,
      )
      check()
      return answer === ACP_PAID_OPTIONS.allowOnce
    },
    ...(manager !== undefined && {
      captureOwner: (session) => manager.captureExternalEditOwner(session),
      beginEdit: (file, recorder) => manager.beginExternalEdit(recorder, [file]),
    }),
  })
}
