/** Floating approval cards: every pending request this device may approve, while DHS is open. */
import { useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { GrantChoice, PendingRequest } from './approver.ts'
import type { ApproverInjected } from './ui-actions.ts'
import { NS } from './locales.ts'
import css from './Approver.module.css'

/** Props of the approval overlay. */
export type ApprovalOverlayProps = PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS> & InjectFace<ApproverInjected>

type GrantKey = 't3' | 't10' | 's180' | 's600' | 's3600'

const GRANTS: Readonly<Record<GrantKey, GrantChoice>> = {
  t3: { times: 3 }, t10: { times: 10 }, s180: { seconds: 180 }, s600: { seconds: 600 }, s3600: { seconds: 3600 },
}

function ApprovalCard({ request, props }: { request: PendingRequest; props: ApprovalOverlayProps }): ReactNode {
  const { t } = props
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [manual, setManual] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const picksValue = request.kind === 'use' || request.kind === 'fill'
  const answer = (decision: 'approve' | 'deny', grant: GrantChoice | null = null): void => {
    const choices: Record<string, string> = {}
    if (picksValue) {
      for (const alias of request.secrets) {
        const picked = choice[alias] ?? 'default'
        choices[alias] = picked === 'manual' ? `manual:${manual[alias] ?? ''}` : picked
      }
    }
    props.clearFailure()
    setBusy(true)
    void props.decide(request.id, decision, choices, grant).catch(() => {}).finally(() => { setBusy(false) })
  }
  const rows: [string, string][] = [
    [t('card.project'), request.project],
    [t('card.secrets'), request.secrets.join(', ')],
    ...request.tool === '' ? [] : [[t('card.tool'), request.tool] as [string, string]],
    ...request.target === '' ? [] : [[t('card.target'), request.target] as [string, string]],
    [t('card.operation'), request.operation],
    [t('card.expires'), new Date(request.expiresAt).toLocaleTimeString()],
  ]
  return (
    <article className={css.card} aria-label={t(`card.${request.kind}`)}>
      <h3>{t(`card.${request.kind}`)}</h3>
      <dl className={css.facts}>
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {picksValue ? request.secrets.map(alias => (
        <label key={alias} className={css.pick}>
          <span>{t('card.value', { alias })}</span>
          <select className={css.select} value={choice[alias] ?? 'default'} onChange={(e) => { setChoice({ ...choice, [alias]: e.target.value }) }}>
            <option value="default">{t('value.default')}</option>
            {(request.copies[alias] ?? []).map(label => <option key={label} value={`copy:${label}`}>{t('value.copy', { label })}</option>)}
            <option value="mock">{t('value.mock')}</option>
            <option value="manual">{t('value.manual')}</option>
          </select>
          {choice[alias] === 'manual'
            ? <Input type="password" autoComplete="off" aria-label={t('value.manual')} value={manual[alias] ?? ''} onChange={(e) => { setManual({ ...manual, [alias]: e.target.value }) }} />
            : null}
        </label>
      )) : null}
      <details className={css.raw}>
        <summary>{t('card.request')}</summary>
        <pre>{request.requestText}</pre>
      </details>
      <div className={css.actions}>
        <Button variant="outline" disabled={busy} onClick={() => { answer('deny') }}>{t('card.deny')}</Button>
        <Button variant="primary" disabled={busy} onClick={() => { answer('approve') }}>{t('card.allow')}</Button>
        <select className={css.select} aria-label={t('card.more')} disabled={busy} value="" onChange={(e) => {
          const key = e.target.value as GrantKey
          if (key in GRANTS) answer('approve', GRANTS[key])
        }}>
          <option value="">{t('card.more')}</option>
          {(Object.keys(GRANTS) as GrantKey[]).map(key => <option key={key} value={key}>{t(`card.${key}`)}</option>)}
        </select>
      </div>
    </article>
  )
}

/**
 * Render the pending approval cards.
 * @param props - approver state hooks, actions, and localized copy.
 * @returns the card stack, or null while nothing is pending.
 */
export function ApprovalOverlay(props: ApprovalOverlayProps): ReactNode {
  const requests = props.useApproverState(s => s.requests)
  const failure = props.useApproverFailure(f => f)
  if (requests.length === 0) return null
  return (
    <div className={css.overlay} role="region" aria-label={props.t('card.count', { count: requests.length })}>
      {requests.length > 1 ? <p className={css.count}>{props.t('card.count', { count: requests.length })}</p> : null}
      {failure !== null ? <p className={css.failure} role="alert">{props.t(failure.key, { detail: failure.detail })}</p> : null}
      {requests.map(request => <ApprovalCard key={request.id} request={request} props={props} />)}
    </div>
  )
}
