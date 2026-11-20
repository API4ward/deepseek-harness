/** Settings page of the approver: device, relay connection, injectors, credentials, and approval modes. */
import { useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ApproverInjected } from './ui-actions.ts'
import { NS } from './locales.ts'
import css from './Approver.module.css'

/** Props of the approver settings page. */
export type ApproverSectionProps = PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & InjectFace<ApproverInjected>

function CopyBox({ text, t }: { text: string; t: ApproverSectionProps['t'] }): ReactNode {
  const [copied, setCopied] = useState(false)
  return (
    <div className={css.command}>
      <pre>{text}</pre>
      <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true) }, () => { setCopied(false) }) }}>
        {copied ? t('copied') : t('copy')}
      </Button>
    </div>
  )
}

/**
 * Render the approver settings page.
 * @param props - approver state hooks, actions, and localized copy.
 * @returns the page.
 */
export function ApproverSection(props: ApproverSectionProps): ReactNode {
  const { t, useApproverState, useApproverFailure } = props
  const state = useApproverState(s => s)
  const failure = useApproverFailure(f => f)
  const [user, setUser] = useState('')
  const [pairing, setPairing] = useState('')
  const [alias, setAlias] = useState('')
  const [value, setValue] = useState('')
  const [repos, setRepos] = useState('')
  const [copyAlias, setCopyAlias] = useState('')
  const [copyLabel, setCopyLabel] = useState('')
  const [copyValue, setCopyValue] = useState('')
  const [minutes, setMinutes] = useState('10')
  const [rule, setRule] = useState({ kind: '*', secret: '', tool: '', target: '' })
  const [busy, setBusy] = useState(false)
  const run = (action: () => Promise<void>, after?: () => void): void => {
    props.clearFailure()
    setBusy(true)
    void action().then(() => { after?.() }, () => {}).finally(() => { setBusy(false) })
  }
  if (!state.loaded) return null
  const device = state.device
  const quote = (text: string): string => `'${text.replaceAll('\'', '\'\\\'\'')}'`
  const pairingFile = device === null ? '' : `cat > approver.json <<'EOF'\n${device.pairing}\nEOF\n`
  return (
    <div className={css.page}>
      <p className={css.muted}>{props.t('intro')}</p>
      {failure !== null ? <p className={css.failure} role="alert">{t(failure.key, { detail: failure.detail })}</p> : null}

      <section className={css.group}>
        <h3>{t('device.heading')}</h3>
        {device === null
          ? (
            <div className={css.row}>
              <Input aria-label={t('device.user')} placeholder={t('device.user')} value={user} onChange={(e) => { setUser(e.target.value) }} />
              <Button variant="primary" disabled={busy} onClick={() => { run(() => props.createDevice(user)) }}>{t('device.create')}</Button>
            </div>
          )
          : (
            <>
              <p>{t('device.id', { id: device.id, user: device.user })}</p>
              <p className={css.muted}>{t('device.pairing')}</p>
              <CopyBox t={t} text={`${pairingFile}agentsecret relay device-register --pairing-file approver.json\nagentsecret injector pair-approver --pairing-file approver.json`} />
            </>
          )}
      </section>

      {device === null ? null : (
        <>
          <section className={css.group}>
            <h3>{t('relay.heading')}</h3>
            <p className={css.muted}>{t('relay.url', { url: props.relayUrl() })}</p>
            <p>{state.connected ? t('relay.connected') : t('relay.disconnected')}</p>
            {state.connected ? null : <Button variant="primary" disabled={busy} onClick={() => { run(props.connect) }}>{t('relay.connect')}</Button>}
          </section>

          <section className={css.group}>
            <h3>{t('injector.heading')}</h3>
            {state.injectors.length === 0 ? <p className={css.muted}>{t('injector.none')}</p> : (
              <ul className={css.list}>
                {state.injectors.map(id => (
                  <li key={id}>{id}{state.relayInjectors?.includes(id) === true ? ` · ${t('injector.relay')}` : ''}</li>
                ))}
              </ul>
            )}
            <p className={css.muted}>{t('injector.paste')}</p>
            <CopyBox t={t} text={`agentsecret injector init --user ${quote(device.user)} --relay ${props.relayUrl()}\nagentsecret injector pairing --out injector.json`} />
            <textarea className={css.textarea} aria-label={t('injector.paste')} rows={5} value={pairing} onChange={(e) => { setPairing(e.target.value) }} />
            <Button disabled={busy || pairing.trim() === ''} onClick={() => { run(() => props.pairInjector(pairing), () => { setPairing('') }) }}>{t('injector.pair')}</Button>
          </section>

          <section className={css.group}>
            <h3>{t('secret.heading')}</h3>
            {state.secrets.length === 0 ? <p className={css.muted}>{t('secret.none')}</p> : (
              <ul className={css.list}>
                {state.secrets.map(s => (
                  <li key={s.alias}>
                    <span>
                      {s.alias}
                      {s.copies.length > 0 ? ` · ${t('secret.copies', { labels: s.copies.join(', ') })}` : ''}
                      {s.repos.length > 0 ? ` · ${t('secret.reposList', { repos: s.repos.join(', ') })}` : ''}
                    </span>
                    <Button size="sm" disabled={busy} onClick={() => { run(() => props.removeSecret(s.alias)) }}>{t('secret.remove')}</Button>
                  </li>
                ))}
              </ul>
            )}
            <div className={css.row}>
              <Input aria-label={t('secret.alias')} placeholder={t('secret.alias')} value={alias} onChange={(e) => { setAlias(e.target.value) }} />
              <Input aria-label={t('secret.value')} placeholder={t('secret.value')} type="password" autoComplete="off" value={value} onChange={(e) => { setValue(e.target.value) }} />
            </div>
            <Input aria-label={t('secret.repos')} placeholder={t('secret.repos')} value={repos} onChange={(e) => { setRepos(e.target.value) }} />
            <Button variant="primary" disabled={busy} onClick={() => {
              run(() => props.addSecret(alias, value, repos.split(',')), () => { setAlias(''); setValue(''); setRepos('') })
            }}>{t('secret.add')}</Button>
            <h4>{t('copy.heading')}</h4>
            <div className={css.row}>
              <Input aria-label={t('secret.alias')} placeholder={t('secret.alias')} value={copyAlias} onChange={(e) => { setCopyAlias(e.target.value) }} />
              <Input aria-label={t('copy.label')} placeholder={t('copy.label')} value={copyLabel} onChange={(e) => { setCopyLabel(e.target.value) }} />
              <Input aria-label={t('secret.value')} placeholder={t('secret.value')} type="password" autoComplete="off" value={copyValue} onChange={(e) => { setCopyValue(e.target.value) }} />
            </div>
            <Button disabled={busy} onClick={() => {
              run(() => props.addCopy(copyAlias, copyLabel, copyValue), () => { setCopyAlias(''); setCopyLabel(''); setCopyValue('') })
            }}>{t('copy.add')}</Button>
          </section>

          <section className={css.group}>
            <h3>{t('mode.heading')}</h3>
            <p>{state.allUntil > Date.now() ? t('mode.all', { time: new Date(state.allUntil).toLocaleTimeString() }) : t('mode.ask')}</p>
            <div className={css.row}>
              <Input aria-label={t('mode.minutes')} type="number" min={1} value={minutes} onChange={(e) => { setMinutes(e.target.value) }} />
              <span>{t('mode.minutes')}</span>
              <Button disabled={busy} onClick={() => { run(() => props.setAllMode(Math.max(1, Number(minutes) || 10))) }}>{t('mode.allOn')}</Button>
              <Button disabled={busy} onClick={() => { run(() => props.setAllMode(0)) }}>{t('mode.allOff')}</Button>
            </div>
            <h4>{t('rule.heading')}</h4>
            <ul className={css.list}>
              {state.autoRules.map((r, index) => (
                <li key={`${index}-${r.kind}-${r.secret}-${r.tool}-${r.target}`}>
                  <span>{t('rule.item', { kind: r.kind, secret: r.secret, tool: r.tool, target: r.target })}</span>
                  <Button size="sm" disabled={busy} onClick={() => { run(() => props.removeAutoRule(index)) }}>{t('secret.remove')}</Button>
                </li>
              ))}
            </ul>
            <div className={css.row}>
              <select className={css.select} aria-label={t('rule.kind')} value={rule.kind} onChange={(e) => { setRule({ ...rule, kind: e.target.value }) }}>
                {['*', 'reveal', 'fill', 'reference', 'use'].map(kind => <option key={kind} value={kind}>{kind}</option>)}
              </select>
              <Input aria-label={t('rule.secret')} placeholder={t('rule.secret')} value={rule.secret} onChange={(e) => { setRule({ ...rule, secret: e.target.value }) }} />
              <Input aria-label={t('rule.tool')} placeholder={t('rule.tool')} value={rule.tool} onChange={(e) => { setRule({ ...rule, tool: e.target.value }) }} />
              <Input aria-label={t('rule.target')} placeholder={t('rule.target')} value={rule.target} onChange={(e) => { setRule({ ...rule, target: e.target.value }) }} />
            </div>
            <Button disabled={busy} onClick={() => { run(() => props.addAutoRule(rule), () => { setRule({ kind: '*', secret: '', tool: '', target: '' }) }) }}>{t('rule.add')}</Button>
          </section>

          <p className={css.muted}>{t('log.hint')}</p>
        </>
      )}
    </div>
  )
}
