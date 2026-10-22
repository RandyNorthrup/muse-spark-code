// Builds the JetBrains Marketplace logo (META-INF/pluginIcon.svg: 40 by 40 px,
// SVG) from the product's own mark, media/marketplace-icon.svg: the squiggled
// blue "m" on a dark tile. The drawing is not redrawn here. Its 128-unit art is
// placed in a 36 by 36 px area, which leaves a 2 px transparent margin.
// Usage, from the repository root:
//   node hosts/jetbrains/make-plugin-icon.mjs media/marketplace-icon.svg \
//     hosts/jetbrains/src/main/resources/META-INF/pluginIcon.svg
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const SOURCE_UNITS = 128
const LOGO_PIXELS = 40
const MARGIN_PIXELS = 2

function part(text, pattern, name) {
  const match = pattern.exec(text)
  if (match === null) throw new Error(`the source mark has no ${name}`)
  return match[0]
}

/** The logo's SVG text for the given text of media/marketplace-icon.svg. */
export function pluginIconFrom(sourceText) {
  const text = sourceText.replaceAll('\r\n', '\n')
  const open = part(text, /<svg[^>]*>/u, '<svg> element')
  if (!open.includes(`viewBox="0 0 ${String(SOURCE_UNITS)} ${String(SOURCE_UNITS)}"`)) {
    throw new Error('the source mark is no longer drawn on 128 units')
  }
  const gradient = part(text, /<linearGradient[\s\S]*?<\/linearGradient>/u, 'gradient').replaceAll(
    />\s+</gu,
    '><',
  )
  const tile = part(text, /<rect[^>]*\/>/u, 'tile')
  const letter = part(text, /<path[^>]*\/>/u, 'letter')
  const scale = (LOGO_PIXELS - 2 * MARGIN_PIXELS) / SOURCE_UNITS
  const size = String(LOGO_PIXELS)
  const margin = String(MARGIN_PIXELS)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    '  <!-- The project\'s own handwritten "m" on a dark tile, generated from',
    '       media/marketplace-icon.svg by hosts/jetbrains/make-plugin-icon.mjs.',
    '       It is not the mark of any other company. -->',
    `  <defs>${gradient}</defs>`,
    `  <g transform="translate(${margin} ${margin}) scale(${String(scale)})">`,
    `    ${tile}`,
    `    ${letter}`,
    '  </g>',
    '</svg>',
    '',
  ].join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [source, target] = process.argv.slice(2)
  if (source === undefined || target === undefined) {
    throw new Error('usage: make-plugin-icon.mjs <media/marketplace-icon.svg> <pluginIcon.svg>')
  }
  const icon = pluginIconFrom(readFileSync(source, 'utf8'))
  writeFileSync(target, icon)
  process.stdout.write(`${target}: ${String(Buffer.byteLength(icon))} bytes\n`)
}
