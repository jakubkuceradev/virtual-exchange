/**
 * Standings rendering and period controls work over sample data.
 * @mock-backend Parent-provided leaders/nearby ranks/returns and signed-in identity are fixtures.
 * @mock-frontend The empty/available state is selected by the demo scenario, not a response.
 * @implemented-ui Summary-only rows, participant highlight, and period-button behavior.
 * Replace ranking observations/identity and loading/empty/error state from the real API.
 */
import { UnstyledButton } from '@mantine/core';
import { useDemo } from './DemoContext';
import type { Period, Standings } from './fixtures.ts';
import { participant, periods } from './fixtures.ts';
import { cx, initials, signed } from './styles';

/** @mock-backend Fixture identity/availability and parent-provided sample ranks. @implemented-ui Row rendering. */
export function Nearby({ period }: { period: Standings }) {
  const { empty } = useDemo();
  if (empty)
    return (
      <div className={cx('chart-empty')}>
        <strong>No standings yet</strong>
        <p>Awaiting the first ranking snapshot.</p>
      </div>
    );
  return period.nearby.map(([name, profit], index) => (
    <div
      key={name}
      className={cx('nearby-row', name === participant.name && 'is-you')}
    >
      <span className={cx('position')}>{period.rank - 2 + index}</span>
      <span className={cx('mini-avatar')} aria-hidden="true">
        {initials(name)}
      </span>
      <span>
        {name}
        {name === participant.name && (
          <span className={cx('you-label')}>YOU</span>
        )}
      </span>
      <span className={cx('positive')}>{signed(profit)}</span>
    </div>
  ));
}
/** @mock-backend Sample ranking records and availability; no competitor account data is fetched. @implemented-ui Table rendering. */
export function RankingRows({ period }: { period: Standings }) {
  const { empty } = useDemo();
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
    <tr key={name} className={cx(name === participant.name && 'is-you')}>
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
            {name === participant.name && (
              <span className={cx('you-label')}>YOU</span>
            )}
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
}: {
  value: Period;
  onChange: (value: Period) => void;
}) {
  return (
    <fieldset className={cx('period-controls')}>
      <legend className={cx('sr-only')}>Leaderboard period</legend>
      {(Object.keys(periods) as Period[]).map((key) => (
        <UnstyledButton
          key={key}
          type="button"
          aria-pressed={key === value}
          onClick={() => onChange(key)}
        >
          {periods[key].label}
        </UnstyledButton>
      ))}
    </fieldset>
  );
}
