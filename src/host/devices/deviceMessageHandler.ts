// Loaded by the explicit Devices host action. Each editor injects its locally
// authoritative pairing/receiver adapter; this handler supplies no permissions.
import {
  parseDeviceHostMessage,
  parseDeviceWebviewRequest,
  type DeviceHostMessage,
  type DevicesPanelPort,
} from '../../shared/devicesPanel'

export async function handleDeviceRequest(
  input: unknown,
  port: DevicesPanelPort,
  signal?: AbortSignal,
): Promise<DeviceHostMessage> {
  const request = parseDeviceWebviewRequest(input)
  if (!request.ok) throw new Error('invalid-device-message')
  let raw: unknown
  try {
    raw =
      signal === undefined
        ? await port.request(request.message)
        : await port.request(request.message, signal)
  } catch {
    throw new Error('invalid-device-message')
  }
  const response = parseDeviceHostMessage(raw)
  if (
    !response.ok ||
    (response.message.setup !== undefined &&
      (response.message.setup.requestId !== request.message.requestId ||
        response.message.setup.viewId !== request.message.viewId))
  ) {
    throw new Error('invalid-device-message')
  }
  return {
    ...response.message,
    setup: {
      ...response.message.setup,
      viewId: request.message.viewId,
      requestId: request.message.requestId,
    },
  }
}
