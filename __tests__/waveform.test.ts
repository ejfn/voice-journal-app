import {
  getDeterministicWaveform,
  sampleAmplitudeData,
} from "../src/components/ReviewModal";

describe("Deterministic Waveform Generator", () => {
  it("generates the default number of bars", () => {
    const bars = getDeterministicWaveform("test-entry-id");
    expect(bars.length).toBe(35);
  });

  it("generates a custom number of bars", () => {
    const bars = getDeterministicWaveform("test-entry-id", 50);
    expect(bars.length).toBe(50);
  });

  it("clamps all values between 0.15 and 1.0", () => {
    const bars = getDeterministicWaveform("another-long-entry-id-12345");
    bars.forEach((val) => {
      expect(val).toBeGreaterThanOrEqual(0.15);
      expect(val).toBeLessThanOrEqual(1.0);
    });
  });

  it("is completely deterministic for the same input", () => {
    const bars1 = getDeterministicWaveform("same-id");
    const bars2 = getDeterministicWaveform("same-id");
    expect(bars1).toEqual(bars2);
  });

  it("generates different waveforms for different input IDs", () => {
    const bars1 = getDeterministicWaveform("id-one");
    const bars2 = getDeterministicWaveform("id-two");
    expect(bars1).not.toEqual(bars2);
  });

  it("applies a tapering envelope (smaller at the ends)", () => {
    const bars = getDeterministicWaveform("taper-test-id", 35);
    // The ends (index 0 and 34) should be clamped to 0.15 due to the sine taper factor
    expect(bars[0]).toBe(0.15);
    expect(bars[34]).toBe(0.15);
    // The middle should have some larger peak values
    const maxVal = Math.max(...bars);
    expect(maxVal).toBeGreaterThan(0.3);
  });
});

describe("sampleAmplitudeData", () => {
  it("returns filled default array when input is empty", () => {
    const res = sampleAmplitudeData([], 10);
    expect(res).toHaveLength(10);
    expect(res.every((v) => v === 0.15)).toBe(true);
  });

  it("downsamples a larger array correctly", () => {
    const input = [0.1, 0.8, 0.2, 0.9, 0.3, 0.5, 0.1, 0.2];
    const res = sampleAmplitudeData(input, 4);
    expect(res).toHaveLength(4);
    // step size = 8 / 4 = 2.
    // chunk 1: [0.1, 0.8] -> max is 0.8
    // chunk 2: [0.2, 0.9] -> max is 0.9
    // chunk 3: [0.3, 0.5] -> max is 0.5
    // chunk 4: [0.1, 0.2] -> max is 0.2
    expect(res).toEqual([0.8, 0.9, 0.5, 0.2]);
  });

  it("upsamples or handles short array correctly", () => {
    const input = [0.5, 0.6];
    const res = sampleAmplitudeData(input, 4);
    expect(res).toHaveLength(4);
    // step size = 2 / 4 = 0.5
    // i=0: startIdx = floor(0) = 0, endIdx = floor(0.5) = 0. empty window -> nearest sample is input[0] (0.5)
    // i=1: startIdx = floor(0.5) = 0, endIdx = floor(1) = 1. loop j=0: data[0] is 0.5 -> maxVal is 0.5
    // i=2: startIdx = floor(1) = 1, endIdx = floor(1.5) = 1. empty window -> nearest sample is input[1] (0.6)
    // i=3: startIdx = floor(1.5) = 1, endIdx = floor(2) = 2. loop j=1: data[1] is 0.6 -> maxVal is 0.6
    expect(res).toEqual([0.5, 0.5, 0.6, 0.6]);
  });
});
