// Review screenshots per mode and language (M111 lane QA): captures for a
// person to look at, uploaded as CI artifacts and refreshed on demand.
// They are never compared by a test. The plan is scenes × themes ×
// languages; review-shots.json names the default subset, and the nightly
// desktop workflow expands the languages to all fifteen tables.

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { DESKTOP_SCENES, DESKTOP_THEMES, SCENE_READY, desktopScene } from './scenes.mjs'
import { desktopLanguages } from './strings.mjs'
import { desktopSceneUrl } from './sceneServer.mjs'

const LANG_ID = /^[a-z]{2,3}(?:-[a-z\d]+)*$/
export const REVIEW_SHOT_FILE = 'test/desktop/harness/review-shots.json'

function fail(what, reason) {
  throw new Error(`${REVIEW_SHOT_FILE}: ${what} ${reason}`)
}

function stringList(list, name, known) {
  if (!Array.isArray(list) || list.length === 0) fail(name, 'needs a non-empty array')
  for (const entry of list) {
    if (typeof entry !== 'string' || (known !== undefined && !known.includes(entry))) {
      fail(name, `names an unknown entry: ${String(entry)}`)
    }
  }
  return list
}

/** Parses and validates review-shots.json: `{ scenes, themes, languages }`. */
export function parseReviewShots(text) {
  let list
  try {
    list = JSON.parse(text)
  } catch (error) {
    throw new Error(`${REVIEW_SHOT_FILE}: not valid JSON`, { cause: error })
  }
  if (typeof list !== 'object' || list === null) fail('list', 'is not an object')
  const scenes = stringList(
    list.scenes,
    'scenes',
    DESKTOP_SCENES.map((scene) => scene.id),
  )
  const themes = stringList(list.themes, 'themes', DESKTOP_THEMES)
  const languages = stringList(list.languages, 'languages')
  for (const lang of languages) {
    if (lang !== '*' && !LANG_ID.test(lang)) fail('languages', `needs a language id: ${lang}`)
  }
  return { scenes, themes, languages }
}

/** Every capture a plan makes, expanding `*` languages to every table. */
export async function expandReviewPlan(repoRoot, plan) {
  const languages = plan.languages.includes('*') ? await desktopLanguages(repoRoot) : plan.languages
  const captures = []
  for (const id of plan.scenes) {
    const scene = desktopScene(id)
    for (const theme of plan.themes) {
      for (const lang of languages) {
        captures.push({
          scene: scene.id,
          theme,
          lang,
          width: scene.width,
          height: scene.height,
          file: `${scene.id}.${theme}.${lang}.png`,
        })
      }
    }
  }
  return captures
}

/** Captures every shot of a plan into `outDir`; returns the files written. */
export async function captureReviewShots(repoRoot, chrome, port, plan, outDir) {
  const captures = await expandReviewPlan(repoRoot, plan)
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
  })
  try {
    const written = []
    for (const capture of captures) {
      const page = await browser.newPage({
        viewport: { width: capture.width, height: capture.height },
      })
      try {
        await page.goto(desktopSceneUrl(port, capture))
        await page.locator(SCENE_READY).waitFor()
        await page.evaluate(() => globalThis.document.fonts.ready)
        const file = path.join(outDir, capture.file)
        await page.screenshot({ path: file, animations: 'disabled' })
        written.push(file)
      } finally {
        await page.close()
      }
    }
    return written
  } finally {
    await browser.close()
  }
}
