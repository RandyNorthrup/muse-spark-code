import './helpers/tokenFileMocks'
import { createTokenFile } from '../../src/runtime/tokenFile'
import { tokenFileSuite } from './helpers/tokenFileSuite'

tokenFileSuite(createTokenFile, 'ETOKEN_ACL', /^muse-token-/)
