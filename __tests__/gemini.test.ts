import {
  GeminiService,
  detectAudioMimeType,
} from "../src/services/ai/GeminiService";

describe("Gemini AI Service", () => {
  let service: GeminiService;

  beforeEach(() => {
    service = new GeminiService("test-api-key");
  });

  it("cleans tags to all-lowercase without hashtags", () => {
    const rawTags = ["#School", "#Science", "POSTER", "#Fun_Time", "   ", "#"];
    const cleaned = service.cleanTags(rawTags);

    expect(cleaned).toEqual(["school", "science", "poster", "fun_time"]);
  });

  it("parses valid structured JSON from Gemini REST API response", async () => {
    const mockApiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  title: "Science poster prep",
                  transcript:
                    "Today we worked on our presentation poster for science class.",
                  tags: ["#School", "#Science", "#Poster"],
                  summary: "Finished presentation poster for science class.",
                }),
              },
            ],
          },
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await service.analyzeAudio("file:///test/path.m4a");

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("models/gemini-3.5-flash-lite:generateContent"),
      expect.any(Object),
    );
    expect(result.title).toBe("Science poster prep");
    expect(result.transcript).toBe(
      "Today we worked on our presentation poster for science class.",
    );
    expect(result.tags).toEqual(["school", "science", "poster"]);
    expect(result.summary).toBe(
      "Finished presentation poster for science class.",
    );
  });

  it("throws error when API key is missing", async () => {
    const serviceWithoutKey = new GeminiService("");
    await expect(
      serviceWithoutKey.analyzeAudio("file:///test/path.m4a"),
    ).rejects.toThrow("Gemini API key is not configured");
  });

  it("validates API key successfully on 200 OK", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [] }),
    });

    const result = await service.validateApiKey("AIzaSy-test-valid-key");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("key=AIzaSy-test-valid-key"),
      expect.any(Object),
    );
  });

  it("returns validation error message on 400 API error", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { message: "API key not valid. Please pass a valid API key." },
      }),
    });

    const result = await service.validateApiKey("invalid-key");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("API key not valid");
  });

  it("returns validation error when key is empty", async () => {
    const result = await service.validateApiKey("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not configured");
  });

  it("checks hasKeyConfigured correctly", async () => {
    const withKey = new GeminiService("some-key");
    expect(await withKey.hasKeyConfigured()).toBe(true);

    const withoutKey = new GeminiService("");
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    expect(await withoutKey.hasKeyConfigured()).toBe(false);
  });

  it("transcribes audio chunk with preceding context tail", async () => {
    const mockApiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  transcript: "continued discussing the project timeline.",
                }),
              },
            ],
          },
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
    });

    const transcript = await service.transcribeChunk(
      "file:///test/chunk.m4a",
      "We started the meeting and",
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("models/gemini-3.5-flash-lite:generateContent"),
      expect.objectContaining({
        body: expect.stringContaining(
          "Preceding speech context from prior segment",
        ),
      }),
    );
    expect(transcript).toBe("continued discussing the project timeline.");
  });

  it("sets correct inline MIME type for .wav chunks (audio/wav) vs .m4a chunks (audio/mp4)", async () => {
    const mockApiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  transcript: "wav chunk transcript.",
                }),
              },
            ],
          },
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
    });

    await service.transcribeChunk("file:///test/chunk.wav");

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"mimeType":"audio/wav"'),
      }),
    );
  });

  it("analyzes completed transcript text to generate title, summary and tags", async () => {
    const mockApiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  title: "Team Project Timeline Review",
                  summary:
                    "Discussed project milestones and set deadlines for Q4.",
                  tags: ["#Work", "#Timeline", "#Project"],
                }),
              },
            ],
          },
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await service.analyzeTranscript(
      "We started the meeting and continued discussing the project timeline. We agreed on Q4 deadlines.",
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("models/gemini-3.5-flash-lite:generateContent"),
      expect.objectContaining({
        body: expect.stringContaining("We started the meeting"),
      }),
    );
    expect(result.title).toBe("Team Project Timeline Review");
    expect(result.summary).toBe(
      "Discussed project milestones and set deadlines for Q4.",
    );
    expect(result.tags).toEqual(["work", "timeline", "project"]);
  });

  describe("detectAudioMimeType", () => {
    it("detects WAV from RIFF magic bytes regardless of file extension", () => {
      // "UklGR..." is base64 for "RIFF..."
      const base64Wav =
        "UklGRi4AAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      expect(detectAudioMimeType("file:///sandbox/audio.m4a", base64Wav)).toBe(
        "audio/wav",
      );
    });

    it("detects MP3 from ID3 or MPEG sync bytes regardless of file extension", () => {
      // "SUQz..." is base64 for "ID3..."
      const base64Id3 =
        "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA";
      expect(detectAudioMimeType("file:///sandbox/audio.m4a", base64Id3)).toBe(
        "audio/mp3",
      );

      // "/+M..." is base64 for MPEG sync 0xFF 0xFB
      const base64MpegSync =
        "/+MYxAAAAANIAAAAAExBTUUzLjEwMAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
      expect(
        detectAudioMimeType("file:///sandbox/audio.m4a", base64MpegSync),
      ).toBe("audio/mp3");
    });

    it("detects OGG and FLAC from container magic bytes", () => {
      // "T2dnUw..." is "OggS..."
      expect(
        detectAudioMimeType(
          "file:///sandbox/audio.m4a",
          "T2dnUwACAAAAAAAAAAAAAAA=",
        ),
      ).toBe("audio/ogg");

      // "ZkxhQw..." is "fLaC..."
      expect(
        detectAudioMimeType(
          "file:///sandbox/audio.m4a",
          "ZkxhQwAAACIQABAAAAAA==",
        ),
      ).toBe("audio/flac");
    });

    it("falls back to file extension when base64 is unavailable or unrecognized", () => {
      expect(detectAudioMimeType("file:///cache/chunk.wav")).toBe("audio/wav");
      expect(detectAudioMimeType("file:///cache/chunk.mp3")).toBe("audio/mp3");
      expect(detectAudioMimeType("file:///cache/chunk.ogg")).toBe("audio/ogg");
      expect(detectAudioMimeType("file:///cache/chunk.flac")).toBe(
        "audio/flac",
      );
      expect(detectAudioMimeType("file:///cache/chunk.m4a")).toBe("audio/mp4");
      expect(detectAudioMimeType("file:///cache/chunk.unknown")).toBe(
        "audio/mp4",
      );
    });
  });
});
