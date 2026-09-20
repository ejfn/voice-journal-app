import { getDeterministicWaveform } from "../src/components/ReviewModal";

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
