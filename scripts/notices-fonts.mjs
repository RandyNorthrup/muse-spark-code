// Optional font-pack notices and package guard (M114 F). No downloads here.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import * as esbuild from 'esbuild'

const fontModules = {}
async function fontModule() {
  fontModules.promise ??= (async () => {
    const { outputFiles } = await esbuild.build({
      stdin: {
        contents:
          "export { fontPackSchema } from './manifest'; export { verifyFontAsset } from './install'",
        resolveDir: path.resolve('src/runtime/fonts'),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      logLevel: 'silent',
    })
    return await import(
      `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
    )
  })()
  return await fontModules.promise
}

export function assertNoVsixFonts(files) {
  const font = files
    .map((file) => file.replaceAll('\\', '/'))
    .find(
      (file) =>
        /\.(?:woff2?|ttf|otf|eot)$/i.test(file) ||
        /(?:^|\/)design\/fonts\//.test(file) ||
        file.endsWith('/fontsInstall.js'),
    )
  if (font !== undefined) throw new Error(`Font pack or installer must not enter the VSIX: ${font}`)
}

/** Digests/lengths validate both the exact OFL texts and subset WOFF2s on every build. */
export async function fontNotices(root = '.') {
  const { fontPackSchema, verifyFontAsset } = await fontModule()
  const directory = path.join(root, 'design', 'fonts')
  const pack = fontPackSchema.parse(
    JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')),
  )
  return pack.fonts.map((font) => {
    const texts = []
    for (const asset of [font.font, font.notice]) {
      const bytes = readFileSync(path.join(directory, 'pack', asset.file))
      verifyFontAsset(asset, bytes)
      if (asset === font.notice) texts.push(bytes.toString('utf8'))
    }
    return {
      name: `${font.family} (optional subset font pack)`,
      licence: font.licence,
      url: font.source,
      text: texts.join('\n'),
    }
  })
}

/** Runtime acquisition/preferences stay in their own chunk, away from ACP startup. */
export function assertFontBundleSplit(acp, installer) {
  const files = [
    'install.ts',
    'manifest.ts',
    'nodeInstall.ts',
    'preferences.ts',
    'fontsEntry.ts',
  ].map((file) => `src/runtime/fonts/${file}`)
  const startup = Object.keys(acp.inputs).map((file) => file.replaceAll('\\', '/'))
  const lazy = Object.keys(installer.inputs).map((file) => file.replaceAll('\\', '/'))
  for (const file of files) {
    if (startup.some((input) => input.endsWith(file)))
      throw new Error(`Font implementation entered ACP startup: ${file}`)
    if (lazy.every((input) => !input.endsWith(file)))
      throw new Error(`Font installer lost its implementation: ${file}`)
  }
}
