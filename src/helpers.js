const DEFAULT_ENERGY_HISTORY_SIZE = 128;

export function normalizeBpm(bpm) {
  if (!bpm) {
    return null;
  }
  let normalized = bpm;
  while (normalized < 70) {
    normalized *= 2;
  }
  while (normalized > 200) {
    normalized /= 2;
  }
  return normalized;
}

export function calculateRefinedBpm(times) {
  if (times.length < 3) {
    return null;
  }

  const intervals = [];
  for (let i = 1; i < times.length; i += 1) {
    intervals.push(times[i] - times[i - 1]);
  }

  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];

  const filtered = intervals.filter((interval) => Math.abs(interval - medianInterval) <= medianInterval * 0.25);
  const required = Math.max(2, Math.ceil(intervals.length * 0.6));
  if (filtered.length < required) {
    return null;
  }

  const sum = filtered.reduce((acc, value) => acc + value, 0);
  const averageInterval = sum / filtered.length;

  const variance = filtered.reduce((acc, value) => acc + (value - averageInterval) ** 2, 0) / filtered.length;
  const deviation = Math.sqrt(variance);

  if (deviation > 45) {
    return null;
  }

  return normalizeBpm(60000 / averageInterval);
}

export function createEnergyHistory(size = DEFAULT_ENERGY_HISTORY_SIZE) {
  const values = [];
  let sum = 0;
  let sqSum = 0;

  function reset() {
    values.length = 0;
    sum = 0;
    sqSum = 0;
  }

  function push(value) {
    values.push(value);
    sum += value;
    sqSum += value * value;
    if (values.length > size) {
      const removed = values.shift();
      sum -= removed;
      sqSum -= removed * removed;
    }
  }

  function stats() {
    const length = values.length;
    if (length === 0) {
      return { mean: 0, std: 0 };
    }
    const mean = sum / length;
    const variance = Math.max(0, sqSum / length - mean * mean);
    return { mean, std: Math.sqrt(variance) };
  }

  return {
    push,
    reset,
    stats,
    get length() {
      return values.length;
    }
  };
}
