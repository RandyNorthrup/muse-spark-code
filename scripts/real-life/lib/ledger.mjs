// What the product's daily ledger still holds when a run ends.
//
// The product books every request's whole reservation in a ledger of the
// local day before it sends (its README: the agent data folder's
// `paid-daily`), and settles it from the usage the provider reports. A run
// that is turned away for its budget sends nothing, and on 0.18.2 its
// reservation is left there with no settlement, counted against the day.
// The run reads the plain files of that ledger in its own new home, once,
// at its end, to say how much is held that way; it changes nothing in them.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { microUsd } from './budget.mjs'
import { dataFolderOf } from './home.mjs'

const CLAIM_FILE = 'claim.json'

/** Every file of that name under a folder. */
function claimFiles(folder) {
  if (!existsSync(folder)) return []
  return readdirSync(folder).flatMap((name) => {
    const entry = path.join(folder, name)
    if (statSync(entry).isDirectory()) return claimFiles(entry)
    return name === CLAIM_FILE ? [entry] : []
  })
}

/**
The reservations the product's daily ledger holds with no settlement.
@param {string} home the run's own home
@returns {{ claims: number, micro: number, unread: string[] }} `unread` names amounts that could not be read
*/
export function heldUnsettled(home) {
  const held = { claims: 0, micro: 0, unread: [] }
  const files = claimFiles(path.join(dataFolderOf(home), 'paid-daily'))
  for (const file of files) {
    let claim
    try {
      claim = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      held.unread.push('a claim file that is no JSON')
      continue
    }
    if (claim === null || typeof claim !== 'object' || Array.isArray(claim)) {
      held.unread.push('a claim file that is no object')
      continue
    }
    if (claim.settledUsd !== undefined) continue
    const micro = microUsd(claim.reservedUsd)
    if (Number.isNaN(micro)) held.unread.push(`reservedUsd: ${String(claim.reservedUsd)}`)
    else {
      held.claims += 1
      held.micro += micro
    }
  }
  return held
}
