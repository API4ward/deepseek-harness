/** Settings page that lists every answered request in this browser, with search, filters, export, and clearing. */
import { useMemo, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { TextSearchIndex, type SearchKeys } from '@deepseek-ai/dsh-util-text-search'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DecisionWay, HistoryRecord } from './store.ts'
import type { ApproverInjected } from './ui-actions.ts'
import { NS } from './locales.ts'
import css from './Approver.module.css'

/** Props of the approval history page. */
export type HistorySectionProps = PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & InjectFace<ApproverInjected>

/** Records rendered per "show more" step. */
const PAGE = 50
const WAYS: readonly DecisionWay[] = ['user', 'all', 'grant', 'rule', 'auto-deny']

/**
 * Search keys of one record: aliases, project, and tool match fuzzily; target, operation, and request id as substrings.
 * @param record - one history record.
 * @returns its search keys.
 */
export function historyKeys(record: HistoryRecord): SearchKeys {
  return { fuzzy: [...record.secrets, record.project, record.tool], substring: [record.target, record.operation, record.requestId] }
}

/**
 * Keep the records that match the search text and the result and way filters.
 * @param index - search index over the history, newest first.
 * @param query - search text; blank keeps every record in time order.
 * @param decision - `approve`, `deny`, or empty for any.
 * @param way - a decision way, or empty for any.
 * @returns the matching records, best match first.
 */
export function filterHistory(index: TextSearchIndex<HistoryRecord>, query: string, decision: string, way: string): HistoryRecord[] {
  return index.search(query).filter(r => (decision === '' || r.decision === decision) && (way === '' || r.way === way))
}

function returnedText(t: HistorySectionProps['t'], value: string): string {
  if (value === 'mock') return t('value.mock')
  if (value === 'manual') return t('value.manual')
  if (value.startsWith('copy:')) return t('value.copy', { label: value.slice(5) })
  return t('value.default')
}

function wayText(t: HistorySectionProps['t'], record: HistoryRecord): string {
  // A signed reject reason already says that the request was refused automatically.
  return record.reason === '' ? t(`way.${record.way}`) : t(`reason.${record.reason}`)
}

function Row({ record, t }: { record: HistoryRecord; t: HistorySectionProps['t'] }): ReactNode {
  const returned = Object.entries(record.returned)
  const grant = record.grant === null ? ''
    : 'times' in record.grant ? t('history.times', { count: record.grant.times }) : t('history.seconds', { minutes: Math.round(record.grant.seconds / 60) })
  return (
    <li className={css.record}>
      <div className={css.recordHead}>
        <span className={record.decision === 'approve' ? css.approved : css.denied}>{t(`decision.${record.decision}`)}</span>
        <strong>{record.secrets.join(', ')}</strong>
        <span className={css.muted}>{t(`kind.${record.kind}`)} · {record.tool} · {record.target}</span>
        <time className={css.muted} dateTime={new Date(record.at).toISOString()}>{new Date(record.at).toLocaleString()}</time>
      </div>
      <details className={css.raw}>
        <summary>{wayText(t, record)} · {t('card.project')} {record.project}</summary>
        <dl className={css.facts}>
          <div><dt>{t('card.operation')}</dt><dd>{record.operation}</dd></div>
          <div><dt>{t('history.task')}</dt><dd>{record.task}</dd></div>
          <div><dt>{t('history.injector')}</dt><dd>{record.injector}</dd></div>
          {returned.length === 0 ? null : (
            <div><dt>{t('history.returned')}</dt><dd>{returned.map(([alias, value]) => `${alias}: ${returnedText(t, value)}`).join('; ')}</dd></div>
          )}
          {grant === '' ? null : <div><dt>{t('history.grant')}</dt><dd>{grant}</dd></div>}
        </dl>
        <pre>{record.requestText}</pre>
      </details>
    </li>
  )
}

/**
 * Render the approval history page.
 * @param props - approver state hooks, actions, and localized copy.
 * @returns the page.
 */
export function HistorySection(props: HistorySectionProps): ReactNode {
  const { t } = props
  const history = props.useApproverState(s => s.history)
  const loaded = props.useApproverState(s => s.loaded)
  const [query, setQuery] = useState('')
  const [decision, setDecision] = useState('')
  const [way, setWay] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [confirming, setConfirming] = useState(false)
  const index = useMemo(() => new TextSearchIndex(history, historyKeys), [history])
  const matching = useMemo(() => filterHistory(index, query, decision, way), [index, query, decision, way])
  if (!loaded) return null
  const exportJson = (): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(matching, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `approval-history-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className={css.page}>
      <p className={css.muted}>{t('history.intro')}</p>
      <div className={css.row}>
        <Input aria-label={t('history.search')} placeholder={t('history.search')} value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE) }} />
        <select className={css.select} aria-label={t('history.anyDecision')} value={decision} onChange={(e) => { setDecision(e.target.value); setShown(PAGE) }}>
          <option value="">{t('history.anyDecision')}</option>
          <option value="approve">{t('decision.approve')}</option>
          <option value="deny">{t('decision.deny')}</option>
        </select>
        <select className={css.select} aria-label={t('history.anyWay')} value={way} onChange={(e) => { setWay(e.target.value); setShown(PAGE) }}>
          <option value="">{t('history.anyWay')}</option>
          {WAYS.map(w => <option key={w} value={w}>{t(`way.${w}`)}</option>)}
        </select>
      </div>
      {history.length === 0 ? <p className={css.muted}>{t('history.empty')}</p> : (
        <>
          <div className={css.row}>
            <span className={css.muted}>{t('history.count', { count: matching.length, shown: Math.min(shown, matching.length) })}</span>
            <Button size="sm" variant="outline" disabled={matching.length === 0} onClick={exportJson}>{t('history.export')}</Button>
            <Button size="sm" variant="outline" onClick={() => {
              if (!confirming) { setConfirming(true); return }
              setConfirming(false)
              void props.clearHistory().catch(() => {})
            }}>{confirming ? t('history.confirmClear') : t('history.clear')}</Button>
          </div>
          <ul className={css.records}>
            {matching.slice(0, shown).map(record => <Row key={record.key} record={record} t={t} />)}
          </ul>
          {matching.length > shown ? <Button variant="outline" onClick={() => { setShown(shown + PAGE) }}>{t('history.more')}</Button> : null}
        </>
      )}
    </div>
  )
}
