export type Worker = {
  id: string
  label: string
  status: 'working' | 'done' | 'idle'
  /** When the status was set (ms): another chat's write, or this chat's own "!" */
  at?: number
}

declare module 'claude-code' {
  interface PluginState {
    'laptop-crew': { local: Worker[]; chats: Worker[] }
  }
}
