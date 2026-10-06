import { type Ref, useId } from 'react'
import { DEVICE_LIMITS } from '../../../../shared/constants'

// Both screens use the same complete grouped value, visually and in speech.
export function DeviceFingerprint({
  fingerprint,
  label,
  headingRef,
}: {
  readonly fingerprint: string
  readonly label: string
  readonly headingRef?: Ref<HTMLHeadingElement>
}) {
  const valueId = useId()
  const groups: string[] = []
  for (let offset = 0; offset < fingerprint.length; offset += DEVICE_LIMITS.fingerprintGroupChars)
    groups.push(fingerprint.slice(offset, offset + DEVICE_LIMITS.fingerprintGroupChars))
  return (
    <div>
      <h3 ref={headingRef} tabIndex={-1} aria-describedby={valueId}>
        {label}
      </h3>
      <span id={valueId} hidden>
        {groups.join(' ')}
      </span>
      <code className="device-fingerprint" role="group" aria-label={groups.join(' ')}>
        {groups.map((group, index) => (
          <span key={index}>
            {index === 0 ? '' : ' '}
            <span>{group}</span>
          </span>
        ))}
      </code>
    </div>
  )
}
