export interface AggregatedMetrics {
  mean: number;
  median: number;
  stddev: number;
  /** Median absolute deviation — a robust, outlier-resistant dispersion measure. */
  mad: number;
  min: number;
  max: number;
  samples: number;
}

/** Median of an already-sorted array. */
function medianOfSorted(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
}

export function aggregate(values: number[]): AggregatedMetrics {
  if (values.length === 0) {
    throw new Error('Cannot aggregate an empty measurement set');
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Cannot aggregate a measurement that is not finite');
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const median = medianOfSorted(sorted);
  const variance = sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n > 1 ? n - 1 : n);
  const stddev = Math.sqrt(variance);
  // MAD = median(|xᵢ − median|); paired with the median it resists a lone outlier
  // (e.g. [0,0,0,0,500] has median 0 and MAD 0, so a sustained shift still registers).
  const mad = medianOfSorted([...sorted.map((v) => Math.abs(v - median))].sort((a, b) => a - b));

  return { mean, median, stddev, mad, min: sorted[0], max: sorted[n - 1], samples: n };
}

/** Round a number to a fixed number of decimal places for display. */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
