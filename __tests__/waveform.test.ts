import {
  getDeterministicWaveform,
  sampleAmplitudeData,
} from "../src/components/ReviewModal";

describe("Baseline Waveform Generator (when amplitude data is missing)", () => {
  it("generates the default number of flat baseline bars", () => {
    const bars = getDeterministicWaveform("test-entry-id");
    expect(bars.length).toBe(35);
    expect(bars.every((v) => v === 0.06)).toBe(true);
  });

  it("generates a custom number of flat baseline bars", () => {
    const bars = getDeterministicWaveform("test-entry-id", 50);
    expect(bars.length).toBe(50);
    expect(bars.every((v) => v === 0.06)).toBe(true);
  });

  it("returns flat baseline bars without synthetic sine waves", () => {
    const bars1 = getDeterministicWaveform("entry-1");
    const bars2 = getDeterministicWaveform("entry-2");
    expect(bars1).toEqual(bars2);
    expect(bars1.every((v) => v === 0.06)).toBe(true);
  });
});

describe("sampleAmplitudeData", () => {
  it("returns flat baseline array when input is empty", () => {
    const res = sampleAmplitudeData([], 10);
    expect(res).toHaveLength(10);
    expect(res.every((v) => v === 0.06)).toBe(true);
  });

  it("downsamples a larger array correctly with amplification", () => {
    const input = [0.1, 0.8, 0.2, 0.9, 0.3, 0.5, 0.1, 0.2];
    const res = sampleAmplitudeData(input, 4);
    expect(res).toHaveLength(4);
    // step size = 8 / 4 = 2.
    // chunk 1: [0.1, 0.8] -> max is 0.8 -> amplified: 0.8 * (1/0.9) = 0.8888...
    // chunk 2: [0.2, 0.9] -> max is 0.9 -> amplified: 0.9 * (1/0.9) = 1.0
    // chunk 3: [0.3, 0.5] -> max is 0.5 -> amplified: 0.5 * (1/0.9) = 0.5555...
    // chunk 4: [0.1, 0.2] -> max is 0.2 -> amplified: 0.2 * (1/0.9) = 0.2222...
    expect(res[0]).toBeCloseTo(0.8889, 3);
    expect(res[1]).toBeCloseTo(1.0, 3);
    expect(res[2]).toBeCloseTo(0.5556, 3);
    expect(res[3]).toBeCloseTo(0.2222, 3);
  });

  it("upsamples or handles short array correctly with amplification", () => {
    const input = [0.5, 0.6];
    const res = sampleAmplitudeData(input, 4);
    expect(res).toHaveLength(4);
    // step size = 2 / 4 = 0.5
    // i=0: startIdx = floor(0) = 0, endIdx = floor(0.5) = 0. empty window -> nearest sample is input[0] (0.5) -> amplified: 0.5 * (1/0.6) = 0.8333...
    // i=1: startIdx = floor(0.5) = 0, endIdx = floor(1) = 1. loop j=0: data[0] is 0.5 -> maxVal is 0.5 -> amplified: 0.8333...
    // i=2: startIdx = floor(1) = 1, endIdx = floor(1.5) = 1. empty window -> nearest sample is input[1] (0.6) -> amplified: 0.6 * (1/0.6) = 1.0
    // i=3: startIdx = floor(1.5) = 1, endIdx = floor(2) = 2. loop j=1: data[1] is 0.6 -> maxVal is 0.6 -> amplified: 1.0
    expect(res[0]).toBeCloseTo(0.8333, 3);
    expect(res[1]).toBeCloseTo(0.8333, 3);
    expect(res[2]).toBeCloseTo(1.0, 3);
    expect(res[3]).toBeCloseTo(1.0, 3);
  });

  it("does not amplify silent recordings to full height", () => {
    const input = [0, 0, 0, 0];
    const res = sampleAmplitudeData(input, 4);
    expect(res).toEqual([0.06, 0.06, 0.06, 0.06]);
  });
});
