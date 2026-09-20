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
});
