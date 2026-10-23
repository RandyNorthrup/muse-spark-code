// RLF-DEVICES: dist/maker.js entry. The maker executors and their
// simulators, built on the first maker execution through the loader in
// ./makerBundle. The caller hands in the live panel surface; the entry
// reads no display text, so it installs no table.
import { MakerService, type MakerServiceDeps } from './makerService'

/** The window's maker assembly over the caller's panel surface. */
export function createMakerService(deps: MakerServiceDeps): MakerService {
  return new MakerService(deps)
}
