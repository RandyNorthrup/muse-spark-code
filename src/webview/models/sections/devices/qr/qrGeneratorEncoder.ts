// M100 phase 2 (lane W): the approved QR encoder behind lane U's lazy
// `QrEncoder` interface. `qrcode-generator@2.0.4` (MIT, zero dependencies,
// own types) renders the canonical public invitation text — ASCII JSON by
// schema — so a scan decodes to the identical text invite. Automatic version
// selection with `M` error correction; text that does not fit, or any
// encoder failure, throws and the figure keeps its text-only fallback.
import qrcode from 'qrcode-generator'
import { isQrModuleMatrix, type QrEncoder, type QrModuleMatrix } from './encoder'

export const qrGeneratorEncoder: QrEncoder = (text: string): QrModuleMatrix => {
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make()
  const size = code.getModuleCount()
  const modules: boolean[][] = []
  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = []
    for (let column = 0; column < size; column += 1) line.push(code.isDark(row, column))
    modules.push(line)
  }
  const matrix: QrModuleMatrix = { size, modules }
  if (!isQrModuleMatrix(matrix)) throw new Error('qr-matrix-invalid')
  return matrix
}
