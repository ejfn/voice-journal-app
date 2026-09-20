export const WAVEFORM_BAR_COUNT = 75;

/**
 * Generates a deterministic sequence of normalized waveform bar amplitudes (0.08 to 0.95)
 * for an audio entry based on its unique seed (e.g. entry ID).
 *
 * Simulates natural speech envelopes: phrases, harmonic bursts, syllable cadence,
 * and intermittent sentence pauses.
 */
export const generateDeterministicWaveform = (
  seed: string,
  count: number = WAVEFORM_BAR_COUNT,
): number[] => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const seedNum = Math.abs(hash) || 1;

  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    // Smooth envelope tapering at start and end
    const phraseEnvelope = Math.sin(t * Math.PI);
    const harmonic1 = Math.sin(i * 0.35 + (seedNum % 13));
    const harmonic2 = Math.cos(i * 0.72 + (seedNum % 17));
    const harmonic3 = Math.sin(i * 1.45 + (seedNum % 19));

    // Combined amplitude
    let raw = 0.45 + 0.25 * harmonic1 + 0.18 * harmonic2 + 0.12 * harmonic3;
    raw = raw * (0.35 + 0.65 * phraseEnvelope);

    // Natural sentence pauses
    const isPause =
      (i + (seedNum % 7)) % 17 === 0 || (i + (seedNum % 5)) % 29 === 0;
    if (isPause) {
      raw *= 0.2;
    }

    const clamped = Math.max(0.08, Math.min(0.95, Number(raw.toFixed(2))));
    bars.push(clamped);
  }

  return bars;
};

/**
 * Resamples an array of amplitude values (0.0 to 1.0) into a target count of bars.
 * Uses peak/average pooling to preserve transient vocal peaks and speech dynamics.
 */
export const resampleWaveform = (
  samples: number[],
  targetCount: number = WAVEFORM_BAR_COUNT,
): number[] => {
  if (!samples || samples.length === 0) {
    return [];
  }

  if (samples.length === targetCount) {
    return samples.map((v) =>
      Math.max(0.08, Math.min(1.0, Number(v.toFixed(2)))),
    );
  }

  const result: number[] = [];
  const step = samples.length / targetCount;

  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * step);
    const end = Math.min(samples.length, Math.floor((i + 1) * step));

    if (start >= end) {
      const val = samples[Math.min(start, samples.length - 1)] ?? 0.08;
      result.push(Math.max(0.08, Math.min(1.0, Number(val.toFixed(2)))));
      continue;
    }

    let maxVal = 0;
    let sumVal = 0;
    for (let j = start; j < end; j++) {
      const v = samples[j] ?? 0;
      if (v > maxVal) maxVal = v;
      sumVal += v;
    }
    const avgVal = sumVal / (end - start);
    // Blend 70% peak + 30% average for natural speech waveform appearance
    const blended = 0.7 * maxVal + 0.3 * avgVal;
    result.push(Math.max(0.08, Math.min(1.0, Number(blended.toFixed(2)))));
  }

  return result;
};

export type WaveformState = "missing" | "half" | "done";

/**
 * Determines whether an entry's waveform is:
 * - "missing": null/undefined, wrong length, all 0s, all 0.2, flat uniform, or synthetic fallback envelope
 * - "half": partially sampled (some bars are 0 un-sampled placeholders)
 * - "done": authentic, non-zero, dynamic audio amplitudes matching WAVEFORM_BAR_COUNT
 */
export const getWaveformState = (
  entryId: string,
  raw: number[] | null | undefined,
): WaveformState => {
  if (!raw || !Array.isArray(raw) || raw.length !== WAVEFORM_BAR_COUNT) {
    return "missing";
  }
  if (raw.every((v) => v === 0)) {
    return "missing";
  }
  if (raw.every((v) => v === 0.2)) {
    return "missing";
  }
  // Check for flat uniform baseline (zero variance across all bars)
  if (raw.every((v) => Math.abs(v - raw[0]) < 0.001)) {
    return "missing";
  }

  // Check if this array was produced by generateDeterministicWaveform fallback
  const synthetic = generateDeterministicWaveform(entryId, WAVEFORM_BAR_COUNT);
  let matchCount = 0;
  for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
    if (Math.abs(raw[i] - synthetic[i]) < 0.02) {
      matchCount++;
    }
  }
  if (matchCount >= Math.floor(WAVEFORM_BAR_COUNT * 0.8)) {
    return "missing";
  }

  // If any bar is 0, it is an un-sampled gap from partial playback
  if (raw.some((v) => v === 0)) {
    return "half";
  }

  return "done";
};
