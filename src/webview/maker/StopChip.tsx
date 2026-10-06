import { MAKER_PROTOCOL_VERSION, UI_TEXT } from '../../shared/constants'
import type { MakerMachineSummary, MakerSurfaceMessage } from '../../shared/makerProtocol'

export function StopChip({
  machines,
  send,
}: {
  readonly machines: readonly MakerMachineSummary[]
  readonly send: (message: MakerSurfaceMessage) => boolean
}) {
  if (machines.length === 0) return null
  return (
    <div className="maker-stop" role="group" aria-label={UI_TEXT.makerStopMachine}>
      <button
        className="button-secondary"
        type="button"
        onClick={() => {
          send({ v: MAKER_PROTOCOL_VERSION, type: 'makerStop' })
        }}
      >
        {UI_TEXT.makerStopAll}
      </button>
      {machines.map((machine) => (
        <button
          className="button-secondary"
          type="button"
          key={machine.registrationId}
          onClick={() => {
            send({ v: MAKER_PROTOCOL_VERSION, type: 'makerStop', machineId: machine.id })
          }}
        >
          {UI_TEXT.makerStopMachine}: {machine.name}
        </button>
      ))}
    </div>
  )
}
