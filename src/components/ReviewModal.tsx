import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  ActivityIndicator,
  Keyboard,
  Animated,
  Easing,
} from "react-native";
import { File } from "expo-file-system";
import { JournalEntry } from "../db/schema";
import { entriesDao } from "../db/dao/entriesDao";
import { googleDriveService } from "../services/drive/GoogleDriveService";
import {
  audioPlaybackService,
  PlaybackState,
} from "../services/audio/AudioPlaybackService";
import { useTheme } from "../theme/ThemeContext";
import { formatDuration, formatTimer } from "../utils/paths";
import MaterialIcons from "@react-native-vector-icons/material-icons";
import {
  computeStorageStatus,
  getStorageBadgeConfig,
} from "../utils/storageStatus";
import { useToast } from "./common/Toast";

interface ReviewModalProps {
  visible: boolean;
  entry: JournalEntry | null;
  onSave: (updatedEntry: JournalEntry) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onRetryTranscription?: (id: string) => void;
}

export function getDeterministicWaveform(
  _id?: string,
  count: number = 35,
): number[] {
  // If amplitude data is not available, render a flat baseline (no fake synthetic waves)
  return new Array(count).fill(0.06);
}

export function sampleAmplitudeData(
  data: number[],
  count: number = 35,
): number[] {
  if (!data || data.length === 0) return new Array(count).fill(0.06);

  const result: number[] = [];
  const step = data.length / count;
  for (let i = 0; i < count; i++) {
    const startIdx = Math.floor(i * step);
    const endIdx = Math.min(data.length, Math.floor((i + 1) * step));

    if (startIdx === endIdx) {
      const sampleIdx = Math.min(data.length - 1, startIdx);
      result.push(Math.max(0.06, data[sampleIdx]));
    } else {
      let maxVal = 0.06;
      for (let j = startIdx; j < endIdx; j++) {
        if (data[j] > maxVal) {
          maxVal = data[j];
        }
      }
      result.push(maxVal);
    }
  }

  // --- AMPLIFIER (AMPLITUDE NORMALIZATION) ---
  // Find the peak amplitude in the downsampled result
  const peak = Math.max(...result);

  // If the peak exceeds the baseline floor, scale/amplify so the vocal peaks reach 1.0
  if (peak > 0.06) {
    const scaleFactor = 1.0 / peak;
    return result.map((val) =>
      Math.max(0.06, Math.min(1.0, val * scaleFactor)),
    );
  }

  return result.map((val) => Math.max(0.06, val));
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  visible,
  entry,
  onSave,
  onDelete,
  onClose,
  onRetryTranscription,
}) => {
  const { colors } = useTheme();
  const { showToast } = useToast();

  const [currentEntry, setCurrentEntry] = useState<JournalEntry | null>(entry);
  const activeEntry = currentEntry || entry;

  const BAR_WIDTH = 3.5;
  const BAR_MARGIN = 1.5;
  const BAR_STEP = BAR_WIDTH + BAR_MARGIN * 2; // 6.5dp
  const BAR_COUNT = 55;

  const [containerWidth, setContainerWidth] = useState(320);
  const [scrubberWidth, setScrubberWidth] = useState(200);
  const [hasCompleted, setHasCompleted] = useState(false);
  const waveformTranslateX = useRef(new Animated.Value(160)).current;

  const waveformBars = useMemo(() => {
    if (!activeEntry) return [];
    if (activeEntry.amplitude_data && activeEntry.amplitude_data.length > 0) {
      return sampleAmplitudeData(activeEntry.amplitude_data, BAR_COUNT);
    }
    return getDeterministicWaveform(activeEntry.id, BAR_COUNT);
  }, [activeEntry]);

  const [isDownloadingAudio, setIsDownloadingAudio] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [transcript, setTranscript] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    currentTimeSec: 0,
    durationSec: 0,
    entryId: null,
  });

  const scrollViewRef = useRef<ScrollView>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        setKeyboardHeight(0);
      },
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleTranscriptFocus = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 150);
  };

  const handleSummaryFocus = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 160, animated: true });
    }, 150);
  };

  const [tagSectionY, setTagSectionY] = useState(260);

  const handleTagFocus = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, tagSectionY - 20),
        animated: true,
      });
    }, 150);
  };

  useEffect(() => {
    setCurrentEntry(entry);
    if (entry) {
      setTitle(entry.title);
      setSummary(entry.summary);
      setTranscript(entry.transcript);
      setTags(entry.tags || []);
    }
  }, [entry]);

  useEffect(() => {
    const unsubscribe = audioPlaybackService.addListener((state) => {
      if (entry && state.entryId === entry.id) {
        setPlaybackState(state);
        if (
          !state.isPlaying &&
          state.durationSec > 0 &&
          state.currentTimeSec >= state.durationSec - 0.25
        ) {
          setHasCompleted(true);
        } else if (state.isPlaying) {
          setHasCompleted(false);
        }
      } else {
        setPlaybackState({
          isPlaying: false,
          currentTimeSec: 0,
          durationSec: entry?.duration_sec || 0,
          entryId: null,
        });
      }
    });
    return unsubscribe;
  }, [entry]);

  const handlePlayPause = async () => {
    const active = currentEntry || entry;
    if (!active || isDownloadingAudio) return;

    if (playbackState.isPlaying) {
      await audioPlaybackService.pause();
      return;
    }

    if (hasCompleted) {
      setHasCompleted(false);
      await audioPlaybackService.seekTo(0);
    }

    const localPath = active.local_audio_path;
    let isLocal = active.is_audio_cached === 1 && Boolean(localPath);

    if (isLocal && localPath) {
      try {
        const file = new File(localPath);
        if (!file.exists) {
          isLocal = false;
        }
      } catch {
        isLocal = false;
      }
    }

    if (isLocal && localPath) {
      await audioPlaybackService.play(
        active.id,
        localPath,
        active.duration_sec,
      );
      await entriesDao.markAudioAccessed(active.id);
    } else if (active.drive_audio_file_id) {
      setIsDownloadingAudio(true);
      showToast({
        message: "Downloading audio from Google Drive...",
        icon: "cloud-download",
        type: "info",
      });

      try {
        const cachedPath = await googleDriveService.downloadAudioOnDemand(
          active.id,
        );
        setCurrentEntry((prev) =>
          prev
            ? { ...prev, local_audio_path: cachedPath, is_audio_cached: 1 }
            : null,
        );
        await audioPlaybackService.play(
          active.id,
          cachedPath,
          active.duration_sec,
        );
      } catch (err) {
        showToast({
          message:
            (err as Error).message || "Failed to download audio from Drive",
          icon: "error-outline",
          type: "error",
        });
      } finally {
        setIsDownloadingAudio(false);
      }
    } else {
      showToast({
        message: "Audio file is not available.",
        icon: "error-outline",
        type: "error",
      });
    }
  };

  const handleSeek = async (ratio: number) => {
    const active = currentEntry || entry;
    if (!active) return;
    setHasCompleted(false);
    const targetSec = Math.round(ratio * (active.duration_sec || 1));
    await audioPlaybackService.seekTo(targetSec);
  };

  const handleRewind10 = async () => {
    setHasCompleted(false);
    const target = Math.max(0, playbackState.currentTimeSec - 10);
    await audioPlaybackService.seekTo(target);
  };

  const handleForward10 = async () => {
    setHasCompleted(false);
    const target = Math.min(durationSec, playbackState.currentTimeSec + 10);
    await audioPlaybackService.seekTo(target);
  };

  const handleAddTag = () => {
    const clean = newTagInput.trim().toLowerCase().replace(/^#+/, "");
    if (clean && !tags.includes(clean)) {
      setTags([...tags, clean]);
      setNewTagInput("");
      handleTagFocus();
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSaveAndClose = () => {
    const active = currentEntry || entry;
    if (!active) return;
    audioPlaybackService.stop();
    onSave({
      ...active,
      title: title.trim() || "Untitled Voice Entry",
      summary: summary.trim(),
      transcript: transcript.trim(),
      tags,
    });
  };

  const handleDelete = () => {
    const active = currentEntry || entry;
    if (!active) return;
    audioPlaybackService.stop();
    onDelete(active.id);
  };

  const handleClose = () => {
    audioPlaybackService.stop();
    onClose();
  };

  const durationSec =
    activeEntry?.duration_sec || playbackState.durationSec || 1;
  const rawProgressRatio = Math.min(
    1,
    Math.max(0, playbackState.currentTimeSec / durationSec),
  );
  const progressRatio = hasCompleted ? 1 : rawProgressRatio;

  useEffect(() => {
    const totalWaveformWidth = waveformBars.length * BAR_STEP;
    const centerX = containerWidth / 2;
    const targetX = centerX - progressRatio * totalWaveformWidth;

    const anim = Animated.timing(waveformTranslateX, {
      toValue: targetX,
      duration: playbackState.isPlaying ? 100 : 0,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [
    containerWidth,
    waveformBars.length,
    progressRatio,
    playbackState.isPlaying,
    waveformTranslateX,
    BAR_STEP,
  ]);

  if (!activeEntry) return null;

  const storageStatus = computeStorageStatus(activeEntry);
  const storageBadge = getStorageBadgeConfig(storageStatus, colors);
  const isUntranscribed =
    activeEntry.transcription_status &&
    activeEntry.transcription_status !== "completed";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={[
            styles.header,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Close"
          >
            <MaterialIcons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Review Entry
          </Text>
          <TouchableOpacity
            onPress={handleSaveAndClose}
            style={[
              styles.saveHeaderButton,
              { backgroundColor: colors.primary },
            ]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Save Changes"
          >
            <Text style={styles.saveHeaderText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom:
                Platform.OS === "ios"
                  ? 40
                  : keyboardHeight > 0
                    ? keyboardHeight + 40
                    : 40,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={true}
        >
          {/* Audio Player: Waveform Amplifier Canvas + Scrubber + Controls */}
          <View
            style={[
              styles.playerCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {/* Waveform Amplifier Canvas with fixed center playhead needle */}
            <TouchableOpacity
              style={[
                styles.waveformCanvas,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                },
              ]}
              activeOpacity={0.95}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Playback waveform visualizer and scrubber"
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round(progressRatio * 100),
                text: `${formatTimer(Math.floor(playbackState.currentTimeSec))} of ${formatDuration(durationSec)}`,
              }}
              accessibilityActions={[
                { name: "increment", label: "Seek forward 5 percent" },
                { name: "decrement", label: "Seek backward 5 percent" },
              ]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "increment") {
                  void handleSeek(Math.min(1, progressRatio + 0.05));
                }
                if (event.nativeEvent.actionName === "decrement") {
                  void handleSeek(Math.max(0, progressRatio - 0.05));
                }
              }}
              onLayout={(e) => {
                setContainerWidth(e.nativeEvent.layout.width || 320);
              }}
              onPress={(e) => {
                const { locationX } = e.nativeEvent;
                const totalWaveformWidth = waveformBars.length * BAR_STEP;
                const centerX = containerWidth / 2;
                const currentX = centerX - progressRatio * totalWaveformWidth;
                const tappedOffset = locationX - currentX;
                const ratio = Math.max(
                  0,
                  Math.min(1, tappedOffset / totalWaveformWidth),
                );
                void handleSeek(ratio);
              }}
            >
              {/* Scrolling Waveform Bars */}
              <Animated.View
                style={[
                  styles.waveformTrack,
                  {
                    transform: [{ translateX: waveformTranslateX }],
                  },
                ]}
              >
                {waveformBars.map((heightFactor, index) => {
                  const isPast = index / waveformBars.length <= progressRatio;
                  return (
                    <View
                      key={index}
                      style={[
                        styles.waveformBar,
                        {
                          height: Math.max(6, heightFactor * 100),
                          backgroundColor: isPast
                            ? colors.waveformActive
                            : colors.waveformBar,
                        },
                      ]}
                    />
                  );
                })}
              </Animated.View>

              {/* Fixed Center Playhead Needle */}
              <View
                pointerEvents="none"
                style={[
                  styles.centerPlayhead,
                  { backgroundColor: colors.waveformActive },
                ]}
              />
            </TouchableOpacity>

            {/* Timeline Scrubber & Time Display */}
            <View style={styles.scrubberRow}>
              <Text style={[styles.timeLabel, { color: colors.textMuted }]}>
                {formatTimer(Math.floor(playbackState.currentTimeSec))}
              </Text>

              <TouchableOpacity
                style={styles.scrubberTrackContainer}
                activeOpacity={1}
                onLayout={(e) => {
                  setScrubberWidth(e.nativeEvent.layout.width || 200);
                }}
                onPress={(e) => {
                  const { locationX } = e.nativeEvent;
                  const ratio = Math.max(
                    0,
                    Math.min(1, locationX / (scrubberWidth || 1)),
                  );
                  void handleSeek(ratio);
                }}
              >
                <View
                  style={[
                    styles.scrubberTrack,
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.scrubberFill,
                      {
                        backgroundColor: colors.primary,
                        width: `${Math.round(progressRatio * 100)}%`,
                      },
                    ]}
                  />
                </View>
                <View
                  style={[
                    styles.scrubberThumb,
                    {
                      left: `${progressRatio * 100}%`,
                      backgroundColor: colors.primary,
                    },
                  ]}
                />
              </TouchableOpacity>

              <Text style={[styles.timeLabel, { color: colors.textMuted }]}>
                {`-${formatDuration(Math.max(0, durationSec - Math.floor(playbackState.currentTimeSec)))}`}
              </Text>
            </View>

            {/* Playback Controls Row: Replay 10, Play/Pause Pill, Forward 10 */}
            <View style={styles.playbackControlsRow}>
              <TouchableOpacity
                onPress={handleRewind10}
                style={[
                  styles.skipButton,
                  { backgroundColor: colors.surfaceAlt },
                ]}
                activeOpacity={0.7}
                accessibilityLabel="Rewind 10 seconds"
              >
                <MaterialIcons name="replay-10" size={26} color={colors.text} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.primaryPlayButton,
                  { backgroundColor: colors.primary },
                  isDownloadingAudio && { opacity: 0.6 },
                ]}
                onPress={handlePlayPause}
                disabled={isDownloadingAudio}
                activeOpacity={0.8}
                accessibilityLabel={
                  isDownloadingAudio
                    ? "Downloading audio"
                    : playbackState.isPlaying
                      ? "Pause audio"
                      : "Play audio"
                }
              >
                {isDownloadingAudio ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialIcons
                      name={playbackState.isPlaying ? "pause" : "play-arrow"}
                      size={28}
                      color="#FFFFFF"
                    />
                    <Text style={styles.playButtonText}>
                      {playbackState.isPlaying ? "Pause" : "Play"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleForward10}
                style={[
                  styles.skipButton,
                  { backgroundColor: colors.surfaceAlt },
                ]}
                activeOpacity={0.7}
                accessibilityLabel="Forward 10 seconds"
              >
                <MaterialIcons
                  name="forward-10"
                  size={26}
                  color={colors.text}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Storage & Cloud Sync Status Badge */}
          <View
            style={[
              styles.statusBarContainer,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.statusRow}>
              <MaterialIcons
                name={storageBadge.iconName}
                size={15}
                color={storageBadge.color}
                style={{ marginRight: 6 }}
              />
              <Text style={{ flex: 1 }} numberOfLines={1} ellipsizeMode="tail">
                <Text
                  style={[styles.statusTitle, { color: storageBadge.color }]}
                >
                  {storageBadge.label}
                </Text>
                <Text
                  style={[
                    styles.statusDescription,
                    { color: colors.textMuted },
                  ]}
                >
                  {" • "}
                  {storageBadge.description}
                </Text>
              </Text>
            </View>

            {isUntranscribed && (
              <View
                style={[
                  styles.reviewTranscriptionRow,
                  { borderTopColor: colors.border },
                ]}
              >
                {activeEntry.transcription_status === "processing" ? (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <ActivityIndicator
                      size="small"
                      color={colors.primary}
                      style={{ marginRight: 8 }}
                    />
                    <Text
                      style={[
                        styles.reviewTranscriptionText,
                        { color: colors.primary },
                      ]}
                    >
                      Transcribing with Gemini 3.5...
                    </Text>
                  </View>
                ) : activeEntry.transcription_status === "queued" ? (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <MaterialIcons
                      name="schedule"
                      size={16}
                      color={colors.warning}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={[
                        styles.reviewTranscriptionText,
                        { color: colors.warning },
                      ]}
                    >
                      Queued for transcription (waiting for connection)
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={{ flexDirection: "row", alignItems: "center" }}
                    onPress={() => onRetryTranscription?.(activeEntry.id)}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons
                      name="refresh"
                      size={16}
                      color={colors.danger}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={[
                        styles.reviewTranscriptionText,
                        { color: colors.danger },
                      ]}
                    >
                      Transcription failed • Tap to retry
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* Title Editor */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
              TITLE
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              value={title}
              onChangeText={setTitle}
              placeholder="Headline..."
              placeholderTextColor={colors.textMuted}
            />
          </View>

          {/* AI Summary */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
              SUMMARY
            </Text>
            <TextInput
              style={[
                styles.textArea,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.text,
                  height: 75,
                },
              ]}
              value={summary}
              onChangeText={setSummary}
              onFocus={handleSummaryFocus}
              multiline
              placeholder="Key takeaway..."
              placeholderTextColor={colors.textMuted}
            />
          </View>

          {/* Tags Editor */}
          <View
            style={styles.section}
            onLayout={(e) => setTagSectionY(e.nativeEvent.layout.y)}
          >
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
              TAGS
            </Text>
            <View style={styles.tagWrap}>
              {tags.map((tag) => (
                <View
                  key={tag}
                  style={[
                    styles.tagItem,
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.tagItemText, { color: colors.text }]}>
                    {tag}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleRemoveTag(tag)}
                    style={styles.removeTagBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={`Remove tag ${tag}`}
                  >
                    <MaterialIcons
                      name="close"
                      size={14}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <View style={styles.addTagRow}>
              <TextInput
                style={[
                  styles.addTagInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                value={newTagInput}
                onChangeText={setNewTagInput}
                placeholder="Add new tag..."
                placeholderTextColor={colors.textMuted}
                onSubmitEditing={handleAddTag}
                returnKeyType="done"
                onFocus={handleTagFocus}
              />
              <TouchableOpacity
                style={[styles.addTagBtn, { backgroundColor: colors.primary }]}
                onPress={handleAddTag}
              >
                <Text style={styles.addTagBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Verbatim Transcript */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
                VERBATIM TRANSCRIPT
              </Text>
              {transcript.trim().length > 0 && (
                <Text
                  style={[styles.wordCountText, { color: colors.textMuted }]}
                >
                  {transcript.trim().split(/\s+/).length} words
                </Text>
              )}
            </View>
            <TextInput
              style={[
                styles.transcriptInput,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              value={transcript}
              onChangeText={setTranscript}
              onFocus={handleTranscriptFocus}
              multiline={true}
              scrollEnabled={true}
              textAlignVertical="top"
              placeholder="Audio transcript..."
              placeholderTextColor={colors.textMuted}
            />
          </View>

          {/* Delete Entry Button */}
          <TouchableOpacity
            style={[
              styles.deleteButton,
              {
                borderColor: colors.danger,
                backgroundColor: colors.surface,
              },
            ]}
            onPress={handleDelete}
            activeOpacity={0.7}
            accessibilityLabel="Delete entry"
          >
            <MaterialIcons
              name="delete-outline"
              size={18}
              color={colors.danger}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.deleteText, { color: colors.danger }]}>
              Delete Entry
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    paddingHorizontal: 18,
    paddingTop:
      Platform.OS === "android" ? (StatusBar.currentHeight || 24) + 12 : 52,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: {
    fontSize: 18,
    fontWeight: "600",
  },
  saveHeaderButton: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
  },
  saveHeaderText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 40,
  },
  playerCard: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  waveformCanvas: {
    width: "100%",
    height: 136,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    justifyContent: "center",
    position: "relative",
  },
  waveformTrack: {
    flexDirection: "row",
    alignItems: "center",
    height: 116,
  },
  waveformBar: {
    width: 3.5,
    marginHorizontal: 1.5,
    borderRadius: 2,
  },
  centerPlayhead: {
    position: "absolute",
    left: "50%",
    marginLeft: -1.5,
    width: 3,
    top: 10,
    bottom: 10,
    borderRadius: 1.5,
    zIndex: 10,
  },
  scrubberRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    marginBottom: 10,
  },
  timeLabel: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
    minWidth: 44,
  },
  scrubberTrackContainer: {
    flex: 1,
    height: 24,
    justifyContent: "center",
    marginHorizontal: 8,
    position: "relative",
  },
  scrubberTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    borderWidth: 0.5,
  },
  scrubberFill: {
    height: "100%",
    borderRadius: 2,
  },
  scrubberThumb: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
    top: 6,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  playbackControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    marginTop: 4,
  },
  skipButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryPlayButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 26,
    height: 48,
    borderRadius: 24,
    gap: 6,
  },
  playButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  section: {
    marginBottom: 18,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 7,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  wordCountText: {
    fontSize: 11,
    fontWeight: "500",
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontWeight: "600",
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: "top",
  },
  transcriptInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14.5,
    lineHeight: 22,
    minHeight: 180,
    maxHeight: 280,
    textAlignVertical: "top",
  },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  tagItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  tagItemText: {
    fontSize: 12.5,
    fontWeight: "500",
  },
  removeTagBtn: {
    padding: 2,
  },
  removeTagText: {
    fontSize: 11,
    fontWeight: "700",
  },
  addTagRow: {
    flexDirection: "row",
    gap: 8,
  },
  addTagInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13.5,
  },
  addTagBtn: {
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  addTagBtnText: {
    color: "#FFFFFF",
    fontSize: 13.5,
    fontWeight: "600",
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 26,
    marginBottom: 16,
  },
  deleteText: {
    fontSize: 14,
    fontWeight: "600",
  },
  statusBarContainer: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusTitle: {
    fontSize: 12,
    fontWeight: "700",
  },
  statusDescription: {
    fontSize: 11.5,
  },
  reviewTranscriptionRow: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
  },
  reviewTranscriptionText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
