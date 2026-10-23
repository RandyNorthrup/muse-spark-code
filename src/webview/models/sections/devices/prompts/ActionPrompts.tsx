// M100 phase 2 (lane U): the per-action step-up prompt. It names the device
// the wait belongs to and points at that device for the answer. There is
// deliberately no control here that answers a presence prompt: step-up is
// confirmed on the device itself, never through the orchestrator UI. (The
// approval wait in DeviceCard already names its device.)
import { UI_TEXT } from '../../../../../shared/constants'
import { fill } from '../../../../../shared/l10n/text'

export function ActionPrompts({ deviceLabel }: { readonly deviceLabel: string }) {
  return (
    <div className="device-prompts">
      <p role="status">{fill(UI_TEXT.devices.stepUpWaiting, { device: deviceLabel })}</p>
      <p>{UI_TEXT.devices.localApprovalHelp}</p>
    </div>
  )
}
