export type Worker = {
  id: string
  label: string
  status: 'working' | 'done' | 'idle'
  /** When the status was set (ms): another chat's write, or this chat's own "!" */
  at?: number
}

declare module 'claude-code' {
  interface PluginState {
    'laptop-crew': {
      local: Worker[]
      chats: Worker[]
      /** The transcript row (`$.ui.place` id) that shows the latest "!", while it lasts. */
      doneRow: string | null
      /** A preview row from the /crew panel: its id and what it shows, while it lasts. */
      demoRow: { id: string; kind: 'working' | 'done' } | null
    }
  }
}
