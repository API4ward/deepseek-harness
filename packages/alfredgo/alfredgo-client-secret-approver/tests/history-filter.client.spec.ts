/** Search and filters of the approval history page. */
import { expect, it } from 'vitest'
import { TextSearchIndex } from '@deepseek-ai/dsh-util-text-search'
import { filterHistory, historyKeys } from '../src/client/HistorySection.tsx'
import type { HistoryRecord } from '../src/client/store.ts'

const base: HistoryRecord = {
  key: '', at: 0, requestId: '', kind: 'reveal', project: 'alfredgo', task: 't', injector: 'i', secrets: ['test_passwd'], tool: 'read',
  target: '/srv/.env', operation: 'read .env', decision: 'approve', way: 'user', reason: '', returned: {}, grant: null, requestText: '{}',
}
const records: HistoryRecord[] = [
  { ...base, key: '3', requestId: 'r3', secrets: ['mail_password'], tool: 'shell', target: 'cat ~/.config/mail.toml', decision: 'deny' },
  { ...base, key: '2', requestId: 'r2', way: 'rule' },
  { ...base, key: '1', requestId: 'r1', project: 'payments', way: 'auto-deny', decision: 'deny', reason: 'secret_unavailable' },
]
const index = new TextSearchIndex(records, historyKeys)
const ids = (query: string, decision = '', way = ''): string[] => filterHistory(index, query, decision, way).map(r => r.requestId)

it('keeps time order without a query and applies exact result and way filters', () => {
  expect(ids('')).toEqual(['r3', 'r2', 'r1'])
  expect(ids('', 'deny')).toEqual(['r3', 'r1'])
  expect(ids('', '', 'rule')).toEqual(['r2'])
  expect(ids('', 'deny', 'auto-deny')).toEqual(['r1'])
})

it('matches aliases, project, and tool fuzzily and target or operation as substrings', () => {
  expect(ids('mail')).toEqual(['r3'])
  expect(ids('tpw')).toEqual(['r2', 'r1'])
  expect(ids('payments')).toEqual(['r1'])
  expect(ids('mail.toml')).toEqual(['r3'])
  expect(ids('cmt')).toEqual([])
  expect(ids('test_passwd', 'approve')).toEqual(['r2'])
})
