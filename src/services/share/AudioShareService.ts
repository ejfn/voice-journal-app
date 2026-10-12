import * as Sharing from "expo-sharing";
import { Share } from "react-native";
import { isAudioFileValid } from "../../utils/audioPersistence";

export interface ShareResult {
  success: boolean;
  error?: string;
  cancelled?: boolean;
}

export class AudioShareService {
  /**
   * Synchronously checks whether a local audio file exists and is valid on disk.
   */
  static isAudioDownloaded(localPath?: string | null): boolean {
    return isAudioFileValid(localPath);
  }

  /**
   * Checks whether the device supports native file sharing via expo-sharing.
   */
  static async isSharingAvailable(): Promise<boolean> {
    try {
      return await Sharing.isAvailableAsync();
    } catch {
      return false;
    }
  }

  /**
   * Ensures a local file path has a proper file:// scheme.
   */
  static formatFileUri(path: string): string {
    if (!path) return "";
    if (path.startsWith("file://")) {
      return path;
    }
    return `file://${path.startsWith("/") ? "" : "/"}${path}`;
  }

  /**
   * Shares a local audio file (.m4a) to external apps via the native system share sheet.
   * Uses RFC-standard mimeType: 'audio/mp4'.
   */
  static async shareAudioFile(localPath: string): Promise<ShareResult> {
    const uri = this.formatFileUri(localPath);

    if (!this.isAudioDownloaded(uri)) {
      return {
        success: false,
        error: "Audio file is not available on device.",
      };
    }

    const available = await this.isSharingAvailable();
    if (!available) {
      return {
        success: false,
        error: "Audio sharing is not supported on this device.",
      };
    }

    try {
      await Sharing.shareAsync(uri, {
        mimeType: "audio/mp4",
        dialogTitle: "Share Audio Recording",
      });

      return { success: true };
    } catch (err) {
      const message = (err as Error)?.message || "";
      // User dismissed or cancelled the native share dialog
      if (
        message.toLowerCase().includes("cancel") ||
        message.toLowerCase().includes("dismiss")
      ) {
        return { success: false, cancelled: true };
      }

      return {
        success: false,
        error: message || "Failed to share audio file.",
      };
    }
  }

  /**
   * Shares the entry transcript as text via React Native's native Share.share.
   * Handles title prefixing and fire-and-forget Android quirks gracefully.
   */
  static async shareTranscript(
    title: string,
    transcript: string,
  ): Promise<ShareResult> {
    const trimmedTranscript = (transcript || "").trim();
    if (!trimmedTranscript) {
      return {
        success: false,
        error: "No transcript available to share.",
      };
    }

    const trimmedTitle = (title || "").trim();
    const message = trimmedTitle
      ? `${trimmedTitle}\n\n${trimmedTranscript}`
      : trimmedTranscript;

    try {
      const result = await Share.share({
        message,
        title: trimmedTitle || "Voice Journal Transcript",
      });

      if (result.action === Share.dismissedAction) {
        return { success: false, cancelled: true };
      }

      return { success: true };
    } catch (err) {
      const message = (err as Error)?.message || "";
      if (
        message.toLowerCase().includes("cancel") ||
        message.toLowerCase().includes("dismiss")
      ) {
        return { success: false, cancelled: true };
      }

      return {
        success: false,
        error: message || "Failed to share transcript.",
      };
    }
  }
}
