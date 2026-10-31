import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const [tools, image, uart] = process.argv.slice(2)
if (tools === undefined || image === undefined || uart === undefined) {
  throw new Error('pico needs tools, UF2 image and UART PTY')
}
const require = createRequire(import.meta.url)
const { Simulator } = require(path.join(tools, 'node_modules/rp2040js/dist/cjs/simulator.js'))
const { USBCDC } = require(path.join(tools, 'node_modules/rp2040js/dist/cjs/usb/cdc.js'))
const { ConsoleLogger, LogLevel } = require(
  path.join(tools, 'node_modules/rp2040js/dist/cjs/utils/logging.js'),
)
const simulator = new Simulator()
const mcu = simulator.rp2040
mcu.logger = new ConsoleLogger(LogLevel.Error)
const rom = fs.readFileSync(path.join(tools, 'bootrom.bin'))
mcu.loadBootrom(new Uint32Array(rom.buffer, rom.byteOffset, rom.length / 4))
const uf2 = fs.readFileSync(image)
const blockSize = 512
if (uf2.length === 0 || uf2.length % blockSize !== 0) throw new Error('invalid UF2 size')
const flashAddress = 0x10_00_00_00
for (let offset = 0; offset < uf2.length; offset += blockSize) {
  const block = uf2.subarray(offset, offset + blockSize)
  const address = block.readUInt32LE(12) - flashAddress
  const size = block.readUInt32LE(16)
  if (
    block.readUInt32LE(0) !== 0x0a_32_46_55 ||
    block.readUInt32LE(4) !== 0x9e_5d_51_57 ||
    block.readUInt32LE(508) !== 0x0a_b1_6f_30 ||
    size > 476 ||
    address < 0 ||
    address + size > mcu.flash.length
  )
    throw new Error('invalid UF2 block')
  mcu.flash.set(block.subarray(32, 32 + size), address)
}
const fd = fs.openSync(uart, 'r+')
const input = fs.createReadStream(uart, { fd, autoClose: false })
const output = fs.createWriteStream(uart, { fd, autoClose: false })
const cdc = new USBCDC(mcu.usbCtrl)
cdc.onDeviceConnected = () => {
  cdc.sendSerialByte(13)
  cdc.sendSerialByte(10)
}
cdc.onSerialData = (bytes) => output.write(bytes)
input.on('data', (bytes) => {
  for (const byte of bytes) cdc.sendSerialByte(byte)
})
input.on('error', (error) => {
  throw error
})
output.on('error', (error) => {
  throw error
})
mcu.core.PC = flashAddress
simulator.execute()
