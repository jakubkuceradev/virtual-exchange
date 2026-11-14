/**
 * Standings rendering and period controls over the source's competition view.
 * @implemented-ui Summary-only rows with explicit ranks, participant highlight,
 *   unavailable/empty/unranked states, and period buttons. Live data comes from
 *   the website backend; the mock source supplies fixtures.
 */
import { UnstyledButton } from '@mantine/core';
import type { Period } from './fixtures.ts';
import { cx, initials, signed } from './styles';
import type { PeriodStanding, Ranking } from './trading/types.ts';

export const periodLabels: Record<Period, string> = {
  continuous: 'Continuous',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

const reasons: Record<string, string> = {
  no_fills: 'Not ranked: no fills in this period yet.',
  not_funded: 'Not ranked: this account is not a funded participant.',
  no_valuation: 'Not ranked: the account cannot be valued yet.',
};

/** Why the caller is unranked, in participant-facing copy. */
export function unrankedMessage(reason: string | null) {
  return reasons[reason ?? ''] ?? 'Not ranked in this period.';
}

type RankingProps = {
  /** Null when rankings are unavailable. */
  period: PeriodStanding | null;
  /** True when no ranking snapshot exists yet. */
  empty: boolean;
  /** Name of the signed-in participant, for highlighting. */
  you: string;
};

const tone = (value: number) => (value >= 0 ? 'positive' : 'negative');

/** @implemented-ui The caller's neighbourhood, or why it is not shown. */
export function Nearby({ period, empty, you }: RankingProps) {
  if (empty)
    return (
      <div className={cx('chart-empty')}>
        <strong>No standings yet</strong>
        <p>Awaiting the first ranking snapshot.</p>
      </div>
    );
  if (!period)
    return (
      <div className={cx('chart-empty')}>
        <strong>Standings unavailable</strong>
        <p>Rankings are not calculated yet.</p>
      </div>
    );
  if (!period.you)
    return (
      <div className={cx('chart-empty')}>
        <strong>Your position</strong>
        <p>Connect your account to see the standings around you.</p>
      </div>
    );
  if (period.you.rank == null)
    return (
      <div className={cx('chart-empty')}>
        <strong>Not ranked</strong>
        <p>{unrankedMessage(period.you.reason)}</p>
      </div>
    );
  return period.nearby.map(({ rank, name, returnPercent }) => (
    <div key={name} className={cx('nearby-row', name === you && 'is-you')}>
      <span className={cx('position')}>{rank}</span>
      <span className={cx('mini-avatar')} aria-hidden="true">
        {initials(name)}
      </span>
      <span>
        {name}
        {name === you && <span className={cx('you-label')}>YOU</span>}
      </span>
      <span className={cx(tone(returnPercent))}>{signed(returnPercent)}</span>
    </div>
  ));
}

/** @implemented-ui Leaders, then the caller's neighbourhood after a gap. */
export function RankingRows({ period, empty, you }: RankingProps) {
  if (!period && !empty)
    return (
      <tr>
        <td className={cx('empty-cell')} colSpan={3}>
          Rankings are not calculated yet.
        </td>
      </tr>
    );
  if (empty || !period || period.leaders.length === 0)
    return (
      <tr>
        <td className={cx('empty-cell')} colSpan={3}>
          {empty
            ? 'Awaiting the first ranking snapshot.'
            : 'No ranked participants yet.'}
        </td>
      </tr>
    );
  const seen = new Set(period.leaders.map(({ name }) => name));
  const rest = period.nearby.filter(({ name }) => !seen.has(name));
  const lastLeader = period.leaders.at(-1)?.rank ?? 0;
  const row = ({ rank, name, returnPercent }: Ranking) => (
    <tr key={name} className={cx(name === you && 'is-you')}>
      <td className={cx(rank <= 3 ? 'top-rank' : 'muted')}>
        {String(rank).padStart(2, '0')}
      </td>
      <td>
        <span className={cx('participant-cell')}>
          <span className={cx('mini-avatar')} aria-hidden="true">
            {initials(name)}
          </span>
          <span>
            {name}
            {name === you && <span className={cx('you-label')}>YOU</span>}
          </span>
        </span>
      </td>
      <td className={cx(tone(returnPercent))}>{signed(returnPercent)}</td>
    </tr>
  );
  return (
    <>
      {period.leaders.map(row)}
      {(rest[0]?.rank ?? 0) > lastLeader + 1 && (
        <tr className={cx('gap-row')}>
          <td colSpan={3} aria-label="Other participants omitted">
            ···
          </td>
        </tr>
      )}
      {rest.map(row)}
    </>
  );
}

/** @implemented-ui Controlled period selection and native keyboard behavior. */
export function PeriodControls({
  value,
  onChange,
  disabled = false,
}: {
  value: Period;
  onChange: (value: Period) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className={cx('period-controls')}>
      <legend className={cx('sr-only')}>Leaderboard period</legend>
      {(Object.keys(periodLabels) as Period[]).map((key) => (
        <UnstyledButton
          key={key}
          type="button"
          aria-pressed={key === value}
          disabled={disabled}
          onClick={() => onChange(key)}
        >
          {periodLabels[key]}
        </UnstyledButton>
      ))}
    </fieldset>
  );
}
