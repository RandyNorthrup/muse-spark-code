// D83/D215 (RLF-DEVICES): the maker target and operation words every
// surface shares. The panel dialog and the ACP permission prompt read
// the same keys; machine identity itself stays spliced detail.
import { UI_TEXT } from './constants'
import { formatNumber } from './l10n/text'
import type { MakerAnalysis, MakerOperation, MakerTargetKind } from './maker'

export function makerKindText(kind: MakerTargetKind): string {
  switch (kind) {
    case 'printer': {
      return UI_TEXT.devices.makerKindPrinter
    }
    case 'cnc': {
      return UI_TEXT.devices.makerKindCnc
    }
    case 'mcu': {
      return UI_TEXT.devices.makerKindMcu
    }
  }
}

export function makerOperationText(operation: MakerOperation): string {
  switch (operation) {
    case 'connect': {
      return UI_TEXT.devices.makerOperationConnect
    }
    case 'program': {
      return UI_TEXT.devices.makerOperationProgram
    }
    case 'actuate': {
      return UI_TEXT.devices.makerOperationActuate
    }
  }
}

function makerAxisRange(min: number | undefined, max: number | undefined): string | undefined {
  const lo = min === undefined ? undefined : formatNumber(min)
  const hi = max === undefined ? undefined : formatNumber(max)
  return lo === undefined || hi === undefined ? (lo ?? hi) : `${lo}–${hi}`
}

const MAKER_AXES = ['x', 'y', 'z'] as const

/** One `X 0–10` part per axis the bounds touch, in machine millimetres. */
export function makerBoundsParts(bounds: NonNullable<MakerAnalysis['bounds']>): string[] {
  const parts: string[] = []
  for (const axis of MAKER_AXES) {
    const range = makerAxisRange(bounds.min[axis], bounds.max[axis])
    if (range !== undefined) parts.push(`${axis.toUpperCase()} ${range}`)
  }
  return parts
}
