// M100 phase 2 (lane U): the narrow QR encoder interface. Text in, module
// matrix out; the encoder is injected, never imported. The approved encoder
// (proposed to the lead, not installed) lives in the lazy qr/ chunk behind
// this interface; tests inject a fixed matrix.
export interface QrModuleMatrix {
  readonly size: number
  readonly modules: readonly (readonly boolean[])[]
}

export type QrEncoder = (text: string) => QrModuleMatrix

// A version-1 QR code is 21 modules square and every version adds four;
// version 40 is 177 square. Anything else is not a QR matrix.
const QR_MIN_MODULES = 21
const QR_MAX_MODULES = 177
const QR_VERSION_STEP = 4
export function isQrModuleMatrix(value: QrModuleMatrix): boolean {
  return (
    Number.isSafeInteger(value.size) &&
    value.size >= QR_MIN_MODULES &&
    value.size <= QR_MAX_MODULES &&
    (value.size - QR_MIN_MODULES) % QR_VERSION_STEP === 0 &&
    value.modules.length === value.size &&
    value.modules.every(
      (row) => row.length === value.size && row.every((module) => typeof module === 'boolean'),
    )
  )
}
