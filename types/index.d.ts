export type ClawdGifNumber = number

declare module 'claude-code' {
  interface PluginState {
    'clawd-pet': { gif: ClawdGifNumber; isHidden: boolean; isPlain: boolean }
  }
}
