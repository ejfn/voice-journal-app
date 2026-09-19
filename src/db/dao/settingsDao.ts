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
};
