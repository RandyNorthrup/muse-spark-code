import { describe, expect, it } from 'vitest'
import {
  hardwareAction as classifyHardware,
  isHardwareStop as canonicalStop,
} from '../../src/core/maker/guard/hardwareCommands'
import { isDeviceAction, isPhysicalTool } from '../../src/core/maker/guard/actionClass'

const stops = {
  targets: [
    { address: '/dev/ttyUSB0', stop: 'M112\n' },
    { address: '/dev/ttyUSB0', stop: '!' },
    { address: '/dev/ttyUSB0', stop: String.raw`\x18` },
    { address: '/dev/ttyUSB0', stop: String.fromCodePoint(Number('0x18')) },
    { address: 'https://printer.local', stop: '/printer/emergency_stop' },
  ],
}
function hardwareAction(command: string, dialect: 'bash' | 'powershell' = 'bash') {
  return classifyHardware(command, dialect, stops)
}
function isHardwareStop(command: string) {
  return canonicalStop(command, 'bash', stops)
}

describe('hardware command table (M103-G)', () => {
  it.each([
    'pio run -t upload',
    'platformio run --target=uploadfs',
    'pio run -t erase',
    'pio test',
    'pio test -e esp32',
    'idf.py -p COM5 flash',
    'idf.py app-flash',
    'idf.py erase-flash',
    'idf.py dfu-flash',
    'esptool write-flash 0 firmware.bin',
    'esptool.py write_flash 0 firmware.bin',
    'python -m esptool erase_flash',
    'esptool erase-flash',
    'esptool erase-region 0 100',
    'esptool erase_region 0 100',
    'arduino-cli upload',
    'arduino-cli burn-bootloader',
    'avrdude -U flash:w:app.hex',
    'avrdude -Ueeprom:w:data.hex',
    'picotool load app.uf2',
    'picotool reboot',
    'mpremote cp main.py :main.py',
    'mpremote fs cp main.py :main.py',
    'mpremote rm :main.py',
    'mpremote run main.py',
    'mpremote exec reset()',
    'mpremote mount .',
    'mpremote reset',
    'ampy put main.py',
    'ampy rm main.py',
    'ampy run main.py',
    'dfu-util -D app.bin',
    'st-flash write app.bin 0',
    'openocd -c "program app.elf"',
    'nrfjprog --program app.hex',
    'nrfjprog --recover',
    'esphome run board.yaml',
    'esphome upload board.yaml',
    'python espota.py -i board.local -f app.bin',
    'west flash',
    'cp code.py /media/CIRCUITPY/code.py',
    'Copy-Item app.uf2 C:/RPI-RP2/app.uf2',
    'curl -X PUT https://board.local/fs/code.py',
    'curl -X DELETE https://board.local/fs/code.py',
    'curl -X MOVE https://board.local/fs/code.py',
  ])('classifies program: %s', (command) => {
    expect(hardwareAction(command)).toBe(
      command === 'mpremote exec reset()' || command.startsWith('python ') ? 'actuate' : 'program',
    )
  })

  it.each([
    'pio device monitor',
    'pio run -t monitor',
    'idf.py monitor',
    'arduino-cli monitor',
    'mpremote',
    'mpremote repl',
    'mpremote connect COM5',
    'screen /dev/ttyUSB0 1200',
    'minicom -D /dev/ttyUSB0',
    'picocom /dev/cu.usbmodem1',
    'cu -l /dev/ttyUSB0',
    'stty -F /dev/ttyUSB0 1200',
    'stty -f /dev/cu.usbmodem1 1200',
    'cat /dev/serial/by-id/board',
    'python -m serial.tools.miniterm COM5',
    'esptool chip-id',
    'esptool chip_id',
    'esptool read-mac',
    'esptool read_mac',
    'esptool flash-id',
    'esptool flash_id',
    'picotool info',
  ])('classifies connect: %s', (command) => {
    expect(hardwareAction(command)).toBe(command.startsWith('python ') ? 'actuate' : 'connect')
  })

  it.each([
    "echo 'G28' > /dev/ttyUSB0",
    "echo 'G1 X1' > /dev/cu.usbmodem1",
    "echo 'G28' > COM5",
    'Set-Content -Path COM5 -Value G28',
    '$p = New-Object System.IO.Ports.SerialPort; $p.Write("G28")',
    'gpioset gpiochip0 17=1',
    'pinctrl set 17 op dh',
    'pinctrl op 17',
    'raspi-gpio set 17 op dh',
    'ros2 topic pub /cmd_vel geometry_msgs/Twist {}',
    'ros2 action send_goal /move pkg/Move {}',
    'ros2 service call /move pkg/Move {}',
    'curl -X POST https://printer.local/printer/gcode/script?script=G28',
    'curl --unix-socket moonraker.sock -X POST https://localhost/printer/print/pause',
    'wget --post-data=script=G28 https://printer.local/printer/gcode/script',
    'Invoke-WebRequest -Method POST https://printer.local/api/printer/tool',
    'Invoke-RestMethod -Method POST https://printer.local/api/job',
    'http POST https://printer.local/api/connection',
    'curl -F print=true https://printer.local/server/files/upload',
    'curl -F print=true https://printer.local/api/files/local',
    'curl -X PUT https://printer.local/api/v1/job/1/pause',
    'curl -X DELETE https://printer.local/api/v1/job/1',
    'curl -X PUT -H Print-After-Upload:true https://printer.local/api/v1/files/a.gcode',
    'curl https://cnc.local/command?command=G28',
  ])('classifies actuation: %s', (command) => {
    expect(hardwareAction(command)).toBe('actuate')
  })

  it.each([
    ...[
      'burn-efuse',
      'burn_efuse',
      'burn-key',
      'burn_key',
      'burn-key-digest',
      'burn-block-data',
      'burn-bit',
      'write-protect-efuse',
      'read-protect-efuse',
      'set-flash-voltage',
    ].map((action) => `espefuse.py ${action} KEY0 1`),
    ...['lfuse', 'hfuse', 'efuse', 'lock'].map((fuse) => `avrdude -U ${fuse}:w:0xff:m`),
    'STM32_Programmer_CLI -ob RDP=0xCC',
    'picotool otp set 0 1',
    'picotool otp load data.bin',
    'curl -X POST https://printer.local/printer/restart',
    'curl -X POST https://printer.local/printer/firmware_restart',
    'curl -X POST https://printer.local/machine/shutdown',
    'curl -X POST https://printer.local/machine/reboot',
    'curl -X POST https://printer.local/machine/services/restart',
    'curl -F root=config https://printer.local/server/files/upload',
    ...[
      'M997',
      'M502',
      'M500',
      'SAVE_CONFIG',
      'M80',
      'M81',
      'M42',
      'M303',
      '$X',
      '$RST',
      '$N0=G28',
      '$20=0',
    ].map((code) => `echo '${code}' > /dev/ttyUSB0`),
  ])('refuses irreversible or machine-side operation: %s', (command) => {
    expect(hardwareAction(command)).toBe('refused')
  })

  it.each([
    'pio run',
    'pio test -e native',
    'pio test --without-uploading',
    'idf.py build',
    'idf.py menuconfig',
    'idf.py qemu monitor',
    'arduino-cli compile',
    'esptool merge-bin app.bin',
    'esptool image-info app.bin',
    'espsecure sign-data app.bin',
    'mpremote connect list',
    'pio device list',
    'arduino-cli board list',
    'python -m serial.tools.list_ports',
    'ls /dev/serial/by-id',
    'curl https://printer.local/printer/objects/query',
    'curl https://printer.local/printer/info',
    'curl https://printer.local/api/printer',
    'curl https://printer.local/api/v1/status',
    'ros2 topic echo /cmd_vel',
    'ros2 bag info log',
    'gpioinfo',
    'gpiodetect',
    'vcgencmd',
    'espefuse summary',
    'espefuse dump',
    'picotool otp list',
    'picotool otp get 0',
    "echo 'M112' > /dev/ttyUSB0",
    "printf '!' > /dev/ttyUSB0",
    String.raw`printf '\x18' > /dev/ttyUSB0`,
    'curl -X POST https://printer.local/printer/emergency_stop',
  ])('leaves ordinary/observe/stop policy intact: %s', (command) => {
    expect(isDeviceAction(hardwareAction(command))).toBe(false)
  })

  it('scans every chain member, wrappers and both shell dialects', () => {
    expect(hardwareAction('git status && pio run -t upload')).toBe('program')
    expect(hardwareAction('esptool chip-id; espefuse burn-key KEY0 key.bin')).toBe('refused')
    expect(hardwareAction('bash -c "esptool write_flash 0 app.bin"')).toBe('actuate')
    expect(hardwareAction('python -m esptool write-flash 0 app.bin', 'powershell')).toBe('actuate')
    expect(hardwareAction("echo 'M112 G28' > /dev/ttyUSB0")).toBe('actuate')
    expect(hardwareAction('esptool future-device-command')).toBe('actuate')
    expect(
      hardwareAction(
        '$p = New-Object System.IO.Ports.SerialPort; $p.Write("G28"); espefuse burn-key KEY0 key.bin',
      ),
    ).toBe('refused')
    expect(
      hardwareAction(
        "node -e \"require('socket.io-client')('cncjs.local').emit('command','G28')\"",
      ),
    ).toBe('actuate')
  })

  it('recognises physical namespaces without trusting tool descriptions or flags', () => {
    expect(isPhysicalTool('mcp__moonraker__send_gcode')).toBe(true)
    expect(isPhysicalTool('mcp__esp_idf__flash')).toBe(true)
    expect(isPhysicalTool('mcp__octoprint__read_status')).toBe(true)
    expect(isPhysicalTool('mcp__files__read')).toBe(false)
    expect(isPhysicalTool('mcp__mcp-3d-printer-server__print')).toBe(true)
    expect(isPhysicalTool('mcp__robotmcp__move')).toBe(true)
    expect(isPhysicalTool('mcp__armguard__move')).toBe(true)
    expect(isDeviceAction('offline')).toBe(false)
    expect(isDeviceAction('actuate')).toBe(true)
  })
  it('guards plain HTTP LAN sends and raw GRBL stop bytes', () => {
    // The scheme is an intentional protocol fixture; requests are never sent.
    const scheme = 'http:'
    expect(
      hardwareAction(`curl -X POST ${scheme}//192.168.1.10/printer/gcode/script?script=G28`),
    ).toBe('actuate')
    const softReset = String.fromCodePoint(Number('0x18'))
    expect(hardwareAction(`printf '${softReset}' > /dev/ttyUSB0`)).toBe('observe')
    expect(isHardwareStop(`printf '${softReset}' > /dev/ttyUSB0`)).toBe(true)
    expect(hardwareAction("echo 'M500S1' > /dev/ttyUSB0")).toBe('refused')
    expect(
      hardwareAction('curl -X POST https://printer.local/printer/gcode/script?script=%4d500S1'),
    ).toBe('refused')
    const encodedJog = String.fromCodePoint(Number('0x85'))
    expect(isHardwareStop(`printf '${encodedJog}' > /dev/ttyUSB0`)).toBe(false)
  })
  it('exempts only a whole fixed stop from approval', () => {
    expect(isHardwareStop("echo 'M112' > /dev/ttyUSB0")).toBe(true)
    expect(isHardwareStop(String.raw`printf '\x18' > /dev/ttyUSB0`)).toBe(true)
    expect(isHardwareStop('curl -X POST https://printer.local/printer/emergency_stop')).toBe(true)
    expect(isHardwareStop("echo 'M112 G28' > /dev/ttyUSB0")).toBe(false)
    expect(isHardwareStop("echo 'M112' > /dev/ttyUSB0; gpioset gpiochip0 1=1")).toBe(false)
    expect(
      isHardwareStop(
        'curl -X POST https://printer.local/printer/emergency_stop --next https://cnc.local/command',
      ),
    ).toBe(false)
  })
})
