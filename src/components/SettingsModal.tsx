import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  StatusBar,
} from "react-native";
import { settingsDao } from "../db/dao/settingsDao";
import { googleDriveService } from "../services/drive/GoogleDriveService";
import { useTheme } from "../theme/ThemeContext";
import MaterialIcons from "@react-native-vector-icons/material-icons";
import { useToast } from "./common/Toast";
import { ConfirmDialog } from "./common/ConfirmDialog";
import { getAppVersion } from "../utils/versioning";

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
  const { showToast } = useToast();

  // Confirmation Dialog States
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmClearCache, setConfirmClearCache] = useState(false);

  // Google Sign-In state
  const [googleUser, setGoogleUser] = useState<{
    email: string;
    name: string | null;
  } | null>(() => googleDriveService.getCurrentUser());
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Storage & Cache stats
  const [storageStats, setStorageStats] = useState<{
    cachedCount: number;
    totalBytes: number;
    maxMb: number;
  }>({
    cachedCount: 0,
    totalBytes: 0,
    maxMb: 250,
  });
  const [isCleaningCache, setIsCleaningCache] = useState<boolean>(false);

  const refreshStatus = useCallback(async () => {
    try {
      const user = googleDriveService.getCurrentUser();
      setGoogleUser(user);

      const stats = await googleDriveService.getStorageStats();
      setStorageStats(stats);
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
      showToast({
        message: `Connected to Google Drive as ${user?.email || "user"}`,
        icon: "cloud-done",
        type: "success",
      });
    } catch (err) {
      showToast({
        message: (err as Error).message || "Google Sign-In failed",
        icon: "error-outline",
        type: "error",
      });
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleConfirmSignOut = async () => {
    setConfirmSignOut(false);
    try {
      await googleDriveService.signOut();
      setGoogleUser(null);
      showToast({
        message: "Disconnected from Google Drive",
        icon: "cloud-off",
        type: "info",
      });
    } catch (err) {
      showToast({
        message: (err as Error).message || "Sign out failed",
        icon: "error-outline",
        type: "error",
      });
    }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const result = await googleDriveService.syncTwoWay();
      await googleDriveService.runLruEviction();
      await refreshStatus();
      if (onSyncCompleted) {
        onSyncCompleted();
      }
      showToast({
        message: `Sync complete • ${result.uploadedCount} uploaded, ${result.downloadedCount} downloaded`,
        icon: "cloud-done",
        type: "success",
      });
    } catch (err) {
      showToast({
        message: (err as Error).message || "Failed to sync with Google Drive",
        icon: "error-outline",
        type: "error",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSelectStorageThreshold = async (mb: number) => {
    try {
      await settingsDao.setMaxStorageMb(mb);
      const evictionResult = await googleDriveService.runLruEviction();
      await refreshStatus();
      if (onSyncCompleted) {
        onSyncCompleted();
      }
      if (evictionResult.evictedCount > 0) {
        const freedMb = (evictionResult.freedBytes / (1024 * 1024)).toFixed(1);
        showToast({
          message: `Storage limit applied • ${evictionResult.evictedCount} files (${freedMb} MB) freed`,
          icon: "check-circle",
          type: "info",
        });
      }
    } catch (err) {
      showToast({
        message: (err as Error).message || "Failed to update storage settings",
        icon: "error-outline",
        type: "error",
      });
    }
  };

  const handleConfirmClearCache = async () => {
    setConfirmClearCache(false);
    setIsCleaningCache(true);
    try {
      const result = await googleDriveService.runLruEviction({
        forceClearAll: true,
      });
      await refreshStatus();
      if (onSyncCompleted) {
        onSyncCompleted();
      }
      const freedMb = (result.freedBytes / (1024 * 1024)).toFixed(1);
      showToast({
        message: `Cache cleared • ${result.evictedCount} file(s) (${freedMb} MB freed)`,
        icon: "check-circle",
        type: "success",
      });
    } catch (err) {
      showToast({
        message: (err as Error).message || "Failed to clear cache",
        icon: "error-outline",
        type: "error",
      });
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
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
                  { key: "auto", label: "System", icon: "brightness-auto" },
                  { key: "light", label: "Light", icon: "light-mode" },
                  { key: "dark", label: "Dark", icon: "dark-mode" },
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
                    <MaterialIcons
                      name={item.icon}
                      size={15}
                      color={isSelected ? colors.primary : colors.textMuted}
                      style={{ marginRight: 5 }}
                    />
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
                    key="sync-now-button"
                    style={[
                      styles.secondaryButton,
                      {
                        backgroundColor: colors.primary,
                      },
                    ]}
                    onPress={handleManualSync}
                    disabled={isSyncing}
                  >
                    {isSyncing ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <View style={styles.buttonContent}>
                        <MaterialIcons
                          name="sync"
                          size={18}
                          color="#FFF"
                          style={{ marginRight: 6 }}
                        />
                        <Text
                          style={[
                            styles.secondaryButtonText,
                            { color: "#FFF" },
                          ]}
                        >
                          Sync Now
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    key="sign-out-button"
                    style={[
                      styles.outlineButton,
                      {
                        borderColor: colors.danger,
                        paddingHorizontal: 16,
                      },
                    ]}
                    onPress={() => setConfirmSignOut(true)}
                  >
                    <View style={styles.buttonContent}>
                      <MaterialIcons
                        name="logout"
                        size={16}
                        color={colors.danger}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.outlineButtonText,
                          { color: colors.danger },
                        ]}
                      >
                        Sign Out
                      </Text>
                    </View>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  key="sign-in-button"
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
                    <View style={styles.buttonContent}>
                      <MaterialIcons
                        name="cloud-upload"
                        size={18}
                        color="#FFF"
                        style={{ marginRight: 8 }}
                      />
                      <Text style={styles.primaryButtonText}>
                        Connect Google Account
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}
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
                Cached audio storage
              </Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {(storageStats.totalBytes / (1024 * 1024)).toFixed(1)} MB (
                {storageStats.cachedCount} clip
                {storageStats.cachedCount === 1 ? "" : "s"})
              </Text>
            </View>

            {/* Threshold Selector */}
            <View style={{ marginTop: 14 }}>
              <Text
                style={[
                  styles.infoLabel,
                  { color: colors.text, fontWeight: "600", marginBottom: 4 },
                ]}
              >
                Max Audio Cache Threshold
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: colors.textMuted,
                  marginBottom: 10,
                  lineHeight: 16,
                }}
              >
                When cache exceeds this limit, least recently accessed audio is
                automatically deleted. Cloud copies in Google Drive remain safe.
              </Text>

              <View
                style={[
                  styles.segmentedControl,
                  { backgroundColor: colors.surfaceAlt },
                ]}
              >
                {[
                  { label: "100 MB", value: 100 },
                  { label: "250 MB", value: 250 },
                  { label: "500 MB", value: 500 },
                  { label: "1 GB", value: 1000 },
                  { label: "Unlimited", value: 0 },
                ].map((item) => {
                  const isSelected = storageStats.maxMb === item.value;
                  return (
                    <TouchableOpacity
                      key={item.label}
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
                      onPress={() => handleSelectStorageThreshold(item.value)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.segmentOptionText,
                          {
                            color: isSelected
                              ? colors.primary
                              : colors.textMuted,
                            fontWeight: isSelected ? "600" : "500",
                            fontSize: 11.5,
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

            <TouchableOpacity
              style={[
                styles.outlineButton,
                { borderColor: colors.border, marginTop: 16 },
              ]}
              onPress={() => setConfirmClearCache(true)}
              disabled={isCleaningCache || storageStats.cachedCount === 0}
              activeOpacity={0.7}
            >
              {isCleaningCache ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <View style={styles.buttonContent}>
                  <MaterialIcons
                    name="delete-sweep"
                    size={18}
                    color={
                      storageStats.cachedCount === 0
                        ? colors.textMuted
                        : colors.text
                    }
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.outlineButtonText,
                      {
                        color:
                          storageStats.cachedCount === 0
                            ? colors.textMuted
                            : colors.text,
                      },
                    ]}
                  >
                    {storageStats.cachedCount === 0
                      ? "Cache is Clean"
                      : `Clear Local Cache (${(
                          storageStats.totalBytes /
                          (1024 * 1024)
                        ).toFixed(1)} MB)`}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* About / Version Info */}
          <View style={styles.aboutContainer}>
            <Text style={[styles.aboutTitle, { color: colors.text }]}>
              VoiceJournal
            </Text>
            <Text style={[styles.aboutVersion, { color: colors.textMuted }]}>
              Version {getAppVersion()}
            </Text>
            <Text style={[styles.aboutSubtitle, { color: colors.textMuted }]}>
              Offline-first multimodal voice journal
            </Text>
          </View>
        </ScrollView>

        {/* Sign Out Confirmation Dialog */}
        <ConfirmDialog
          visible={confirmSignOut}
          title="Sign Out from Google Drive"
          message="Disconnect your Google Drive account? Local recordings will remain safe on this device, but automatic cloud backup will be paused."
          confirmLabel="Sign Out"
          cancelLabel="Cancel"
          isDestructive
          onConfirm={handleConfirmSignOut}
          onCancel={() => setConfirmSignOut(false)}
        />

        {/* Clear Cache Confirmation Dialog */}
        <ConfirmDialog
          visible={confirmClearCache}
          title="Clear Local Audio Cache"
          message={`Remove ${storageStats.cachedCount} cached audio file(s) (${(
            storageStats.totalBytes /
            (1024 * 1024)
          ).toFixed(
            1,
          )} MB)? All cloud backups remain safe in Google Drive and can be streamed or re-downloaded at any time.`}
          confirmLabel="Clear Cache"
          cancelLabel="Cancel"
          icon="cleaning-services"
          onConfirm={handleConfirmClearCache}
          onCancel={() => setConfirmClearCache(false)}
        />
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
    paddingTop:
      Platform.OS === "android" ? (StatusBar.currentHeight || 24) + 12 : 54,
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
  scrollView: {
    flex: 1,
    width: "100%",
  },
  scrollContent: {
    width: "100%",
    padding: 18,
    paddingBottom: 48,
    gap: 16,
  },
  card: {
    width: "100%",
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
    alignItems: "center",
    width: "100%",
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
    flex: 1,
    minWidth: 0,
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
    flexShrink: 0,
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
    flexDirection: "row",
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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
