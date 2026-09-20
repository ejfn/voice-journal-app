import { generateDeterministicWaveform } from "../src/utils/waveform";

describe("Deterministic Waveform Generator", () => {
  it("generates deterministic waveform array for identical seeds", () => {
    const run1 = generateDeterministicWaveform("entry-uuid-1", 75);
    const run2 = generateDeterministicWaveform("entry-uuid-1", 75);

    expect(run1).toHaveLength(75);
    expect(run2).toHaveLength(75);
    expect(run1).toEqual(run2);
  });

  it("generates distinct waveforms for different seeds", () => {
    const waveA = generateDeterministicWaveform("entry-a", 50);
    const waveB = generateDeterministicWaveform("entry-b", 50);

    expect(waveA).not.toEqual(waveB);
  });

  it("respects custom bar count and clamps amplitudes between 0.08 and 0.95", () => {
    const bars = generateDeterministicWaveform("test-entry", 40);
    expect(bars).toHaveLength(40);

    bars.forEach((val) => {
      expect(val).toBeGreaterThanOrEqual(0.08);
      expect(val).toBeLessThanOrEqual(0.95);
    });
  });

  it("handles fallback default count when count parameter is omitted", () => {
    const defaultBars = generateDeterministicWaveform("test-entry");
    expect(defaultBars).toHaveLength(75);
  });
});
