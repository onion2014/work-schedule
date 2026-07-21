import type { TimerApi } from '../../lib/types'

declare global {
  interface Window {
    timerApi: TimerApi
  }
}
