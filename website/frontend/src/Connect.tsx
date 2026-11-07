/**
 * @implemented-ui Live API-token entry. The token is held only in tab memory by the
 * session: never stored, logged, or put in a URL; reload requires entering it again.
 */
import { UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { cx } from './styles';
import { useTrading } from './trading/context.tsx';
import type { AccountView, Session } from './trading/types.ts';

function connectionStatus(
  account: AccountView,
  permissions: readonly string[],
) {
  switch (account.status) {
    case 'signed-out':
      return {
        text: 'Not connected. Public market data is shown.',
        error: false,
      };
    case 'connecting':
      return { text: 'Connecting to your account…', error: false };
    case 'rejected':
      return {
        text: 'The token was not accepted. Check it and try again.',
        error: true,
      };
    case 'no-read':
      return {
        text: `Connected as ${account.accountId}, but this token has no read access. Live trading needs a token with read access to show your balances and orders.`,
        error: true,
      };
    case 'not-provisioned':
      return {
        text: `Connected as ${account.accountId}, but this account has no trading allocation on the exchange.`,
        error: true,
      };
    case 'stale':
      return { text: 'Reconnecting to your account…', error: false };
    case 'ready':
      return {
        text: `Connected as ${account.accountId} · ${
          permissions.includes('trade') ? 'read and trade' : 'read only'
        }.`,
        error: false,
      };
  }
}

/** @implemented-ui Token form, connection status, and disconnect. */
export function Connect({ session }: { session: Session }) {
  const { account, identity } = useTrading();
  const [token, setToken] = useState('');
  const connected =
    account.status !== 'signed-out' && account.status !== 'rejected';
  const status = connectionStatus(account, identity?.permissions ?? []);
  return (
    <article className={cx('panel credential-panel connect-panel')}>
      <div className={cx('panel-heading')}>
        <div>
          <p className={cx('eyebrow')}>00 / CONNECT</p>
          <h2>Exchange access</h2>
        </div>
        <span className={cx('meta-label', connected && 'positive')}>
          {connected ? 'Connected' : 'Signed out'}
        </span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = token;
          setToken('');
          if (value) void session.connect(value);
        }}
      >
        <label className={cx('field-label')} htmlFor="api-token">
          API token
        </label>
        <div className={cx('credential-field')}>
          <input
            id="api-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={connected ? 'Enter a token to switch account' : ''}
          />
          <UnstyledButton
            className={cx('button')}
            type="submit"
            disabled={!token}
          >
            Connect
          </UnstyledButton>
        </div>
      </form>
      <p className={cx('small muted')}>
        Tokens are issued by the exchange operator. The token stays in this tab
        only; reloading the page signs you out.
      </p>
      {connected && (
        <div className={cx('credential-actions')}>
          <UnstyledButton
            className={cx('button danger-quiet')}
            type="button"
            onClick={() => session.disconnect()}
          >
            Disconnect
          </UnstyledButton>
        </div>
      )}
      <p
        id="connection-status"
        className={cx('inline-feedback', status.error && 'is-error')}
        role="status"
        aria-live="polite"
      >
        {status.text}
      </p>
    </article>
  );
}
