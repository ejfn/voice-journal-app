import { File } from "expo-file-system";
import { settingsDao } from "../../db/dao/settingsDao";

export interface GeminiAnalysisResult {
  title: string;
  transcript: string;
  tags: string[]; // 3-5 lowercase tags without '#'
  summary: string;
}

export const ANALYZE_AUDIO_PROMPT = `
You are a voice journal assistant analyzing audio recorded on a personal smartphone.

Speaker Context:
- Personal diary entry: When the phone owner is speaking into their device (personal thoughts, reflections, daily logs), adopt their perspective using first-person ("I...") or concise diary style.
- External speaker: When recording someone else (e.g. a lecture, presentation, doctor visit, or someone speaking across a room), summarize the subject matter objectively without forcing "I".
- Conversation: When multiple people are speaking, summarize the dialogue and key points naturally.

Instructions:
1. Transcript:
   - Transcribe actual spoken words verbatim, cleaning out distracting filler words (um, uh, like).
   - Transcribe speech only. Never describe physical actions, ambient sounds, or what the person is doing (do not write "The user is doing...", "The speaker sighs", etc.).
   - Include speaker labels only when necessary to distinguish different speakers in a conversation.
2. Summary:
   - Provide a clear 1-sentence executive summary of the entry.
   - Never refer to the speaker in the third person as "the user" or "the speaker".
3. Title:
   - Create a short, natural diary headline title (3 to 6 words).
4. Tags:
   - Generate 3 to 5 relevant, specific, single-word lowercase tags without hashtags (e.g. school, science, poster, running, cooking). Never use uppercase and never prefix with '#'.

Return pure JSON conforming to the schema.
`.trim();

export class GeminiService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || "";
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  getApiKey(): string {
    return this.apiKey;
  }

  async resolveApiKey(): Promise<string> {
    if (this.apiKey) {
      return this.apiKey;
    }
    try {
      return await settingsDao.getGeminiApiKey();
    } catch {
      return process.env.EXPO_PUBLIC_GEMINI_API_KEY || "";
    }
  }

  async hasKeyConfigured(): Promise<boolean> {
    const key = await this.resolveApiKey();
    return key.trim().length > 0;
  }

  async validateApiKey(
    keyToTest?: string,
  ): Promise<{ valid: boolean; error?: string }> {
    const key = (keyToTest ?? (await this.resolveApiKey())).trim();
    if (!key) {
      return { valid: false, error: "Gemini API key is not configured." };
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${key}`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Ping" }] }],
        }),
      });

      if (!response.ok) {
        let errMessage = "API key validation failed";
        try {
          const errJson = await response.json();
          errMessage =
            errJson?.error?.message || `API error (${response.status})`;
        } catch {
          errMessage = `API error (${response.status})`;
        }
        return { valid: false, error: errMessage };
      }

      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        error: (err as Error).message || "Connection failed",
      };
    }
  }

  cleanTags(tags: unknown[]): string[] {
    if (!Array.isArray(tags)) return [];
    return tags
      .map((t) => String(t).trim().toLowerCase().replace(/^#+/, ""))
      .filter((t) => t.length > 0 && !t.includes(" "));
  }

  async analyzeAudio(audioUri: string): Promise<GeminiAnalysisResult> {
    const effectiveKey = await this.resolveApiKey();
    if (!effectiveKey) {
      throw new Error(
        "Gemini API key is not configured. Please add your key in Settings.",
      );
    }

    // Read audio as base64 string
    const audioFile = new File(audioUri);
    const base64Audio = await audioFile.base64();

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${effectiveKey}`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "audio/mp4",
                data: base64Audio,
              },
            },
            {
              text: ANALYZE_AUDIO_PROMPT,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            title: {
              type: "STRING",
              description: "Short, natural diary headline (3-6 words)",
            },
            transcript: {
              type: "STRING",
              description:
                "Verbatim transcript of spoken speech, cleaned of filler words. Do not describe actions or use third-person commentary like 'the speaker/user is doing'.",
            },
            tags: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "3-5 relevant, lowercase tags without hashtags",
            },
            summary: {
              type: "STRING",
              description:
                "1-sentence summary. Use first-person ('I...') for phone owner, or objective topic summary for external/distant speakers. Never use 'the user is doing...' or 'the speaker is doing...'.",
            },
          },
          required: ["title", "transcript", "tags", "summary"],
        },
      },
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      throw new Error("Gemini returned an empty response candidate");
    }

    let parsed: {
      title?: string;
      transcript?: string;
      tags?: string[];
      summary?: string;
    };
    try {
      parsed = JSON.parse(candidateText);
    } catch {
      throw new Error(
        `Failed to parse Gemini response as JSON: ${candidateText}`,
      );
    }

    return {
      title: parsed.title || "Voice Journal Entry",
      transcript: parsed.transcript || "",
      tags: this.cleanTags(parsed.tags || []),
      summary: parsed.summary || "",
    };
  }
}

export const geminiService = new GeminiService();
