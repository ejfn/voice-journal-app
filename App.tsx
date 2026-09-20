import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  StatusBar,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { File } from "expo-file-system";
import { DayGroupHeader } from "./src/components/DayGroupHeader";
import { EntryCard } from "./src/components/EntryCard";
import { MonthSectionHeader } from "./src/components/MonthSectionHeader";
import { RecordingModal } from "./src/components/RecordingModal";
import { ReviewModal } from "./src/components/ReviewModal";
import { SettingsModal } from "./src/components/SettingsModal";
import { TagFilterChips } from "./src/components/TagFilterChips";
import { TimelineHeader } from "./src/components/TimelineHeader";
import { DayGroup, entriesDao, MonthSection } from "./src/db/dao/entriesDao";
import { deletedEntriesDao } from "./src/db/dao/deletedEntriesDao";
import { initDatabase } from "./src/db/database";
import { JournalEntry } from "./src/db/schema";
import { geminiService } from "./src/services/ai/GeminiService";
import { transcriptionQueueService } from "./src/services/ai/TranscriptionQueueService";
import { audioImportService } from "./src/services/audio/AudioImportService";
import { audioPlaybackService } from "./src/services/audio/AudioPlaybackService";
import { audioRecordingService } from "./src/services/audio/AudioRecordingService";
import { googleDriveService } from "./src/services/drive/GoogleDriveService";
import { uploadQueueService } from "./src/services/drive/UploadQueueService";
import { smartSyncService } from "./src/services/drive/SmartSyncService";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { generateUUID } from "./src/utils/uuid";
import { isEntryActivelyTransferring } from "./src/utils/storageStatus";
import MaterialIcons from "@react-native-vector-icons/material-icons";
import { ToastProvider, useToast } from "./src/components/common/Toast";
import { ConfirmDialog } from "./src/components/common/ConfirmDialog";

const MainScreen: React.FC = () => {
  const { colors, isDark } = useTheme();
  const { showToast } = useToast();

  const [sections, setSections] = useState<MonthSection[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // Recording Modal State
  const [isRecordingVisible, setIsRecordingVisible] = useState<boolean>(false);
  const [recordingDurationSec, setRecordingDurationSec] = useState<number>(0);
  const [recordingDurationMillis, setRecordingDurationMillis] =
    useState<number>(0);
  const [recordingMetering, setRecordingMetering] = useState<number>(0);
  const [isRecordingPaused, setIsRecordingPaused] = useState<boolean>(false);
  const [isProcessingAI, setIsProcessingAI] = useState<boolean>(false);
  const [currentRecordingId, setCurrentRecordingId] = useState<string | null>(
    null,
  );

  // Review Modal State
  const [reviewEntry, setReviewEntry] = useState<JournalEntry | null>(null);
  const [isReviewVisible, setIsReviewVisible] = useState<boolean>(false);

  // Settings Modal State
  const [isSettingsVisible, setIsSettingsVisible] = useState<boolean>(false);

  // Playback State
  const [playingEntryId, setPlayingEntryId] = useState<string | null>(null);
  const [downloadingEntryIds, setDownloadingEntryIds] = useState<Set<string>>(
    new Set(),
  );
  const [uploadingEntryIds, setUploadingEntryIds] = useState<Set<string>>(
    new Set(),
  );
  const uploadingTransferCountRef = useRef<Map<string, number>>(new Map());
  const downloadingTransferCountRef = useRef<Map<string, number>>(new Map());
  const pendingDownloadRequestsRef = useRef<Set<string>>(new Set());

  const incrementUploadingEntry = useCallback((entryId: string) => {
    const currentCount = uploadingTransferCountRef.current.get(entryId) ?? 0;
    uploadingTransferCountRef.current.set(entryId, currentCount + 1);
    setUploadingEntryIds((prev) => new Set(prev).add(entryId));
  }, []);

  const decrementUploadingEntry = useCallback((entryId: string) => {
    const currentCount = uploadingTransferCountRef.current.get(entryId) ?? 0;
    const nextCount = currentCount - 1;
    if (nextCount <= 0) {
      uploadingTransferCountRef.current.delete(entryId);
      setUploadingEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
      return;
    }
    uploadingTransferCountRef.current.set(entryId, nextCount);
  }, []);

  const incrementDownloadingEntry = useCallback((entryId: string) => {
    const currentCount = downloadingTransferCountRef.current.get(entryId) ?? 0;
    downloadingTransferCountRef.current.set(entryId, currentCount + 1);
    setDownloadingEntryIds((prev) => new Set(prev).add(entryId));
  }, []);

  const decrementDownloadingEntry = useCallback((entryId: string) => {
    const currentCount = downloadingTransferCountRef.current.get(entryId) ?? 0;
    const nextCount = currentCount - 1;
    if (nextCount <= 0) {
      downloadingTransferCountRef.current.delete(entryId);
      setDownloadingEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
      return;
    }
    downloadingTransferCountRef.current.set(entryId, nextCount);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const grouped = await entriesDao.getGroupedTimelineEntries({
        query: searchQuery,
        tag: selectedTag === "all" ? undefined : selectedTag,
      });
      setSections(grouped);

      const allTags = await entriesDao.getAllTags();
      setTags(allTags);
    } catch (err) {
      console.warn("Error loading timeline data:", err);
    }
  }, [searchQuery, selectedTag]);

  useEffect(() => {
    initDatabase()
      .then(() => {
        loadData();
        transcriptionQueueService.processQueue().catch((err) => {
          console.warn("Transcription queue startup error:", err);
        });
        smartSyncService.startAutoSync();
      })
      .catch((err) => console.warn("Database init error:", err));

    return () => {
      smartSyncService.stopAutoSync();
    };
  }, [loadData]);

  useEffect(() => {
    const unsubscribePlayback = audioPlaybackService.addListener((state) => {
      setPlayingEntryId(state.isPlaying ? state.entryId : null);
    });
    const unsubscribeTranscription = transcriptionQueueService.addListener(
      () => {
        loadData();
      },
    );
    const unsubscribeDriveTransfer = googleDriveService.addTransferListener(
      (event) => {
        if (event.status === "uploading") {
          incrementUploadingEntry(event.entryId);
          return;
        }
        if (event.status === "downloading") {
          incrementDownloadingEntry(event.entryId);
          return;
        }

        if (event.direction === "upload") {
          decrementUploadingEntry(event.entryId);
        } else {
          decrementDownloadingEntry(event.entryId);
        }

        loadData();
      },
    );
    // SmartSync "syncing" is a top-level reconciliation/scan status and must
    // NOT drive per-entry storage badges. Only refresh data when sync finishes.
    const unsubscribeSmartSync = smartSyncService.addListener((event) => {
      if (event.status === "synced") {
        loadData();
      }
    });

    return () => {
      unsubscribePlayback();
      unsubscribeTranscription();
      unsubscribeDriveTransfer();
      unsubscribeSmartSync();
    };
  }, [
    decrementDownloadingEntry,
    decrementUploadingEntry,
    incrementDownloadingEntry,
    incrementUploadingEntry,
    loadData,
  ]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    transcriptionQueueService.processQueue().catch((err) => {
      console.warn("Queue refresh error:", err);
    });
    smartSyncService
      .sync({ force: true, reason: "pull_refresh" })
      .catch((err) => {
        console.warn("Smart sync error on pull refresh:", err);
      });
    setIsRefreshing(false);
  };

  // Start Voice Recording
  const handleStartRecording = async () => {
    // Ensure any ongoing playback is stopped before starting a new recording
    await audioPlaybackService.stop();

    const hasPermission = await audioRecordingService.requestPermissions();
    if (!hasPermission) {
      showToast({
        message: "Microphone access is needed to record voice entries",
        icon: "mic-off",
        type: "warning",
      });
      return;
    }

    const newId = generateUUID();
    setCurrentRecordingId(newId);
    setRecordingDurationSec(0);
    setRecordingDurationMillis(0);
    setRecordingMetering(0);
    setIsRecordingPaused(false);
    setIsProcessingAI(false);
    setIsRecordingVisible(true);

    await audioRecordingService.startRecording(newId, (status) => {
      setRecordingDurationSec(Math.floor(status.durationMillis / 1000));
      setRecordingDurationMillis(status.durationMillis);
      setRecordingMetering(status.meteringLevel);
      setIsRecordingPaused(status.isPaused);
    });
  };

  const handlePauseRecording = async () => {
    await audioRecordingService.pauseRecording();
  };

  const handleResumeRecording = async () => {
    await audioRecordingService.resumeRecording();
  };

  const handleCancelRecording = async () => {
    await audioRecordingService.cancelRecording();
    setIsRecordingVisible(false);
    setCurrentRecordingId(null);
  };

  const handleStopRecording = async () => {
    try {
      const { localUri, durationSec } =
        await audioRecordingService.stopRecording();

      // Enforce 3-second minimum duration threshold
      if (durationSec < 3) {
        if (localUri) {
          try {
            const shortFile = new File(localUri);
            if (shortFile.exists) {
              shortFile.delete();
            }
          } catch (delErr) {
            console.warn("Could not delete short recording:", delErr);
          }
        }
        setIsRecordingVisible(false);
        setCurrentRecordingId(null);
        setIsProcessingAI(false);
        showToast({
          message: "Recording under 3 seconds was not saved",
          icon: "info-outline",
          type: "warning",
        });
        return;
      }

      const entryId = currentRecordingId || generateUUID();
      const now = Date.now();
      const hasKey = await geminiService.hasKeyConfigured();

      const newEntry: JournalEntry = {
        id: entryId,
        title: "Voice Recording",
        summary: hasKey
          ? "Queued for AI transcription..."
          : "Add Gemini API key in Settings to transcribe",
        transcript: "",
        tags: ["voice"],
        duration_sec: durationSec,
        source_type: "recorded",
        local_audio_path: localUri,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: now,
        updated_at: now,
        last_accessed_at: now,
        transcription_status: "queued",
      };

      await entriesDao.insertEntry(newEntry);

      // Enqueue for background Google Drive upload
      uploadQueueService.enqueueUpload(newEntry.id, "ANALYZE_AND_UPLOAD");

      // Dismiss recording modal immediately so user can continue using the app
      setIsRecordingVisible(false);
      setCurrentRecordingId(null);
      setIsProcessingAI(false);

      if (hasKey) {
        showToast({
          message: "Recording saved • Transcribing in background",
          icon: "check-circle",
          type: "success",
        });
        // Process transcription in background queue
        transcriptionQueueService.processQueue().catch((err) => {
          console.warn("Background transcription error:", err);
        });
      } else {
        showToast({
          message:
            "Recording saved • Add Gemini API key in Settings to transcribe",
          icon: "info-outline",
          type: "warning",
        });
      }

      await loadData();
    } catch (err) {
      setIsProcessingAI(false);
      setIsRecordingVisible(false);
      showToast({
        message: (err as Error).message || "Failed to save recording.",
        icon: "error-outline",
        type: "error",
      });
    }
  };

  // Import Audio Files
  const handleImportAudio = async () => {
    try {
      const imported = await audioImportService.importAudioFiles();
      if (imported.length > 0) {
        await loadData();
        showToast({
          message: `Imported ${imported.length} audio file(s) • Transcribing in background`,
          icon: "check-circle",
          type: "success",
        });
        transcriptionQueueService.processQueue().catch((err) => {
          console.warn("Background import transcription error:", err);
        });
      }
    } catch (err) {
      showToast({
        message: (err as Error).message || "Failed to import audio.",
        icon: "error-outline",
        type: "error",
      });
    }
  };

  // Play / Pause entry audio
  const handlePlayClip = async (entry: JournalEntry) => {
    if (pendingDownloadRequestsRef.current.has(entry.id)) {
      return;
    }

    let startedDownloadRequest = false;

    if (playingEntryId === entry.id) {
      await audioPlaybackService.pause();
      return;
    }

    try {
      const localPath = entry.local_audio_path;
      let isCached = entry.is_audio_cached === 1 && Boolean(localPath);

      if (isCached && localPath) {
        try {
          const file = new File(localPath);
          if (!file.exists) {
            isCached = false;
          }
        } catch {
          isCached = false;
        }
      }

      if (isCached && localPath) {
        await audioPlaybackService.play(
          entry.id,
          localPath,
          entry.duration_sec,
        );
        await entriesDao.markAudioAccessed(entry.id);
      } else if (entry.drive_audio_file_id) {
        pendingDownloadRequestsRef.current.add(entry.id);
        startedDownloadRequest = true;
        showToast({
          message: "Downloading audio from Google Drive...",
          icon: "cloud-download",
          type: "info",
        });

        const cachedPath = await googleDriveService.downloadAudioOnDemand(
          entry.id,
        );
        await loadData();
        await audioPlaybackService.play(
          entry.id,
          cachedPath,
          entry.duration_sec,
        );
      } else {
        showToast({
          message: "Audio file is not available.",
          icon: "error-outline",
          type: "error",
        });
      }
    } catch (err) {
      showToast({
        message: (err as Error).message || "Could not play audio.",
        icon: "error-outline",
        type: "error",
      });
    } finally {
      if (startedDownloadRequest) {
        pendingDownloadRequestsRef.current.delete(entry.id);
      }
    }
  };

  const handleOpenReview = (entry: JournalEntry) => {
    setReviewEntry(entry);
    setIsReviewVisible(true);
  };

  const handleSaveReview = async (updated: JournalEntry) => {
    const entryToSave: JournalEntry = {
      ...updated,
      updated_at: Date.now(),
    };
    await entriesDao.updateEntry(entryToSave);
    setIsReviewVisible(false);
    setReviewEntry(null);
    await loadData();

    // Trigger background upload if signed in to Google Drive
    uploadQueueService.enqueueUpload(entryToSave.id, "METADATA_ONLY");
  };

  const handleDeleteEntry = (id: string) => {
    setDeleteTargetId(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    const id = deleteTargetId;
    setDeleteTargetId(null);
    const deleted = await entriesDao.deleteEntry(id);
    setIsReviewVisible(false);
    setReviewEntry(null);
    await loadData();
    showToast({
      message: "Entry permanently deleted",
      icon: "delete-outline",
      type: "info",
    });

    // If user is connected to Google Drive, delete from cloud immediately
    if (deleted && googleDriveService.getCurrentUser()) {
      googleDriveService
        .deleteEntryFromDrive(deleted)
        .then(async () => {
          await deletedEntriesDao.removeDeletion(deleted.id);
        })
        .catch((err) => {
          console.warn("Deferred cloud deletion:", err);
        });
    }
  };

  // Transform MonthSection into SectionList data structure
  // Each section in SectionList corresponds to a Month
  // Inside each month section, we render DayGroups with their respective clips
  const sectionListData = sections.map((sec) => ({
    monthLabel: sec.monthLabel,
    monthKey: sec.monthKey,
    data: sec.dayGroups,
  }));

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[
        styles.safeArea,
        {
          backgroundColor: colors.surface,
        },
      ]}
    >
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor={colors.surface}
      />
      <View
        style={[
          styles.responsiveContainer,
          { backgroundColor: colors.background },
        ]}
      >
        <TimelineHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSettingsPress={() => setIsSettingsVisible(true)}
        />

        <TagFilterChips
          tags={tags}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
        />

        <SectionList
          sections={sectionListData}
          keyExtractor={(item: DayGroup) => item.dayKey}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          renderSectionHeader={({ section: { monthLabel } }) => (
            <MonthSectionHeader monthLabel={monthLabel} />
          )}
          renderItem={({ item: dayGroup }) => (
            <View style={styles.dayGroupWrapper}>
              <DayGroupHeader
                dayLabel={dayGroup.dayLabel}
                clipCount={dayGroup.clips.length}
              />
              {dayGroup.clips.map((clip) => (
                <EntryCard
                  key={clip.id}
                  entry={clip}
                  isPlaying={playingEntryId === clip.id}
                  isDownloading={downloadingEntryIds.has(clip.id)}
                  isItemSyncing={isEntryActivelyTransferring(clip.id, {
                    uploadingEntryIds,
                    downloadingEntryIds,
                  })}
                  onPlayPress={() => handlePlayClip(clip)}
                  onPress={() => handleOpenReview(clip)}
                  onRetryTranscription={(id) =>
                    transcriptionQueueService.retryEntry(id)
                  }
                />
              ))}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View
                style={[
                  styles.emptyIconCircle,
                  { backgroundColor: colors.surfaceAlt },
                ]}
              >
                <MaterialIcons
                  name="mic-none"
                  size={32}
                  color={colors.textMuted}
                />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {searchQuery || selectedTag !== "all"
                  ? "No matching entries"
                  : "No journal entries yet"}
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                {searchQuery || selectedTag !== "all"
                  ? "Try adjusting your search terms or filter."
                  : "Tap Record below to start your personal voice diary."}
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
        />

        {/* Floating Action Buttons Container (Vertical Circular FABs) */}
        <View style={styles.fabContainer}>
          {/* Top: Import Audio */}
          <TouchableOpacity
            style={[
              styles.secondaryFab,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            onPress={handleImportAudio}
            activeOpacity={0.8}
            accessibilityLabel="Import Audio Files"
          >
            <MaterialIcons name="file-download" size={22} color={colors.text} />
          </TouchableOpacity>

          {/* Bottom: Record Voice */}
          <TouchableOpacity
            style={[
              styles.primaryFab,
              {
                backgroundColor: colors.danger,
                shadowColor: colors.danger,
              },
            ]}
            onPress={handleStartRecording}
            activeOpacity={0.85}
            accessibilityLabel="New Voice Recording"
          >
            <MaterialIcons name="mic" size={28} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Active Recording Modal */}
        <RecordingModal
          visible={isRecordingVisible}
          durationSec={recordingDurationSec}
          durationMillis={recordingDurationMillis}
          meteringLevel={recordingMetering}
          isPaused={isRecordingPaused}
          isProcessing={isProcessingAI}
          onPause={handlePauseRecording}
          onResume={handleResumeRecording}
          onStop={handleStopRecording}
          onCancel={handleCancelRecording}
        />

        {/* Review & Details Modal */}
        <ReviewModal
          visible={isReviewVisible}
          entry={reviewEntry}
          onSave={handleSaveReview}
          onDelete={handleDeleteEntry}
          onClose={async () => {
            setIsReviewVisible(false);
            setReviewEntry(null);
            await loadData();
          }}
          onRetryTranscription={(id) =>
            transcriptionQueueService.retryEntry(id)
          }
        />

        {/* Settings & Sync Modal */}
        <SettingsModal
          visible={isSettingsVisible}
          onClose={() => setIsSettingsVisible(false)}
          onSyncCompleted={loadData}
        />

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          visible={deleteTargetId !== null}
          title="Delete Entry"
          message="Are you sure you want to permanently delete this voice journal entry? This action cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          isDestructive
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTargetId(null)}
        />
      </View>
    </SafeAreaView>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <MainScreen />
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  responsiveContainer: {
    flex: 1,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  listContent: {
    paddingBottom: 120, // Generous padding so floating buttons never cover list items
  },
  dayGroupWrapper: {
    marginBottom: 8,
  },
  emptyContainer: {
    paddingVertical: 90,
    alignItems: "center",
    paddingHorizontal: 36,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
  },
  fabContainer: {
    position: "absolute",
    bottom: 28,
    right: 20,
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
  },
  secondaryFab: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  primaryFab: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
});
