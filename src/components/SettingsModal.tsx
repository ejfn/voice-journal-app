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
      Alert.alert("Google Sign-In", (err as Error).message || "Sign in failed");
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
      Alert.alert("Sign Out", (err as Error).message);
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
        `Evicted ${result.evictedCount} audio file(s) exceeding cache quota (${freedMb} MB freed). Cloud backups remain intact.`,
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
        {/* Header */}
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
            Settings
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={[styles.closeText, { color: colors.primary }]}>
              Done
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Section: Google Drive Cloud Sync */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.cardHeader}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: colors.surfaceAlt },
                ]}
              >
                <Text style={styles.cardIcon}>☁️</Text>
              </View>
              <View style={styles.cardTitleContainer}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Google Drive Cloud Sync
                </Text>
                <Text
                  style={[styles.cardSubtitle, { color: colors.textMuted }]}
                >
                  Automatically backup journal recordings and transcripts
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.statusPillRow,
                { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: googleUser
                      ? colors.success
                      : colors.textMuted,
                  },
                ]}
              />
              <Text
                style={[
                  styles.statusPillText,
                  { color: googleUser ? colors.text : colors.textMuted },
                ]}
                numberOfLines={1}
              >
                {googleUser
                  ? `Connected: ${googleUser.email}`
                  : "Not connected to cloud"}
              </Text>
            </View>

            <View style={styles.buttonRow}>
              {googleUser ? (
                <>
                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      {
                        backgroundColor: colors.primary,
                        flex: 1,
                      },
                    ]}
                    onPress={handleManualSync}
                    disabled={isSyncing}
                  >
                    {isSyncing ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text
                        style={[styles.secondaryButtonText, { color: "#FFF" }]}
                      >
                        Sync Now
                      </Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.outlineButton,
                      {
                        borderColor: colors.danger,
                        paddingHorizontal: 16,
                      },
                    ]}
                    onPress={handleGoogleSignOut}
                  >
                    <Text
                      style={[
                        styles.outlineButtonText,
                        { color: colors.danger },
                      ]}
                    >
                      Sign Out
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: colors.primary },
                  ]}
                  onPress={handleGoogleSignIn}
                  disabled={isSigningIn}
                  activeOpacity={0.8}
                >
                  {isSigningIn ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      Connect Google Account
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Section: Appearance */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.cardHeader}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: colors.surfaceAlt },
                ]}
              >
                <Text style={styles.cardIcon}>🎨</Text>
              </View>
              <View style={styles.cardTitleContainer}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Appearance
                </Text>
                <Text
                  style={[styles.cardSubtitle, { color: colors.textMuted }]}
                >
                  Choose app color theme
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.segmentedControl,
                { backgroundColor: colors.surfaceAlt },
              ]}
            >
              {(
                [
                  { key: "auto", label: "System" },
                  { key: "light", label: "Light" },
                  { key: "dark", label: "Dark" },
                ] as const
              ).map((item) => {
                const isSelected = mode === item.key;
                return (
                  <TouchableOpacity
                    key={item.key}
                    style={[
                      styles.segmentOption,
                      isSelected && [
                        styles.segmentOptionActive,
                        {
                          backgroundColor: colors.surface,
                          shadowColor: colors.text,
                        },
                      ],
                    ]}
                    onPress={() => setMode(item.key)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.segmentOptionText,
                        {
                          color: isSelected ? colors.primary : colors.textMuted,
                          fontWeight: isSelected ? "600" : "500",
                        },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Section: Storage & Local Cache */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.cardHeader}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: colors.surfaceAlt },
                ]}
              >
                <Text style={styles.cardIcon}>💾</Text>
              </View>
              <View style={styles.cardTitleContainer}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Storage & Offline Cache
                </Text>
                <Text
                  style={[styles.cardSubtitle, { color: colors.textMuted }]}
                >
                  Audio is stored locally for instant offline playback
                </Text>
              </View>
            </View>

            <View
              style={[styles.infoRow, { borderBottomColor: colors.border }]}
            >
              <Text style={[styles.infoLabel, { color: colors.textMuted }]}>
                Cached audio clips
              </Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {cachedClipsCount} file{cachedClipsCount === 1 ? "" : "s"}
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.outlineButton,
                { borderColor: colors.border, marginTop: 12 },
              ]}
              onPress={handleRunLruCleanup}
              disabled={isCleaningCache}
              activeOpacity={0.7}
            >
              {isCleaningCache ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text
                  style={[styles.outlineButtonText, { color: colors.text }]}
                >
                  Clear Cache
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* About / Version Info */}
          <View style={styles.aboutContainer}>
            <Text style={[styles.aboutTitle, { color: colors.text }]}>
              VoiceJournal
            </Text>
            <Text style={[styles.aboutVersion, { color: colors.textMuted }]}>
              Version 0.1.0
            </Text>
            <Text style={[styles.aboutSubtitle, { color: colors.textMuted }]}>
              Offline-first multimodal voice journal
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
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 54 : 18,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  closeButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  closeText: {
    fontSize: 16,
    fontWeight: "600",
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 48,
    gap: 16,
  },
  card: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 16,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  cardIcon: {
    fontSize: 18,
  },
  cardTitleContainer: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  statusPillRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 14,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  secondaryButton: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  outlineButton: {
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineButtonText: {
    fontSize: 13.5,
    fontWeight: "600",
  },
  segmentedControl: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 12,
  },
  segmentOption: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
  },
  segmentOptionActive: {
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentOptionText: {
    fontSize: 13,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: {
    fontSize: 13.5,
  },
  infoValue: {
    fontSize: 13.5,
    fontWeight: "600",
  },
  aboutContainer: {
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 24,
    gap: 4,
  },
  aboutTitle: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  aboutVersion: {
    fontSize: 12,
    fontWeight: "500",
  },
  aboutSubtitle: {
    fontSize: 12,
  },
});
