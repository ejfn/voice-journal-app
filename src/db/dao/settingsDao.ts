import { getDatabase } from "../database";

export const settingsDao = {
  async getSetting(key: string, defaultValue: string = ""): Promise<string> {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ key: string; value: string }>(
      "SELECT value FROM app_settings WHERE key = ?",
      [key],
    );
    return row ? row.value : defaultValue;
  },

  async getNumberSetting(key: string, defaultValue: number): Promise<number> {
    const val = await this.getSetting(key, String(defaultValue));
    const num = Number(val);
    return isNaN(num) ? defaultValue : num;
  },

  async setSetting(key: string, value: string): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  },

  async getMaxStorageMb(): Promise<number> {
    // Default 250 MB (0 means Unlimited)
    return this.getNumberSetting("max_audio_storage_mb", 250);
  },

  async setMaxStorageMb(mb: number): Promise<void> {
    await this.setSetting("max_audio_storage_mb", String(mb));
  },

  async getUserGeminiApiKey(): Promise<string> {
    return this.getSetting("gemini_api_key", "");
  },

  async getGeminiApiKey(): Promise<string> {
    const userKey = (await this.getUserGeminiApiKey()).trim();
    if (userKey) {
      return userKey;
    }
    // Fallback to local env only as secondary backup
    return process.env.EXPO_PUBLIC_GEMINI_API_KEY || "";
  },

  async setGeminiApiKey(key: string): Promise<void> {
    await this.setSetting("gemini_api_key", key.trim());
  },

  async getUpdateSnooze(): Promise<{ version: string; until: number }> {
    const version = await this.getSetting("update_snooze_version", "");
    const until = await this.getNumberSetting("update_snooze_until", 0);
    return { version, until };
  },

  async setUpdateSnooze(version: string, until: number): Promise<void> {
    await this.setSetting("update_snooze_version", version);
    await this.setSetting("update_snooze_until", String(until));
  },

  async clearUpdateSnooze(): Promise<void> {
    await this.setSetting("update_snooze_version", "");
    await this.setSetting("update_snooze_until", "0");
  },
};
