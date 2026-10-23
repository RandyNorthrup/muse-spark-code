// A pair authenticates a key. Only the receiver's current local grant scopes work.
import * as z from 'zod/mini'
import {
  deviceDispatchSchema,
  deviceOfferSchema,
  type DeviceDispatch,
  type DeviceCaps,
} from '../../shared/devices'
import { compareUsdAmounts } from '../../shared/usd'
import { DevicePairingError } from './pairing'

const id = z.string().check(z.regex(/^[a-f0-9]{32}$(?![\s\S])/))
const gitId = z.string().check(z.regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$(?![\s\S])/))
const grantModes = ['plan', 'manual', 'acceptEdits', 'auto'] as const
const digest = z.string().check(z.regex(/^[a-f0-9]{64}$(?![\s\S])/))
export const deviceGrantSchema = z.strictObject({
  pairId: id,
  offer: deviceOfferSchema,
  snapshot: z.strictObject({
    baseCommit: gitId,
    tree: gitId,
    manifestDigest: digest,
    dirtyPreviewDigest: z.optional(digest),
  }),
  modes: z.array(z.enum(grantModes)).check(z.minLength(1), z.maxLength(grantModes.length)),
})
export type DeviceGrant = z.infer<typeof deviceGrantSchema>

/** Policy/approval/paid gates still run locally in E/M96 after this scope check. */
export function assertDeviceGrant(candidate: unknown, input: DeviceDispatch): DeviceCaps {
  const parsed = deviceGrantSchema.safeParse(candidate)
  const dispatch = deviceDispatchSchema.safeParse(input)
  if (!parsed.success || !dispatch.success) throw new DevicePairingError('grant')
  const request = dispatch.data
  const grant = parsed.data
  const offer = grant.offer
  const snapshot = grant.snapshot
  if (
    grant.pairId !== request.identity.pairId ||
    offer.receiverIncarnationId !== request.identity.receiverIncarnationId ||
    offer.repositoryId !== request.repositoryId ||
    offer.grantId !== request.grantId ||
    offer.grantRevision !== request.grantRevision ||
    snapshot.baseCommit !== request.snapshot.baseCommit ||
    snapshot.tree !== request.snapshot.tree ||
    snapshot.manifestDigest !== request.snapshot.manifestDigest ||
    snapshot.dirtyPreviewDigest !== request.snapshot.dirtyPreviewDigest ||
    !grant.modes.includes(request.mode)
  )
    throw new DevicePairingError('grant')
  let caps = offer.caps
  if (request.kind === 'check') {
    if (
      !offer.checks ||
      !offer.checkIds.includes(request.checkId) ||
      offer.toolchainDigest !== request.toolchainDigest
    )
      throw new DevicePairingError('grant')
  } else {
    const route = request.route
    const entry = offer.entries.find((item) => item.entryId === route.entryId)
    if (
      entry?.readiness !== 'ready' ||
      !offer.lanes ||
      route.deviceId !== offer.deviceId ||
      route.poolId !== offer.poolId ||
      entry.roleId !== request.roleId ||
      entry.model.providerId !== route.model.providerId ||
      entry.model.modelId !== route.model.modelId
    )
      throw new DevicePairingError('grant')
    caps = intersectCaps(caps, entry.caps)
  }
  const admitted = intersectCaps(caps, request.caps)
  if (JSON.stringify(admitted) !== JSON.stringify(request.caps))
    throw new DevicePairingError('capacity')
  return admitted
}
function intersectCaps(a: DeviceCaps, b: DeviceCaps): DeviceCaps {
  return {
    workers: Math.min(a.workers, b.workers),
    processes: Math.min(a.processes, b.processes),
    heavyChecks: Math.min(a.heavyChecks, b.heavyChecks),
    tokens: Math.min(a.tokens, b.tokens),
    spendUsd: compareUsdAmounts(a.spendUsd, b.spendUsd) <= 0 ? a.spendUsd : b.spendUsd,
    artifactBytes: Math.min(a.artifactBytes, b.artifactBytes),
  }
}
