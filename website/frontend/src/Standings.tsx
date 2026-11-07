/**
 * Standings rendering and period controls work over sample data.
 * @mock-backend Parent-provided leaders/nearby ranks/returns are fixtures; live mode has none.
 * @mock-frontend The empty state is selected by the demo scenario, not a response.
 * @implemented-ui Summary-only rows, participant highlight, unavailable state, and period buttons.
 * Replace ranking observations and loading/empty/error state from the real API.
 */
import { UnstyledButton } from '@mantine/core';
import type { Period, Standings } from './fixtures.ts';
import { periods } from './fixtures.ts';
import { cx, initials, signed } from './styles';

type RankingProps = {
  /** Null when rankings are unavailable (live mode). */
  period: Standings | null;
  empty: boolean;
  /** Display name of the signed-in participant, for highlighting. */
  you: string;
};
/** @mock-backend Parent-provided sample ranks. @implemented-ui Row rendering and unavailable state. */
export function Nearby({ period, empty, you }: RankingProps) {
  if (!period)
    return (
      <div className={cx('chart-empty')}>
        <strong>Standings unavailable</strong>
        <p>Rankings are not calculated yet.</p>
      </div>
    );
  if (empty)
    return (
      <div className={cx('chart-empty')}>
        <strong>No standings yet</strong>
        <p>Awaiting the first ranking snapshot.</p>
      </div>
    );
  return period.nearby.map(([name, profit], index) => (
    <div key={name} className={cx('nearby-row', name === you && 'is-you')}>
      <span className={cx('position')}>{period.rank - 2 + index}</span>
      <span className={cx('mini-avatar')} aria-hidden="true">
        {initials(name)}
      </span>
      <span>
        {name}
        {name === you && <span className={cx('you-label')}>YOU</span>}
      </span>
      <span className={cx('positive')}>{signed(profit)}</span>
    </div>
  ));
}
/** @mock-backend Sample ranking records and availability; no competitor account data is fetched. @implemented-ui Table rendering. */
export function RankingRows({ period, empty, you }: RankingProps) {
  if (!period)
    return (
      <tr>
        <td className={cx('empty-cell')} colSpan={3}>
          Rankings are not calculated yet.
        </td>
      </tr>
    );
  if (empty)
    return (
      <tr>
        <td className={cx('empty-cell')} colSpan={3}>
          Awaiting the first ranking snapshot.
        </td>
      </tr>
    );
  const seen = new Set(period.leaders.map(([name]) => name));
  const row = (rank: number, name: string, profit: number) => (
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
      <td className={cx('positive')}>{signed(profit)}</td>
    </tr>
  );
  return (
    <>
      {period.leaders.map(([name, profit], index) =>
        row(index + 1, name, profit),
      )}
      {period.rank - 2 > 6 && (
        <tr className={cx('gap-row')}>
          <td colSpan={3} aria-label="Other participants omitted">
            ···
          </td>
        </tr>
      )}
      {period.nearby.map(([name, profit], index) =>
        seen.has(name) ? null : row(period.rank - 2 + index, name, profit),
      )}
    </>
  );
}
/** @implemented-ui Controlled period selection and native keyboard behavior; parent owns the mocked dataset lookup. */
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
      {(Object.keys(periods) as Period[]).map((key) => (
        <UnstyledButton
          key={key}
          type="button"
          aria-pressed={key === value}
          disabled={disabled}
          onClick={() => onChange(key)}
        >
          {periods[key].label}
        </UnstyledButton>
      ))}
    </fieldset>
  );
}
