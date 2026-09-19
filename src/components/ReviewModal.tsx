import React, { useState, useEffect } from "react";
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
} from "react-native";
import { JournalEntry } from "../db/schema";
import {
  audioPlaybackService,
  PlaybackState,
} from "../services/audio/AudioPlaybackService";
import { useTheme } from "../theme/ThemeContext";
import { formatDuration, formatTimer } from "../utils/paths";

interface ReviewModalProps {
  visible: boolean;
  entry: JournalEntry | null;
  onSave: (updatedEntry: JournalEntry) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  visible,
  entry,
  onSave,
  onDelete,
  onClose,
}) => {
  const { colors } = useTheme();

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

  useEffect(() => {
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
    if (!entry) return;
    if (playbackState.isPlaying) {
      await audioPlaybackService.pause();
    } else if (entry.local_audio_path) {
      await audioPlaybackService.play(
        entry.id,
        entry.local_audio_path,
        entry.duration_sec,
      );
    }
  };

  const handleSeek = async (ratio: number) => {
    if (!entry) return;
    const targetSec = Math.round(ratio * (entry.duration_sec || 1));
    await audioPlaybackService.seekTo(targetSec);
  };

  const handleAddTag = () => {
    const clean = newTagInput.trim().toLowerCase().replace(/^#+/, "");
    if (clean && !tags.includes(clean)) {
      setTags([...tags, clean]);
      setNewTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSaveAndClose = () => {
    if (!entry) return;
    audioPlaybackService.stop();
    onSave({
      ...entry,
      title: title.trim() || "Untitled Voice Entry",
      summary: summary.trim(),
      transcript: transcript.trim(),
      tags,
    });
  };

  const handleDelete = () => {
    if (!entry) return;
    audioPlaybackService.stop();
    onDelete(entry.id);
  };

  const handleClose = () => {
    audioPlaybackService.stop();
    onClose();
  };

  if (!entry) return null;

  const durationSec = entry.duration_sec || playbackState.durationSec || 1;
  const progressRatio = Math.min(
    1,
    Math.max(0, playbackState.currentTimeSec / durationSec),
  );

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
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Text style={[styles.closeText, { color: colors.textMuted }]}>
              Cancel
            </Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Entry Review & Details
          </Text>
          <TouchableOpacity
            onPress={handleSaveAndClose}
            style={styles.saveHeaderButton}
          >
            <Text style={[styles.saveHeaderText, { color: colors.primary }]}>
              Save
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Audio Player Bar */}
          <View
            style={[
              styles.playerContainer,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.playerControls}>
              <TouchableOpacity
                style={[
                  styles.playerPlayBtn,
                  { backgroundColor: colors.primary },
                ]}
                onPress={handlePlayPause}
                activeOpacity={0.8}
              >
                <Text style={styles.playerPlayIcon}>
                  {playbackState.isPlaying ? "⏸" : "▶"}
                </Text>
              </TouchableOpacity>

              <View style={styles.playerTimeInfo}>
                <Text style={[styles.timerText, { color: colors.text }]}>
                  {formatTimer(playbackState.currentTimeSec)} /{" "}
                  {formatDuration(durationSec)}
                </Text>
                {/* Progress bar */}
                <TouchableOpacity
                  style={[
                    styles.progressBarBg,
                    { backgroundColor: colors.surfaceAlt },
                  ]}
                  activeOpacity={1}
                  onPress={(e) => {
                    const width = 200; // approximation
                    const clickX = e.nativeEvent.locationX;
                    handleSeek(clickX / width);
                  }}
                >
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        backgroundColor: colors.primary,
                        width: `${Math.round(progressRatio * 100)}%`,
                      },
                    ]}
                  />
                </TouchableOpacity>
              </View>

              <Text style={styles.volumeIcon}>🔊</Text>
            </View>
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
              placeholder="Give this entry a headline..."
              placeholderTextColor={colors.textMuted}
            />
          </View>

          {/* AI Summary */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
              AI SUMMARY
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
              multiline
              placeholder="Executive summary..."
              placeholderTextColor={colors.textMuted}
            />
          </View>

          {/* Tags Editor */}
          <View style={styles.section}>
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
                  >
                    <Text
                      style={[
                        styles.removeTagText,
                        { color: colors.textMuted },
                      ]}
                    >
                      ✕
                    </Text>
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
                placeholder="Add tag (lowercase, no #)..."
                placeholderTextColor={colors.textMuted}
                onSubmitEditing={handleAddTag}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[styles.addTagBtn, { backgroundColor: colors.primary }]}
                onPress={handleAddTag}
              >
                <Text style={styles.addTagBtnText}>+ Add</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Verbatim Transcript */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
              TRANSCRIPT (VERBATIM)
            </Text>
            <TextInput
              style={[
                styles.textArea,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.text,
                  minHeight: 140,
                },
              ]}
              value={transcript}
              onChangeText={setTranscript}
              multiline
              placeholder="Audio transcript..."
              placeholderTextColor={colors.textMuted}
            />
          </View>

          {/* Delete Action */}
          <View style={styles.bottomActions}>
            <TouchableOpacity
              style={[styles.deleteButton, { borderColor: colors.danger }]}
              onPress={handleDelete}
            >
              <Text style={[styles.deleteText, { color: colors.danger }]}>
                Delete Entry
              </Text>
            </TouchableOpacity>
          </View>
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
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 48 : 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    fontSize: 15,
  },
  saveHeaderButton: {
    padding: 4,
  },
  saveHeaderText: {
    fontSize: 15,
    fontWeight: "600",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  playerContainer: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  playerControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  playerPlayBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  playerPlayIcon: {
    color: "#FFF",
    fontSize: 16,
    marginLeft: 2,
  },
  playerTimeInfo: {
    flex: 1,
  },
  timerText: {
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 6,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  volumeIcon: {
    fontSize: 16,
  },
  section: {
    marginBottom: 18,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: "600",
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
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
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  tagItemText: {
    fontSize: 12,
    fontWeight: "500",
  },
  removeTagBtn: {
    padding: 2,
  },
  removeTagText: {
    fontSize: 10,
    fontWeight: "700",
  },
  addTagRow: {
    flexDirection: "row",
    gap: 8,
  },
  addTagInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 13,
  },
  addTagBtn: {
    paddingHorizontal: 14,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  addTagBtnText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "600",
  },
  bottomActions: {
    marginTop: 20,
    alignItems: "center",
  },
  deleteButton: {
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  deleteText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
