import { GeminiService } from "../src/services/ai/GeminiService";

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
});
