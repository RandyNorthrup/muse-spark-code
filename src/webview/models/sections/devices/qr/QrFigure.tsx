// M100 phase 2 (lane U): the lazy QR figure. Default export so the panel
// loads this chunk only when a QR is shown. Dark modules on a fixed light
// field with a four-module quiet zone in every theme, hc-dark included, plus
// an accessible name. The selectable text fallback beside it is complete on
// its own and is what ships until the lead approves an encoder: with no
// injected encoder, or an encoder that throws or returns a non-matrix, this
// renders nothing.
import { DEVICE_LIMITS, UI_TEXT } from '../../../../../shared/constants'
import { isQrModuleMatrix, type QrEncoder } from './encoder'

const FIELD = '#ffffff'
const MODULE = '#000000'
const MODULE_PX = 4

export default function QrFigure({
  text,
  encode,
}: {
  readonly text: string
  readonly encode: QrEncoder | undefined
}) {
  if (encode === undefined) return null
  let matrix
  try {
    matrix = encode(text)
  } catch {
    return null
  }
  if (!isQrModuleMatrix(matrix)) return null
  const quiet = DEVICE_LIMITS.qrQuietZoneModules
  const cells = matrix.size + quiet * 2
  const rects = []
  for (const [row, line] of matrix.modules.entries()) {
    for (const [column, dark] of line.entries()) {
      if (dark)
        rects.push(
          <rect
            key={`${String(row)}-${String(column)}`}
            x={column + quiet}
            y={row + quiet}
            width={1}
            height={1}
          />,
        )
    }
  }
  const extent = String(cells)
  return (
    <svg
      role="img"
      aria-label={UI_TEXT.devices.qrCodeName}
      viewBox={`0 0 ${extent} ${extent}`}
      fill={MODULE}
      width={cells * MODULE_PX}
      height={cells * MODULE_PX}
    >
      <rect x={0} y={0} width={cells} height={cells} fill={FIELD} />
      {rects}
    </svg>
  )
}
