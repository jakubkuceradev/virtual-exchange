/**
 * Account view: identity from the active source; access documentation mocked.
 * @implemented-ui Profile layout, identity/market from the source, documentation anchor.
 * @mock-frontend Request URL, authorization scheme, payload, and API notes are provisional examples.
 * @implemented-ui Profile layout and navigable documentation anchor.
 * Replace profile/session data and example/documentation with published API contracts.
 */
import { Connect } from './Connect';
import { Credentials } from './Credentials';
import { cx } from './styles';
import { useTrading } from './trading/context.tsx';

/** @mock-frontend The mock's reviewed placeholder request; live mode shows the real route. */
const examples = {
  mock: {
    intro: 'An illustrative request for a future trading API.',
    label: 'Provisional',
    comment: '# Example only — endpoint is not implemented',
    url: 'https://api.example.invalid/orders',
    token: 'DEMO_KEY',
    fields: [
      ['instrument', 'QC-EUR'],
      ['side', 'buy'],
      ['limit_price', '110.00'],
      ['quantity', '10'],
    ],
    link: 'Read provisional API notes ',
    notesTitle: 'Provisional API documentation',
    notes: [
      'The request above illustrates a possible limit-order API. Its URL, credential scheme, and fields are placeholders. This preview is not connected to a trading endpoint.',
      'API-driven participation is planned. Browser trading will not be required to compete.',
    ],
  },
  live: {
    intro: 'Place a limit order on the exchange from your own code.',
    label: 'Exchange REST',
    comment: '# Replace YOUR_TOKEN; use a new UUIDv4 for every order',
    url: 'http://EXCHANGE_HOST:8000/orders',
    token: 'YOUR_TOKEN',
    fields: [
      ['instrument_id', 'QC-EUR'],
      ['side', 'buy'],
      ['price', '100.00'],
      ['quantity', '1'],
      ['client_order_id', 'NEW_UUID_V4'],
    ],
    link: 'Read API notes ',
    notesTitle: 'API notes',
    notes: [
      'Amounts are decimal strings aligned to the instrument increments (GET /instruments). A 201 response only acknowledges the order; follow it with GET /orders/client:{uuid} or the orders/fills WebSocket channels to see its outcome.',
      'If a request times out, look the order up by its client_order_id before sending another — never resubmit under a new ID. Browser trading is not required to compete.',
    ],
  },
} as const;

/** @implemented-ui Profile from the source. */
export function Account({ active }: { active: boolean }) {
  const { identity, market, kind, session } = useTrading();
  const name = identity?.name ?? 'Not connected';
  const instrument = market.instrument;
  const example = examples[kind];
  return (
    <section
      data-view="account"
      aria-labelledby="account-title"
      hidden={!active}
    >
      <h1 id="account-title" className={cx('sr-only')} tabIndex={-1}>
        {'API / Account'}
      </h1>
      <div className={cx('account-grid')}>
        <div>
          {session && <Connect session={session} />}
          <article className={cx('panel')}>
            <div className={cx('panel-heading')}>
              <h2>{'Account details'}</h2>
              <span className={cx('label')}>{'01'}</span>
            </div>
            <div className={cx('profile-identity')}>
              <span className={cx('avatar large-avatar')}>
                {identity?.initials ?? '—'}
              </span>
              <div>
                <h3>{name}</h3>
                <p className={cx('small muted')}>{'Participant'}</p>
              </div>
            </div>
            <dl className={cx('account-details')}>
              <div>
                <dt>{'Display name'}</dt>
                <dd>{name}</dd>
              </div>
              <div>
                <dt>{'Account ID'}</dt>
                <dd>
                  <code>{identity?.accountId ?? '—'}</code>
                </dd>
              </div>
              <div>
                <dt>{'Market'}</dt>
                <dd>
                  {instrument
                    ? `${instrument.baseAsset} / ${instrument.quoteAsset}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>{'Account status'}</dt>
                <dd>
                  <span className={cx(identity ? 'positive' : 'muted')}>
                    {'●'}
                  </span>
                  {kind === 'mock'
                    ? ' Sample signed-in account'
                    : identity
                      ? ' Connected'
                      : ' Not connected'}
                </dd>
              </div>
            </dl>
          </article>
          <article className={cx('panel account-privacy')}>
            <span className={cx('code-mark')} aria-hidden="true">
              {'◇'}
            </span>
            <h3>{'Your strategy stays yours.'}</h3>
            <p>
              {
                'Others can see your rank and summary performance. Your holdings, individual orders, and fills stay private.'
              }
            </p>
          </article>
        </div>
        <div>
          <Credentials />
          <article className={cx('panel getting-started')}>
            <div className={cx('panel-heading')}>
              <div>
                <p className={cx('eyebrow')}>{'03 / GETTING STARTED'}</p>
                <h2>{'From idea to first request.'}</h2>
              </div>
              <span className={cx('code-mark')} aria-hidden="true">
                {'</>'}
              </span>
            </div>
            <p className={cx('muted')}>{example.intro}</p>
            <div className={cx('code-heading')}>
              <span>{'EXAMPLE REQUEST'}</span>
              <span className={cx('meta-label')}>{example.label}</span>
            </div>
            <pre>
              <code>
                <span className={cx('syntax-comment')}>{example.comment}</span>
                {`\ncurl ${example.url} \\\n  -H 'Authorization: Bearer ${example.token}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{`}
                {example.fields.map(([key, value], index) => (
                  <span key={key}>
                    {index ? ',\n    ' : '\n    '}
                    <span className={cx('syntax-key')}>{`"${key}"`}</span>
                    {': '}
                    <span className={cx('syntax-value')}>{`"${value}"`}</span>
                  </span>
                ))}
                {"\n  }'"}
              </code>
            </pre>
            <a className={cx('text-link')} href="#account/api-docs">
              {example.link}
              <span aria-hidden="true">{'↗'}</span>
            </a>
            <div id="api-docs" className={cx('api-notes')} tabIndex={-1}>
              <h3>{example.notesTitle}</h3>
              {example.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
