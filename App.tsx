import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  StatusBar,
  Alert,
  Platform,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
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
import { syncQueueDao } from "./src/db/dao/syncQueueDao";
import { initDatabase } from "./src/db/database";
import { JournalEntry } from "./src/db/schema";
import { geminiService } from "./src/services/ai/GeminiService";
import { audioImportService } from "./src/services/audio/AudioImportService";
import { audioPlaybackService } from "./src/services/audio/AudioPlaybackService";
import { audioRecordingService } from "./src/services/audio/AudioRecordingService";
import { googleDriveService } from "./src/services/drive/GoogleDriveService";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { generateUUID } from "./src/utils/uuid";
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
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // Recording Modal State
  const [isRecordingVisible, setIsRecordingVisible] = useState<boolean>(false);
  const [recordingDurationSec, setRecordingDurationSec] = useState<number>(0);
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
      .then(() => loadData())
      .catch((err) => console.warn("Database init error:", err));
  }, [loadData]);

  useEffect(() => {
    const unsubscribe = audioPlaybackService.addListener((state) => {
      setPlayingEntryId(state.isPlaying ? state.entryId : null);
    });
    return unsubscribe;
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleDriveSync = async () => {
    setIsSyncing(true);
    try {
      const result = await googleDriveService.syncTwoWay();
      await googleDriveService.runLruEviction();
      await loadData();
      Alert.alert(
        "Sync Complete",
        `Synchronized timeline.\n• ${result.uploadedCount} clip(s) uploaded to Drive\n• ${result.downloadedCount} new clip(s) downloaded`,
      );
    } catch (err) {
      Alert.alert(
        "Drive Sync Notice",
        (err as Error).message || "Could not sync with Google Drive.",
      );
    } finally {
      setIsSyncing(false);
    }
  };

  // Start Voice Recording
  const handleStartRecording = async () => {
    const hasPermission = await audioRecordingService.requestPermissions();
    if (!hasPermission) {
      Alert.alert(
        "Permission Required",
        "Microphone access is needed to record voice journal entries.",
      );
      return;
    }

    const newId = generateUUID();
    setCurrentRecordingId(newId);
    setRecordingDurationSec(0);
    setRecordingMetering(0);
    setIsRecordingPaused(false);
    setIsProcessingAI(false);
    setIsRecordingVisible(true);

    await audioRecordingService.startRecording(newId, (status) => {
      setRecordingDurationSec(Math.floor(status.durationMillis / 1000));
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
            await FileSystem.deleteAsync(localUri, { idempotent: true });
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

      setIsProcessingAI(true);
      const entryId = currentRecordingId || generateUUID();
      const now = Date.now();

      let aiResult = {
        title: "Voice Journal Entry",
        transcript: "Recorded speech",
        tags: ["journal"],
        summary: "Recorded voice entry.",
      };

      try {
        aiResult = await geminiService.analyzeAudio(localUri);
      } catch (aiErr) {
        console.warn("Gemini analysis skipped/failed:", aiErr);
      }

      const newEntry: JournalEntry = {
        id: entryId,
        title: aiResult.title,
        summary: aiResult.summary,
        transcript: aiResult.transcript,
        tags: aiResult.tags,
        duration_sec: durationSec,
        source_type: "recorded",
        local_audio_path: localUri,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: now,
        updated_at: now,
        last_accessed_at: now,
      };

      await entriesDao.insertEntry(newEntry);
      await syncQueueDao.enqueue({
        entry_id: entryId,
        action: "ANALYZE_AND_UPLOAD",
      });

      // Attempt background upload if user is signed in to Google Drive
      if (googleDriveService.getCurrentUser()) {
        googleDriveService
          .uploadEntry(newEntry)
          .then(async () => {
            await syncQueueDao.deleteByEntryId(entryId);
          })
          .catch((uploadErr) => {
            console.warn("Deferred background Drive upload:", uploadErr);
          });
      }

      setIsRecordingVisible(false);
      setCurrentRecordingId(null);
      setIsProcessingAI(false);

      await loadData();

      // Open review modal
      setReviewEntry(newEntry);
      setIsReviewVisible(true);
    } catch (err) {
      setIsProcessingAI(false);
      setIsRecordingVisible(false);
      Alert.alert(
        "Recording Error",
        (err as Error).message || "Failed to save recording.",
      );
    }
  };

  // Import Audio Files
  const handleImportAudio = async () => {
    try {
      const imported = await audioImportService.importAudioFiles();
      if (imported.length > 0) {
        await loadData();
        Alert.alert(
          "Import Complete",
          `Imported ${imported.length} audio file(s). Enqueued for AI transcription and Drive sync.`,
        );
      }
    } catch (err) {
      Alert.alert(
        "Import Error",
        (err as Error).message || "Failed to import audio.",
      );
    }
  };

  // Play / Pause entry audio
  const handlePlayClip = async (entry: JournalEntry) => {
    if (playingEntryId === entry.id) {
      await audioPlaybackService.pause();
      return;
    }

    try {
      if (entry.is_audio_cached === 1 && entry.local_audio_path) {
        await audioPlaybackService.play(
          entry.id,
          entry.local_audio_path,
          entry.duration_sec,
        );
        await entriesDao.markAudioAccessed(entry.id);
      } else if (entry.drive_audio_file_id) {
        Alert.alert(
          "Streaming Cloud Audio",
          "Downloading audio clip on demand...",
        );
        const cachedPath = await googleDriveService.downloadAudioOnDemand(
          entry.id,
        );
        await audioPlaybackService.play(
          entry.id,
          cachedPath,
          entry.duration_sec,
        );
        await loadData();
      }
    } catch (err) {
      Alert.alert(
        "Playback Error",
        (err as Error).message || "Could not play audio.",
      );
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
    if (googleDriveService.getCurrentUser()) {
      googleDriveService
        .uploadEntry(entryToSave)
        .then(async () => {
          await syncQueueDao.deleteByEntryId(entryToSave.id);
        })
        .catch((err) => {
          console.warn("Deferred background Drive upload after edit:", err);
        });
    }
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
                  onPlayPress={() => handlePlayClip(clip)}
                  onPress={() => handleOpenReview(clip)}
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
                <Text style={styles.emptyIcon}>🎙️</Text>
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
            <MaterialIcons
              name="file-download"
              size={22}
              color={colors.text}
            />
          </TouchableOpacity>

          {/* Bottom: Record Voice */}
          <TouchableOpacity
            style={[
              styles.primaryFab,
              {
                backgroundColor: colors.primary,
                shadowColor: colors.primary,
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
          onClose={() => setIsReviewVisible(false)}
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
  emptyIcon: {
    fontSize: 28,
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
  secondaryFabIcon: {
    fontSize: 23,
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
  primaryFabIcon: {
    fontSize: 30,
  },
});
