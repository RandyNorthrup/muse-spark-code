// The migration fault, alone: ambient discovery (in the vault's opening
// bundle) names only this class, so it must not pull the migration-only
// record schema in ports.ts with it (RVAPP-CM1091D5 BYTES). Every other
// importer keeps importing it from './ports', which re-exports this module.
import { UI_TEXT } from '../../../shared/constants'

/** Never forward a store/codec exception that could contain credential bytes. */
export class VaultMigrationFault extends Error {
  constructor(
    readonly code:
      | 'invalid'
      | 'conflict'
      | 'verification'
      | 'window'
      | 'storage'
      | 'orphaned'
      /** The source cannot be read (permissions): the receipt stays (RVCM1091G P2). */
      | 'unreadable'
      /** The source's location is not available (drive down): the receipt stays. */
      | 'unavailable',
  ) {
    super(UI_TEXT.vault.noAccess)
    this.name = 'VaultMigrationFault'
  }
}
