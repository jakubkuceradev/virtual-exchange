/**
 * Credential controls: real clipboard UI around a simulated credential lifecycle.
 * @mock-backend Create/revoke/key state and success/failure feedback come from DemoContext.
 * @mock-frontend All displayed keys and the suggested access scheme are dummy placeholders.
 * @implemented-ui Clipboard write/read-only selection fallback, disabled states, and focus recovery.
 * Replace credential commands/state with authenticated APIs; keep browser clipboard behavior.
 */
import { UnstyledButton } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { useDemo } from './DemoContext';
import type { Feedback } from './demo.ts';
import { cx } from './styles';

/** @mock-backend Dummy create/revoke/state. @implemented-ui Actual browser clipboard and manual-copy fallback. */
export function Credentials() {
  const { state, createCredential, revokeCredential } = useDemo();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const keyRef = useRef<HTMLInputElement>(null),
    createRef = useRef<HTMLButtonElement>(null),
    copyRef = useRef<HTMLButtonElement>(null);
  const changed = useRef(false);
  useEffect(() => {
    if (changed.current)
      (state.credential ? copyRef : createRef).current?.focus();
    changed.current = false;
  }, [state.credential]);
  async function copy() {
    if (!state.credential) return;
    try {
      await navigator.clipboard.writeText(state.credential);
      setFeedback({ message: 'Sample key copied.' });
    } catch {
      keyRef.current?.focus();
      keyRef.current?.select();
      setFeedback({
        error:
          'Clipboard unavailable. The sample key is selected; copy it manually.',
      });
    }
  }
  return (
    <article className={cx('panel credential-panel')}>
      <div className={cx('panel-heading')}>
        <div>
          <p className={cx('eyebrow')}>02 / PROGRAMMATIC ACCESS</p>
          <h2>Your API credential</h2>
        </div>
        <span className={cx('meta-label', !!state.credential && 'positive')}>
          Sample · {state.credential ? 'active' : 'revoked'}
        </span>
      </div>
      <p className={cx('muted')}>
        A preview of API access for your own trading tools.
      </p>
      <label className={cx('field-label')} htmlFor="credential">
        Sample key
      </label>
      <div className={cx('credential-field')}>
        <input
          ref={keyRef}
          id="credential"
          readOnly
          value={state.credential ?? 'No active sample key'}
          spellCheck={false}
        />
        <UnstyledButton
          ref={copyRef}
          className={cx('button')}
          type="button"
          disabled={!state.credential}
          onClick={copy}
        >
          Copy
        </UnstyledButton>
      </div>
      <p className={cx('small muted')}>
        Dummy credential. It cannot authenticate or place real orders.
      </p>
      <div className={cx('credential-actions')}>
        <UnstyledButton
          ref={createRef}
          className={cx('button')}
          type="button"
          disabled={!!state.credential}
          onClick={() => {
            changed.current = true;
            setFeedback(createCredential());
          }}
        >
          Create sample key
        </UnstyledButton>
        <UnstyledButton
          className={cx('button danger-quiet')}
          type="button"
          disabled={!state.credential}
          onClick={() => {
            changed.current = true;
            setFeedback(revokeCredential());
          }}
        >
          Revoke sample key
        </UnstyledButton>
      </div>
      <p
        className={cx('inline-feedback', !!feedback?.error && 'is-error')}
        role="status"
        aria-live="polite"
      >
        {feedback?.error || feedback?.message}
      </p>
    </article>
  );
}
