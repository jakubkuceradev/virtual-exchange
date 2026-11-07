/**
 * @implemented-ui Exact decimal-string arithmetic for amounts shown or submitted.
 * Values stay canonical strings ("112.50", "0.1"); BigInt scaled integers do the
 * arithmetic so binary floating point never changes a price, quantity, or balance.
 * `toNumber` exists only for chart pixel positions and percentages.
 */

/** Canonical unsigned decimal string, matching the exchange's wire grammar. */
export type Decimal = string;

type Scaled = { units: bigint; scale: number };

const CANONICAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const SIGNED = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/** True for the exchange's canonical unsigned decimal grammar. */
export function isCanonical(value: string): boolean {
  return CANONICAL.test(value);
}

/**
 * Normalize typed input into a canonical decimal string without changing its value:
 * trims whitespace and redundant leading integer zeros; keeps fractional digits as typed.
 * Returns null for anything that is not an unsigned plain decimal.
 */
export function normalizeInput(raw: string): Decimal | null {
  const text = raw.trim();
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return null;
  const [whole = '0', fraction] = text.split('.');
  const integer = whole.replace(/^0+(?=[0-9])/, '');
  return fraction === undefined ? integer : `${integer}.${fraction}`;
}

function parse(value: Decimal): Scaled {
  if (!SIGNED.test(value)) throw new RangeError(`Not a decimal: ${value}`);
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (
    negative ? value.slice(1) : value
  ).split('.');
  const units = BigInt(whole + fraction);
  return { units: negative ? -units : units, scale: fraction.length };
}

function render({ units, scale }: Scaled): Decimal {
  const negative = units < 0n;
  const digits = (negative ? -units : units)
    .toString()
    .padStart(scale + 1, '0');
  const text =
    scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative && units !== 0n ? `-${text}` : text;
}

function align(a: Scaled, b: Scaled): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [
    a.units * 10n ** BigInt(scale - a.scale),
    b.units * 10n ** BigInt(scale - b.scale),
    scale,
  ];
}

export function add(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(parse(a), parse(b));
  return render({ units: x + y, scale });
}

export function sub(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(parse(a), parse(b));
  return render({ units: x - y, scale });
}

export function mul(a: Decimal, b: Decimal): Decimal {
  const x = parse(a),
    y = parse(b);
  return render({ units: x.units * y.units, scale: x.scale + y.scale });
}

export function cmp(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const [x, y] = align(parse(a), parse(b));
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isZero(value: Decimal): boolean {
  return parse(value).units === 0n;
}

export function sum(values: Iterable<Decimal>): Decimal {
  let total: Decimal = '0';
  for (const value of values) total = add(total, value);
  return total;
}

/** True when `value` is an exact multiple of a positive `increment`. */
export function isMultiple(value: Decimal, increment: Decimal): boolean {
  const [x, step] = align(parse(value), parse(increment));
  return step > 0n && x % step === 0n;
}

/** Number of fractional digits needed to express multiples of `increment`. */
export function scaleOf(increment: Decimal): number {
  const { units, scale } = parse(increment);
  let trailing = 0;
  for (let rest = units; rest !== 0n && rest % 10n === 0n; rest /= 10n)
    trailing++;
  return Math.max(0, scale - trailing);
}

/** Integer count of minor units (e.g. cents) as a decimal string at `scale`. */
export function fromUnits(units: number | bigint, scale: number): Decimal {
  return render({ units: BigInt(units), scale });
}

/** Approximate value for chart geometry and percentages only — never for amounts. */
export function toNumber(value: Decimal): number {
  return Number(value);
}

/**
 * Group thousands (en-GB) and pad the fraction to at least `minScale` digits.
 * Never rounds: digits beyond `minScale` that the value actually has are kept,
 * except trailing zeros beyond `minScale`.
 */
export function format(value: Decimal, minScale = 0): string {
  const negative = value.startsWith('-');
  const [whole = '0', rawFraction = ''] = (
    negative ? value.slice(1) : value
  ).split('.');
  let fraction = rawFraction.replace(/0+$/, '');
  if (fraction.length < minScale) fraction = fraction.padEnd(minScale, '0');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}
