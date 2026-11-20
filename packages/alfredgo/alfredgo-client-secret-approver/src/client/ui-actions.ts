/** Actions and state the approver UI receives through slot injection. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ApproverState, GrantChoice, ValueChoice } from './approver.ts'
import type { ApproverKey } from './locales.ts'
import type { AutoRule } from './store.ts'

/** Failure text the UI shows: a dictionary key and its parameters. */
export interface UiFailure {
  readonly key: ApproverKey
  readonly detail: string
}

/** Everything bound into the settings section and the approval overlay. */
export interface ApproverInjected {
  hooks: { approverState: ObservableSnapshot<ApproverState>; approverFailure: ObservableSnapshot<UiFailure | null> }
  /** Relay origin for the setup commands. */
  relayUrl: () => string
  createDevice: (user: string) => Promise<void>
  connect: () => Promise<void>
  pairInjector: (text: string) => Promise<void>
  addSecret: (alias: string, value: string, repos: readonly string[]) => Promise<void>
  addCopy: (alias: string, label: string, value: string) => Promise<void>
  removeSecret: (alias: string) => Promise<void>
  setAllMode: (minutes: number) => Promise<void>
  addAutoRule: (rule: AutoRule) => Promise<void>
  removeAutoRule: (index: number) => Promise<void>
  decide: (requestId: string, decision: 'approve' | 'deny', choices: Readonly<Record<string, ValueChoice>>, grant: GrantChoice | null) => Promise<void>
  /** Remove every approval history record from this browser. */
  clearHistory: () => Promise<void>
  clearFailure: () => void
}
