// S/map and native hosts inject this read-only projection of their task record.
// Rendering a route, branch or usage never grants control or opens a peer link.
import * as z from 'zod/mini'
import { DEVICE_LIMITS, UI_TEXT } from '../../../../shared/constants'
import { deviceRouteSchema } from '../../../../shared/devices'
import { formatUsd } from '../../../../shared/l10n/exactUsd'

const taskView = z.strictObject({
  taskId: z.string().check(z.regex(/^[a-f0-9]{32}$(?![\s\S])/)),
  title: z.string().check(z.minLength(1), z.maxLength(DEVICE_LIMITS.labelChars)),
  route: deviceRouteSchema,
  branch: z.optional(z.string().check(z.minLength(1), z.maxLength(DEVICE_LIMITS.pathChars))),
  usage: z.strictObject({
    kind: z.enum(['known', 'estimated', 'uncertain']),
    amountUsd: z
      .number()
      .check(z.gte(0), z.lte(DEVICE_LIMITS.spendUsd * DEVICE_LIMITS.unresolvedAttempts)),
  }),
})
export type DeviceTaskView = z.infer<typeof taskView>

export function DeviceTaskDetails({
  input,
  deviceLabel,
}: {
  readonly input: unknown
  readonly deviceLabel: string
}) {
  const parsed = taskView.safeParse(input)
  if (!parsed.success) return <p role="alert">{UI_TEXT.devices.invalidMessage}</p>
  const task = parsed.data
  return (
    <article className="device-card" aria-label={task.title}>
      <h2>{task.title}</h2>
      <p>
        {UI_TEXT.devices.title}: {deviceLabel}
      </p>
      <p>
        <code>
          {task.route.model.providerId}/{task.route.model.modelId}
        </code>
      </p>
      <dl className="device-facts">
        <div>
          <dt>{UI_TEXT.devices.pair}</dt>
          <dd>
            <code>{task.route.pairId}</code>
          </dd>
        </div>
        <div>
          <dt>{UI_TEXT.devices.pool}</dt>
          <dd>
            <code>{task.route.poolId}</code>
          </dd>
        </div>
        <div>
          <dt>{UI_TEXT.devices.entry}</dt>
          <dd>
            <code>{task.route.entryId}</code>
          </dd>
        </div>
      </dl>
      {task.branch !== undefined && (
        <p>
          {UI_TEXT.devices.taskBranch}: <code>{task.branch}</code>
        </p>
      )}
      <p>
        {UI_TEXT.devices.usageKinds[task.usage.kind]}: {formatUsd(task.usage.amountUsd, 2)}
      </p>
    </article>
  )
}
