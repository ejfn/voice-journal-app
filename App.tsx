import React, { useState, useEffect, useCallback } from "react";
import {
  SafeAreaView,
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
import { DayGroupHeader } from "./src/components/DayGroupHeader";
import { EntryCard } from "./src/components/EntryCard";
import { MonthSectionHeader } from "./src/components/MonthSectionHeader";
import { RecordingModal } from "./src/components/RecordingModal";
import { ReviewModal } from "./src/components/ReviewModal";
import { SettingsModal } from "./src/components/SettingsModal";
import { TagFilterChips } from "./src/components/TagFilterChips";
import { TimelineHeader } from "./src/components/TimelineHeader";
import { DayGroup, entriesDao, MonthSection } from "./src/db/dao/entriesDao";
import { syncQueueDao } from "./src/db/dao/syncQueueDao";
import { initDatabase } from "./src/db/database";
import { JournalEntry } from "./src/db/schema";
import { geminiService } from "./src/services/ai/GeminiService";
import { audioImportService } from "./src/services/audio/AudioImportService";
import { audioPlaybackService } from "./src/services/audio/AudioPlaybackService";
import { audioRecordingService } from "./src/services/audio/AudioRecordingService";
import { googleDriveService } from "./src/services/drive/GoogleDriveService";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";

const MainScreen: React.FC = () => {
  const { colors, isDark } = useTheme();

  const [sections, setSections] = useState<MonthSection[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

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
      const result = await googleDriveService.syncTimelineFromDrive();
      await googleDriveService.runLruEviction();
      await loadData();
      Alert.alert(
        "Sync Complete",
        `Synchronized timeline. ${result.importedCount} new clips found.`,
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

    const newId = `entry_${Date.now()}`;
    setCurrentRecordingId(newId);
    setRecordingDurationSec(0);
    setRecordingMetering(0);
    setIsRecordingPaused(false);
    setIsProcessingAI(false);
    setIsRecordingVisible(true);

    await audioRecordingService.startRecording(newId, (status) => {
      setRecordingDurationSec(Math.round(status.durationMillis / 1000));
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
    setIsProcessingAI(true);
    try {
      const { localUri, durationSec } =
        await audioRecordingService.stopRecording();
      const entryId = currentRecordingId || `entry_${Date.now()}`;
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
        last_accessed_at: now,
      };

      await entriesDao.insertEntry(newEntry);
      await syncQueueDao.enqueue({
        entry_id: entryId,
        action: "ANALYZE_AND_UPLOAD",
      });

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
    await entriesDao.updateEntry(updated);
    setIsReviewVisible(false);
    setReviewEntry(null);
    await loadData();
  };

  const handleDeleteEntry = async (id: string) => {
    Alert.alert(
      "Delete Entry",
      "Are you sure you want to delete this voice journal entry?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await entriesDao.deleteEntry(id);
            setIsReviewVisible(false);
            setReviewEntry(null);
            await loadData();
          },
        },
      ],
    );
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
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <View style={styles.responsiveContainer}>
        <TimelineHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSyncPress={handleDriveSync}
          isSyncing={isSyncing}
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

        {/* Floating Action Buttons Container */}
        <View style={styles.fabContainer}>
          <TouchableOpacity
            style={[
              styles.secondaryFab,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            onPress={handleImportAudio}
            activeOpacity={0.8}
            accessibilityLabel="Import Audio Files"
          >
            <Text style={[styles.secondaryFabText, { color: colors.text }]}>
              📥 Import
            </Text>
          </TouchableOpacity>

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
            <Text style={styles.primaryFabIcon}>🎙️</Text>
            <Text style={styles.primaryFabText}>Record</Text>
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
      </View>
    </SafeAreaView>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <MainScreen />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
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
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  secondaryFab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 26,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  secondaryFabText: {
    fontSize: 13.5,
    fontWeight: "600",
  },
  primaryFab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 28,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
    gap: 8,
  },
  primaryFabIcon: {
    fontSize: 17,
  },
  primaryFabText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
});
