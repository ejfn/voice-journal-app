import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { entriesDao } from "../db/dao/entriesDao";
import { googleDriveService } from "../services/drive/GoogleDriveService";
import { useTheme } from "../theme/ThemeContext";

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onSyncCompleted?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  onClose,
  onSyncCompleted,
}) => {
  const { colors, mode, setMode } = useTheme();

  // Google Sign-In state
  const [googleUser, setGoogleUser] = useState<{
    email: string;
    name: string | null;
  } | null>(null);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Cache stats
  const [cachedClipsCount, setCachedClipsCount] = useState<number>(0);
  const [isCleaningCache, setIsCleaningCache] = useState<boolean>(false);

  const refreshStatus = useCallback(async () => {
    try {
      const user = googleDriveService.getCurrentUser();
      setGoogleUser(user);

      const prunable = await entriesDao.getPrunableCachedEntries();
      setCachedClipsCount(prunable.length);
    } catch {
      // Ignore initial status fetch error
    }
  }, []);

  useEffect(() => {
    if (visible) {
      refreshStatus();
    }
  }, [visible, refreshStatus]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    try {
      await googleDriveService.signIn();
      const user = googleDriveService.getCurrentUser();
      setGoogleUser(user);
      Alert.alert(
        "Signed In",
        `Connected to Google Drive as ${user?.email || "user"}`,
      );
    } catch (err) {
      Alert.alert(
        "Google Sign-In Error",
        (err as Error).message || "Sign in failed",
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGoogleSignOut = async () => {
    try {
      await googleDriveService.signOut();
      setGoogleUser(null);
      Alert.alert("Signed Out", "Disconnected from Google Drive.");
    } catch (err) {
      Alert.alert("Sign Out Notice", (err as Error).message);
    }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const result = await googleDriveService.syncTimelineFromDrive();
      await googleDriveService.runLruEviction();
      await refreshStatus();
      if (onSyncCompleted) {
        onSyncCompleted();
      }
      Alert.alert(
        "Sync Complete",
        `Synchronized timeline. ${result.importedCount} new clips downloaded.`,
      );
    } catch (err) {
      Alert.alert(
        "Sync Failed",
        (err as Error).message || "Failed to sync with Google Drive.",
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRunLruCleanup = async () => {
    setIsCleaningCache(true);
    try {
      const result = await googleDriveService.runLruEviction();
      await refreshStatus();
      if (onSyncCompleted) {
        onSyncCompleted();
      }
      const freedMb = (result.freedBytes / (1024 * 1024)).toFixed(1);
      Alert.alert(
        "Cache Cleaned",
        `Evicted ${result.evictedCount} audio file(s) older than 30 days or exceeding cache quota (${freedMb} MB freed). Cloud backups remain intact.`,
      );
    } catch (err) {
      Alert.alert("Cleanup Notice", (err as Error).message);
    } finally {
      setIsCleaningCache(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Settings & Sync
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={[styles.closeText, { color: colors.primary }]}>
              Done
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Section: Google Drive Account */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardIcon}>☁️</Text>
              <View style={styles.cardTitleContainer}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Google Drive Sync
                </Text>
                <Text
                  style={[styles.cardSubtitle, { color: colors.textMuted }]}
                >
                  Stores clips hierarchically in VoiceJournal/YYYY/MM/
                </Text>
              </View>
            </View>

            <View
              style={[styles.statusBox, { backgroundColor: colors.surfaceAlt }]}
            >
              <Text style={[styles.statusLabel, { color: colors.textMuted }]}>
                STATUS
              </Text>
              <Text
                style={[
                  styles.statusValue,
                  { color: googleUser ? colors.success : colors.textMuted },
                ]}
              >
                {googleUser
                  ? `✓ Connected (${googleUser.email})`
                  : "✕ Not connected"}
              </Text>
            </View>

            <View style={styles.buttonRow}>
              {googleUser ? (
                <TouchableOpacity
                  style={[styles.outlineButton, { borderColor: colors.danger }]}
                  onPress={handleGoogleSignOut}
                >
                  <Text
                    style={[styles.outlineButtonText, { color: colors.danger }]}
                  >
                    Sign Out
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: colors.primary },
                  ]}
                  onPress={handleGoogleSignIn}
                  disabled={isSigningIn}
                >
                  {isSigningIn ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      Sign In with Google
                    </Text>
                  )}
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.secondaryButton,
                  { backgroundColor: colors.surfaceAlt },
                ]}
                onPress={handleManualSync}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text
                    style={[
                      styles.secondaryButtonText,
                      { color: colors.primary },
                    ]}
                  >
                    Sync Now
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.statusBox,
                { backgroundColor: colors.surfaceAlt, marginTop: 8 },
              ]}
            >
              <Text style={[styles.statusLabel, { color: colors.textMuted }]}>
                CONFIGURATION SOURCE
              </Text>
              <Text
                style={[
                  styles.statusValue,
                  {
                    color: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
                      ? colors.text
                      : colors.danger,
                  },
                ]}
              >
                {process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
                  ? "✓ EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID configured"
                  : "✕ Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (.env / EAS)"}
              </Text>
            </View>
          </View>

          {/* Section: Gemini Multimodal AI */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardIcon}>✨</Text>
              <View style={styles.cardTitleContainer}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Gemini Flash Multimodal AI
                </Text>
                <Text
                  style={[styles.cardSubtitle, { color: colors.textMuted }]}
                >
                  Transcribes audio, creates headlines, summaries & clean tags
                </Text>
              </View>
            </View>

            <View
              style={[styles.statusBox, { backgroundColor: colors.surfaceAlt }]}
            >
              <Text style={[styles.statusLabel, { color: colors.textMuted }]}>
                API KEY STATUS
              </Text>
              <Text
                style={[
                  styles.statusValue,
                  {
                    color: process.env.EXPO_PUBLIC_GEMINI_API_KEY
                      ? colors.success
                      : colors.danger,
                  },
                ]}
              >
                {process.env.EXPO_PUBLIC_GEMINI_API_KEY
                  ? "✓ EXPO_PUBLIC_GEMINI_API_KEY configured (Gemini 2.5 Flash)"
                  : "✕ Missing EXPO_PUBLIC_GEMINI_API_KEY (.env / EAS)"}
              </Text>
            </View>
          </View>

          {/* Section: Storage & LRU Cache */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardIcon}>💾</Text>
              <View style={styles.cardTitleContainer}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Storage & On-Demand Cache
                </Text>
                <Text
                  style={[styles.cardSubtitle, { color: colors.textMuted }]}
                >
                  {"Local audio cache with LRU eviction (>500MB or >30 days)"}
                </Text>
              </View>
            </View>

            <View
              style={[styles.statusBox, { backgroundColor: colors.surfaceAlt }]}
            >
              <Text style={[styles.statusLabel, { color: colors.textMuted }]}>
                CACHED AUDIO CLIPS
              </Text>
              <Text style={[styles.statusValue, { color: colors.text }]}>
                {cachedClipsCount} audio file(s) currently stored on device
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.outlineButton, { borderColor: colors.border }]}
              onPress={handleRunLruCleanup}
              disabled={isCleaningCache}
            >
              {isCleaningCache ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text
                  style={[styles.outlineButtonText, { color: colors.text }]}
                >
                  Run Cache Cleanup (Evict &gt;30d)
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Section: Theme Preference */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.cardTitle,
                { color: colors.text, marginBottom: 12 },
              ]}
            >
              Appearance
            </Text>
            <View style={styles.themeSelectorRow}>
              {(["auto", "light", "dark"] as const).map((tMode) => (
                <TouchableOpacity
                  key={tMode}
                  style={[
                    styles.themeOptionBtn,
                    {
                      backgroundColor:
                        mode === tMode ? colors.primary : colors.surfaceAlt,
                      borderColor:
                        mode === tMode ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setMode(tMode)}
                >
                  <Text
                    style={[
                      styles.themeOptionText,
                      { color: mode === tMode ? "#FFF" : colors.text },
                    ]}
                  >
                    {tMode === "auto"
                      ? "🌓 Auto"
                      : tMode === "light"
                        ? "☀️ Light"
                        : "🌙 Dark"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* About / Version Info */}
          <View style={styles.aboutContainer}>
            <Text style={[styles.aboutTitle, { color: colors.text }]}>
              Voice Journal (VoiceJournal)
            </Text>
            <Text style={[styles.aboutText, { color: colors.textMuted }]}>
              Package: com.personal.voicejournal
            </Text>
            <Text style={[styles.aboutText, { color: colors.textMuted }]}>
              Version: 1.0.0 (Zero Subscription Voice Diary)
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 48 : 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    fontSize: 16,
    fontWeight: "600",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  cardIcon: {
    fontSize: 24,
  },
  cardTitleContainer: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  statusBox: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 14,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  statusValue: {
    fontSize: 13,
    fontWeight: "600",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "600",
  },
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  outlineButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  themeSelectorRow: {
    flexDirection: "row",
    gap: 10,
  },
  themeOptionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  themeOptionText: {
    fontSize: 13,
    fontWeight: "600",
  },
  aboutContainer: {
    alignItems: "center",
    paddingVertical: 20,
    gap: 4,
  },
  aboutTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  aboutText: {
    fontSize: 12,
  },
});
