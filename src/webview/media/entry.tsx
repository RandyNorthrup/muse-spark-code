// W/M104 imports this entry only in the companion page. The controls and CSS
// load when rendered; no media implementation enters chat startup.
import { lazy } from 'react'
export const CompanionMedia = lazy(async () => await import('./CompanionMedia'))
