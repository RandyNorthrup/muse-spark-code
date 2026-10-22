// M100 phase 2 (lane U): owners bound to a device with their revocable
// per-action grants. Up to 4 owners, each with up to 16 grants (enforced by
// the panel schema before display). Each grant shows role, mode, repository,
// lanes/checks, quota and expiry, with a revoke action. Typed refusals map
// to their states; revoking never answers a presence prompt.
import { UI_TEXT } from '../../../../../shared/constants'
import { formatBytes, formatDateTime, formatNumber } from '../../../../../shared/l10n/text'
import { formatUsd } from '../../../../../shared/l10n/exactUsd'
import type {
  DEVICE_GRANT_REFUSALS,
  DeviceGrant,
  DeviceGrantRefusal,
} from '../../../../../shared/devices'
import type { DeviceOwnerGrants } from '../../../../../shared/devicesPanel'

export function grantRefusalText(reason: (typeof DEVICE_GRANT_REFUSALS)[number]): string {
  switch (reason) {
    case 'grant-expired': {
      return UI_TEXT.devices.grantExpired
    }
    case 'owner-mismatch': {
      return UI_TEXT.devices.ownerMismatch
    }
    case 'grant-revoked': {
      return UI_TEXT.devices.revokedHelp
    }
    default: {
      return UI_TEXT.devices.grantHelp
    }
  }
}

export function OwnerGrants({
  owners,
  busy,
  refusal,
  onRevoke,
}: {
  readonly owners: readonly DeviceOwnerGrants[] | undefined
  readonly busy: boolean
  readonly refusal: DeviceGrantRefusal | undefined
  readonly onRevoke: (ownerId: string, grantId: string) => void
}) {
  return (
    <section className="device-owners" aria-label={UI_TEXT.devices.owners}>
      <h3>{UI_TEXT.devices.owners}</h3>
      {refusal !== undefined && <p role="alert">{grantRefusalText(refusal.reason)}</p>}
      {owners !== undefined &&
        (owners.length === 0 ? (
          <p>{UI_TEXT.devices.noOffers}</p>
        ) : (
          <ul>
            {owners.map((owner) => (
              <li key={owner.ownerId}>
                <code>{owner.ownerId}</code>
                <ul>
                  {owner.grants.map((grant) => (
                    <GrantRow
                      key={grant.grantId}
                      grant={grant}
                      busy={busy}
                      onRevoke={() => {
                        onRevoke(owner.ownerId, grant.grantId)
                      }}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ))}
    </section>
  )
}

function offerScopeText(hasLanes: boolean, hasChecks: boolean): string {
  if (hasLanes && hasChecks) return `${UI_TEXT.devices.offer} + ${UI_TEXT.devices.offerChecks}`
  return hasLanes ? UI_TEXT.devices.offer : UI_TEXT.devices.offerChecks
}

function GrantRow({
  grant,
  busy,
  onRevoke,
}: {
  readonly grant: DeviceGrant
  readonly busy: boolean
  readonly onRevoke: () => void
}) {
  return (
    <li>
      <p>
        <code>{grant.roleId}</code> · {UI_TEXT.permissionModes[grant.mode]} ·{' '}
        {offerScopeText(grant.lanes, grant.checks)}
      </p>
      <dl className="device-facts">
        <div>
          <dt>{UI_TEXT.devices.grantRepository}</dt>
          <dd>
            <code>{grant.repositoryId}</code>
          </dd>
        </div>
        <div>
          <dt>{UI_TEXT.devices.grantQuota}</dt>
          <dd>
            <dl className="device-facts">
              {[
                [UI_TEXT.devices.workers, formatNumber(grant.quota.workers)],
                [UI_TEXT.devices.processes, formatNumber(grant.quota.processes)],
                [UI_TEXT.devices.heavyChecks, formatNumber(grant.quota.heavyChecks)],
                [UI_TEXT.devices.tokens, formatNumber(grant.quota.tokens)],
                [UI_TEXT.devices.spend, formatUsd(grant.quota.spendUsd, 2)],
                [UI_TEXT.devices.artifact, formatBytes(grant.quota.artifactBytes)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </dd>
        </div>
        <div>
          <dt>{UI_TEXT.devices.grantExpiry}</dt>
          <dd>{formatDateTime(grant.expiresAt)}</dd>
        </div>
      </dl>
      <div>
        <button type="button" disabled={busy} onClick={onRevoke}>
          {UI_TEXT.devices.revokeGrant}
        </button>
      </div>
    </li>
  )
}
