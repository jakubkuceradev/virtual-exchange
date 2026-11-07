/**
 * Account view: presentation implemented, identity/access documentation mocked.
 * @mock-backend Profile identity and signed-in status are fixtures; there is no authenticated session.
 * @mock-frontend Request URL, authorization scheme, payload, and API notes are provisional examples.
 * @implemented-ui Profile layout and navigable documentation anchor.
 * Replace profile/session data and example/documentation with published API contracts.
 */
import { Credentials } from './Credentials';
import { participant } from './fixtures.ts';
import { cx } from './styles';

/** @mock-backend Profile/session. @mock-frontend API example and documentation placeholders. */
export function Account({ active }: { active: boolean }) {
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
          <article className={cx('panel')}>
            <div className={cx('panel-heading')}>
              <h2>{'Account details'}</h2>
              <span className={cx('label')}>{'01'}</span>
            </div>
            <div className={cx('profile-identity')}>
              <span className={cx('avatar large-avatar')}>
                {participant.initials}
              </span>
              <div>
                <h3>{participant.name}</h3>
                <p className={cx('small muted')}>{'Participant'}</p>
              </div>
            </div>
            <dl className={cx('account-details')}>
              <div>
                <dt>{'Display name'}</dt>
                <dd>{participant.name}</dd>
              </div>
              <div>
                <dt>{'Account ID'}</dt>
                <dd>
                  <code>{participant.id}</code>
                </dd>
              </div>
              <div>
                <dt>{'Market'}</dt>
                <dd>{'QC / EUR'}</dd>
              </div>
              <div>
                <dt>{'Account status'}</dt>
                <dd>
                  <span className={cx('positive')}>{'●'}</span>
                  {' Sample signed-in account'}
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
            <p className={cx('muted')}>
              {'An illustrative request for a future trading API.'}
            </p>
            <div className={cx('code-heading')}>
              <span>{'EXAMPLE REQUEST'}</span>
              <span className={cx('meta-label')}>{'Provisional'}</span>
            </div>
            <pre>
              <code>
                <span className={cx('syntax-comment')}>
                  {'# Example only — endpoint is not implemented'}
                </span>
                {
                  "\ncurl https://api.example.invalid/orders \\\n  -H 'Authorization: Bearer DEMO_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\n    "
                }
                <span className={cx('syntax-key')}>{'"instrument"'}</span>
                {': '}
                <span className={cx('syntax-value')}>{'"QC-EUR"'}</span>
                {',\n    '}
                <span className={cx('syntax-key')}>{'"side"'}</span>
                {': '}
                <span className={cx('syntax-value')}>{'"buy"'}</span>
                {',\n    '}
                <span className={cx('syntax-key')}>{'"limit_price"'}</span>
                {': '}
                <span className={cx('syntax-value')}>{'"110.00"'}</span>
                {',\n    '}
                <span className={cx('syntax-key')}>{'"quantity"'}</span>
                {': '}
                <span className={cx('syntax-value')}>{'"10"'}</span>
                {"\n  }'"}
              </code>
            </pre>
            <a className={cx('text-link')} href="#account/api-docs">
              {'Read provisional API notes '}
              <span aria-hidden="true">{'↗'}</span>
            </a>
            <div id="api-docs" className={cx('api-notes')} tabIndex={-1}>
              <h3>{'Provisional API documentation'}</h3>
              <p>
                {
                  'The request above illustrates a possible limit-order API. Its URL, credential scheme, and fields are placeholders. This preview is not connected to a trading endpoint.'
                }
              </p>
              <p>
                {
                  'API-driven participation is planned. Browser trading will not be required to compete.'
                }
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
