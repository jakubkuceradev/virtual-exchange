import assert from 'node:assert/strict';
import test from 'node:test';
import {
  add,
  cmp,
  format,
  fromUnits,
  isCanonical,
  isMultiple,
  mul,
  normalizeInput,
  scaleOf,
  sub,
  sum,
} from '../src/trading/decimal.ts';

test('arithmetic is exact where binary floating point is not', () => {
  assert.equal(add('0.1', '0.2'), '0.3');
  assert.equal(mul('100.01', '0.3'), '30.003');
  assert.equal(sub('1', '0.9'), '0.1');
  assert.equal(sub('0.5', '2'), '-1.5');
  assert.equal(sum(['0.1', '0.1', '0.1']), '0.3');
  assert.equal(
    mul('123456789012345678.99', '1000'),
    '123456789012345678990.00',
  );
});

test('comparison and increments use scaled integers', () => {
  assert.equal(cmp('1.10', '1.1'), 0);
  assert.equal(cmp('99.99', '100'), -1);
  assert.ok(isMultiple('100.10', '0.01'));
  assert.ok(isMultiple('2.5', '0.1'));
  assert.ok(!isMultiple('2.55', '0.1'));
  assert.ok(!isMultiple('1', '0'));
  assert.equal(scaleOf('0.01'), 2);
  assert.equal(scaleOf('0.10'), 1);
  assert.equal(scaleOf('5'), 0);
});

test('input normalization keeps the typed value and rejects non-decimals', () => {
  assert.equal(normalizeInput(' 007.50 '), '7.50');
  assert.equal(normalizeInput('0.1'), '0.1');
  for (const bad of ['', '1e3', '-1', '1,000', '.5', '5.', '0x10', 'NaN'])
    assert.equal(normalizeInput(bad), null, bad);
  assert.ok(isCanonical('100.00'));
  assert.ok(!isCanonical('01'));
});

test('display formatting groups digits and never rounds', () => {
  assert.equal(format('1234567.5', 2), '1,234,567.50');
  assert.equal(format('0.001', 2), '0.001');
  assert.equal(format('480'), '480');
  assert.equal(format('100000.00'), '100,000');
  assert.equal(format('-12.5', 2), '−12.50');
  assert.equal(fromUnits(11250, 2), '112.50');
  assert.equal(fromUnits(-5, 2), '-0.05');
});
