import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, round } from './statistics.ts';

test('aggregate rejects an empty sample set instead of inventing a clean measurement', () => {
  assert.throws(() => aggregate([]), /empty/i);
});

test('aggregate rejects nonfinite measurements', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => aggregate([10, value]), /finite/i);
  }
});

test('aggregate computes mean, median and range for an odd sample count', () => {
  const result = aggregate([10, 2, 6, 4, 8]);
  assert.equal(result.samples, 5);
  assert.equal(result.mean, 6);
  assert.equal(result.median, 6);
  assert.equal(result.min, 2);
  assert.equal(result.max, 10);
});

test('aggregate averages the two middle values for an even sample count', () => {
  const result = aggregate([1, 2, 3, 4]);
  assert.equal(result.median, 2.5);
});

test('median resists a single noisy outlier without reporting a redundant p95', () => {
  const values = [10, 10, 10, 10, 200];
  const result = aggregate(values);
  assert.equal(result.median, 10);
  assert.equal(result.max, 200);
  assert.ok(!('p95' in result));
});

test('stddev uses the sample (n-1) denominator', () => {
  const result = aggregate([2, 4, 6]);
  // variance = ((-2)^2 + 0 + 2^2) / (3-1) = 4 => stddev = 2
  assert.equal(result.stddev, 2);
});

test('mad is the median absolute deviation and resists a lone outlier', () => {
  // median 100; |dev| = [20,0,10,10,0] -> sorted [0,0,10,10,20] -> mad 10
  assert.equal(aggregate([80, 100, 90, 110, 100]).mad, 10);
  // A single huge outlier leaves MAD at 0 while stddev explodes.
  const skewed = aggregate([0, 0, 0, 0, 500]);
  assert.equal(skewed.mad, 0);
  assert.ok(skewed.stddev > 200);
});

test('round trims to the requested number of decimals', () => {
  assert.equal(round(1.23456, 2), 1.23);
  assert.equal(round(1.005, 2), 1.0);
  assert.equal(round(10, 0), 10);
});
