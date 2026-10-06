import { MAKER_PROTOCOL_VERSION, UI_TEXT } from '../../shared/constants'
import type { MakerMachineSummary, MakerSurfaceMessage } from '../../shared/makerProtocol'

export function StopChip({
  machines,
  send,
}: {
  readonly machines: readonly MakerMachineSummary[]
  readonly send: (message: MakerSurfaceMessage) => boolean
}) {
  return (
    <div className="maker-stop maker-stop-slot" role="group" aria-label={UI_TEXT.makerStopMachine}>
      <button
        type="button"
        onClick={() => {
          send({ v: MAKER_PROTOCOL_VERSION, type: 'makerStop' })
        }}
      >
        {UI_TEXT.makerStopAll}
      </button>
      <div className="maker-stop-list">
        {machines.map((machine) => (
          <button
            type="button"
            key={machine.registrationId}
            onClick={() => {
              send({
                v: MAKER_PROTOCOL_VERSION,
                type: 'makerStop',
                machineId: machine.id,
              })
            }}
          >
            {`${UI_TEXT.makerStopMachine}: ${machine.name}`}
          </button>
        ))}
      </div>
    </div>
  )
}
