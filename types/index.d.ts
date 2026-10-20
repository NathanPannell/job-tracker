export type JobTrackerReady = boolean

declare module 'claude-code' {
  interface PluginState {
    'job-tracker': { ready: JobTrackerReady }
  }
}
