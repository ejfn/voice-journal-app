import React, { useState, useEffect, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import MaterialIcons from "@react-native-vector-icons/material-icons";
import { useTheme } from "../theme/ThemeContext";
import { useToast } from "./common/Toast";
import { ConfirmDialog } from "./common/ConfirmDialog";
import { modalStyles } from "./common/modalStyles";
import { entriesDao } from "../db/dao/entriesDao";
import { uploadQueueService } from "../services/drive/UploadQueueService";
import { googleDriveService } from "../services/drive/GoogleDriveService";
import { formatDuration, formatTime, formatDayLabel } from "../utils/paths";
import { formatBinCountdown } from "../utils/binUtils";
import { JournalEntry } from "../db/schema";

interface BinModalProps {
  visible: boolean;
  onClose: () => void;
  onEntryRestored?: (entry: JournalEntry) => void;
  onEntryPermanentlyDeleted?: (id: string) => void;
  onBinEmptied?: () => void;
}

export const BinModal: React.FC<BinModalProps> = ({
  visible,
  onClose,
  onEntryRestored,
  onEntryPermanentlyDeleted,
  onBinEmptied,
}) => {
  const { colors } = useTheme();
  const { showToast } = useToast();

  const [binnedEntries, setBinnedEntries] = useState<JournalEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [confirmEmptyBin, setConfirmEmptyBin] = useState<boolean>(false);
  const [entryToDelete, setEntryToDelete] = useState<JournalEntry | null>(null);

  const loadBinnedEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      // Auto-purge entries that crossed the retention window while the app
      // stayed in memory (startup and sync purges may not have run recently)
      await entriesDao.purgeExpiredBinnedEntries();
      const items = await entriesDao.getBinnedEntries();
      setBinnedEntries(items);
    } catch (err) {
      console.warn("Failed to load binned entries:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      void loadBinnedEntries();
    }
  }, [visible, loadBinnedEntries]);

  const handleRestore = async (entry: JournalEntry) => {
    try {
      const restored = await entriesDao.restoreEntry(entry.id);
      if (
        restored?.drive_sidecar_file_id &&
        googleDriveService.getCurrentUser()
      ) {
        uploadQueueService
          .enqueueUpload(entry.id, "METADATA_ONLY")
          .catch((err) => {
            console.warn("Failed to enqueue upload:", err);
          });
      }
      showToast({
        message: "Entry restored",
        icon: "restore",
        type: "success",
      });
      await loadBinnedEntries();
      onEntryRestored?.(entry);
    } catch (err) {
      showToast({
        message: (err as Error).message || "Failed to restore entry",
        icon: "error-outline",
        type: "error",
      });
    }
  };

  const handleConfirmDeleteForever = async () => {
    if (!entryToDelete) return;
    const target = entryToDelete;
    setEntryToDelete(null);
    try {
      await entriesDao.permanentlyDeleteEntry(target.id);
      showToast({
        message: "Entry permanently deleted",
        icon: "delete-forever",
        type: "info",
      });
      await loadBinnedEntries();
      onEntryPermanentlyDeleted?.(target.id);
    } catch (err) {
      showToast({
        message: (err as Error).message || "Failed to delete entry",
        icon: "error-outline",
        type: "error",
      });
    }
  };

  const handleConfirmEmptyBin = async () => {
    setConfirmEmptyBin(false);
    try {
      await entriesDao.emptyBin();
      // emptyBin skips individual failures; report an accurate result
      const remainingCount = await entriesDao.getBinnedEntryCount();
      if (remainingCount > 0) {
        showToast({
          message: `Failed to delete ${remainingCount} item${remainingCount === 1 ? "" : "s"}`,
          icon: "error-outline",
          type: "error",
        });
      } else {
        showToast({
          message: "Recycle Bin emptied",
          icon: "delete-forever",
          type: "info",
        });
      }
      await loadBinnedEntries();
      onBinEmptied?.();
    } catch (err) {
      showToast({
        message: (err as Error).message || "Failed to empty Recycle Bin",
        icon: "error-outline",
        type: "error",
      });
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View
          style={[
            modalStyles.modalHeader,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.headerLeft}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Recycle Bin
            </Text>
            {binnedEntries.length > 0 && (
              <Text style={[styles.headerCount, { color: colors.textMuted }]}>
                {binnedEntries.length} item
                {binnedEntries.length === 1 ? "" : "s"}
              </Text>
            )}
          </View>

          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Done"
          >
            <Text style={[styles.closeText, { color: colors.primary }]}>
              Done
            </Text>
          </TouchableOpacity>
        </View>

        {/* Info Banner & Empty Action */}
        <View
          style={[
            styles.bannerContainer,
            {
              backgroundColor: colors.surfaceAlt,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.bannerTextContainer}>
            <MaterialIcons
              name="info-outline"
              size={16}
              color={colors.textMuted}
              style={{ marginRight: 6, marginTop: 1 }}
            />
            <Text style={[styles.bannerText, { color: colors.textMuted }]}>
              Items in the Bin are automatically purged after 30 days.
            </Text>
          </View>

          {binnedEntries.length > 0 && (
            <TouchableOpacity
              style={[
                styles.emptyBinButton,
                {
                  borderColor: colors.danger,
                  backgroundColor: colors.surface,
                },
              ]}
              onPress={() => setConfirmEmptyBin(true)}
              activeOpacity={0.7}
              accessibilityLabel="Empty Recycle Bin"
            >
              <MaterialIcons
                name="delete-sweep"
                size={16}
                color={colors.danger}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.emptyBinText, { color: colors.danger }]}>
                Empty Bin
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Content */}
        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : binnedEntries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View
              style={[
                styles.emptyIconCircle,
                { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <MaterialIcons
                name="delete-outline"
                size={44}
                color={colors.textMuted}
              />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              Recycle Bin is Empty
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
              Deleted recordings will be kept here for 30 days before being
              permanently removed.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {binnedEntries.map((entry) => {
              const countdownText = formatBinCountdown(entry.deleted_at);
              const recordedDateStr = formatDayLabel(
                new Date(entry.created_at),
              );
              const recordedTimeStr = formatTime(entry.created_at);

              return (
                <View
                  key={entry.id}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.cardHeader}>
                    <Text
                      style={[styles.entryTitle, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {entry.title || "Untitled Recording"}
                    </Text>
                    <View
                      style={[
                        styles.countdownBadge,
                        { backgroundColor: colors.surfaceAlt },
                      ]}
                    >
                      <MaterialIcons
                        name="schedule"
                        size={12}
                        color={colors.textMuted}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.countdownText,
                          { color: colors.textMuted },
                        ]}
                      >
                        {countdownText}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.cardMetaRow}>
                    <Text
                      style={[styles.entryMeta, { color: colors.textMuted }]}
                    >
                      {recordedDateStr} • {recordedTimeStr} •{" "}
                      {formatDuration(entry.duration_sec)}
                    </Text>
                  </View>

                  {entry.summary ? (
                    <Text
                      style={[styles.entrySummary, { color: colors.textMuted }]}
                      numberOfLines={2}
                    >
                      {entry.summary}
                    </Text>
                  ) : null}

                  {/* Actions */}
                  <View
                    style={[
                      styles.actionRow,
                      { borderTopColor: colors.border },
                    ]}
                  >
                    <TouchableOpacity
                      style={[
                        styles.restoreButton,
                        {
                          backgroundColor: colors.surfaceAlt,
                          borderColor: colors.border,
                        },
                      ]}
                      onPress={() => handleRestore(entry)}
                      activeOpacity={0.7}
                      accessibilityLabel="Restore entry"
                    >
                      <MaterialIcons
                        name="restore"
                        size={16}
                        color={colors.primary}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[styles.restoreText, { color: colors.primary }]}
                      >
                        Restore
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.deleteForeverButton,
                        {
                          backgroundColor: colors.surfaceAlt,
                          borderColor: colors.border,
                        },
                      ]}
                      onPress={() => setEntryToDelete(entry)}
                      activeOpacity={0.7}
                      accessibilityLabel="Delete forever"
                    >
                      <MaterialIcons
                        name="delete-forever"
                        size={16}
                        color={colors.danger}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.deleteForeverText,
                          { color: colors.danger },
                        ]}
                      >
                        Delete Forever
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Empty Bin Confirmation Dialog */}
        <ConfirmDialog
          visible={confirmEmptyBin}
          title="Empty Recycle Bin"
          message={`Permanently delete all ${binnedEntries.length} item${binnedEntries.length === 1 ? "" : "s"} in the Recycle Bin? This action cannot be undone.`}
          confirmLabel="Empty Bin"
          cancelLabel="Cancel"
          isDestructive
          icon="delete-sweep"
          onConfirm={handleConfirmEmptyBin}
          onCancel={() => setConfirmEmptyBin(false)}
        />

        {/* Delete Forever Confirmation Dialog */}
        <ConfirmDialog
          visible={entryToDelete !== null}
          title="Delete Forever"
          message={`Permanently delete "${entryToDelete?.title || "Untitled Recording"}"? Audio file and metadata will be permanently removed.`}
          confirmLabel="Delete Forever"
          cancelLabel="Cancel"
          isDestructive
          icon="delete-forever"
          onConfirm={handleConfirmDeleteForever}
          onCancel={() => setEntryToDelete(null)}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  headerCount: {
    fontSize: 14,
    fontWeight: "500",
  },
  closeButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  closeText: {
    fontSize: 16,
    fontWeight: "600",
  },
  bannerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  bannerTextContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  bannerText: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  emptyBinButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  emptyBinText: {
    fontSize: 12.5,
    fontWeight: "600",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 36,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 36,
    gap: 12,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  entryTitle: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  countdownBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  countdownText: {
    fontSize: 11.5,
    fontWeight: "500",
  },
  cardMetaRow: {
    marginBottom: 8,
  },
  entryMeta: {
    fontSize: 12.5,
  },
  entrySummary: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  restoreButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  restoreText: {
    fontSize: 13,
    fontWeight: "600",
  },
  deleteForeverButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  deleteForeverText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
