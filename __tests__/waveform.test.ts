import {
  generateDeterministicWaveform,
  getWaveformState,
  resampleWaveform,
  WAVEFORM_BAR_COUNT,
} from "../src/utils/waveform";

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
    expect(defaultBars).toHaveLength(WAVEFORM_BAR_COUNT);
  });

  describe("resampleWaveform", () => {
    it("returns empty array for empty input", () => {
      expect(resampleWaveform([])).toEqual([]);
    });

    it("clamps values when input length matches targetCount", () => {
      const input = [0.01, 0.5, 1.5];
      const output = resampleWaveform(input, 3);
      expect(output).toEqual([0.08, 0.5, 1.0]);
    });

    it("resamples arbitrary sample count to targetCount preserving peaks", () => {
      // 100 samples with a high peak in the middle
      const samples = new Array(100).fill(0.1);
      samples[50] = 0.9;
      const resampled = resampleWaveform(samples, 10);
      expect(resampled).toHaveLength(10);
      // Peak around index 5
      expect(resampled[5]).toBeGreaterThan(0.5);
    });
  });

  describe("getWaveformState", () => {
    const entryId = "entry-test-123";

    it("returns 'missing' for null or undefined or wrong array length", () => {
      expect(getWaveformState(entryId, null)).toBe("missing");
      expect(getWaveformState(entryId, undefined)).toBe("missing");
      expect(getWaveformState(entryId, [])).toBe("missing");
      expect(getWaveformState(entryId, new Array(50).fill(0.5))).toBe(
        "missing",
      );
    });

    it("returns 'missing' for all zeros or all 0.2 legacy dummy", () => {
      expect(
        getWaveformState(entryId, new Array(WAVEFORM_BAR_COUNT).fill(0)),
      ).toBe("missing");
      expect(
        getWaveformState(entryId, new Array(WAVEFORM_BAR_COUNT).fill(0.2)),
      ).toBe("missing");
    });

    it("returns 'missing' for flat uniform baseline (zero variance)", () => {
      expect(
        getWaveformState(entryId, new Array(WAVEFORM_BAR_COUNT).fill(0.45)),
      ).toBe("missing");
    });

    it("returns 'missing' when matching deterministic synthetic fallback", () => {
      const synthetic = generateDeterministicWaveform(
        entryId,
        WAVEFORM_BAR_COUNT,
      );
      expect(getWaveformState(entryId, synthetic)).toBe("missing");
    });

    it("returns 'half' when partially sampled with some 0 placeholders", () => {
      const partial = new Array(WAVEFORM_BAR_COUNT)
        .fill(0)
        .map((_, i) => (i < 30 ? 0.3 + (i % 5) * 0.1 : 0));
      expect(getWaveformState(entryId, partial)).toBe("half");
    });

    it("returns 'done' when fully sampled with authentic dynamic values", () => {
      const authentic = new Array(WAVEFORM_BAR_COUNT)
        .fill(0)
        .map((_, i) => 0.15 + ((i * 7) % 50) / 100);
      expect(getWaveformState(entryId, authentic)).toBe("done");
    });
  });
});
