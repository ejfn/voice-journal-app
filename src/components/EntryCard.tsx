import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import MaterialIcons from "@react-native-vector-icons/material-icons";
import { JournalEntry } from "../db/schema";
import { useTheme } from "../theme/ThemeContext";
import { formatDuration, formatTime } from "../utils/paths";
import {
  computeStorageStatus,
  getStorageBadgeConfig,
} from "../utils/storageStatus";

interface EntryCardProps {
  entry: JournalEntry;
  isPlaying: boolean;
  isDownloading?: boolean;
  isItemSyncing?: boolean;
  onPlayPress: () => void;
  onPress: () => void;
  onRetryTranscription?: (entryId: string) => void;
}

export const EntryCard: React.FC<EntryCardProps> = ({
  entry,
  isPlaying,
  isDownloading,
  isItemSyncing = false,
  onPlayPress,
  onPress,
  onRetryTranscription,
}) => {
  const { colors } = useTheme();
  const storageStatus = computeStorageStatus(entry, {
    isItemSyncing,
  });
  const storageBadge = getStorageBadgeConfig(
    storageStatus,
    colors,
    isDownloading ? "download" : "upload",
  );
  const isUntranscribed =
    entry.transcription_status && entry.transcription_status !== "completed";

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: isPlaying ? colors.primary : colors.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleArea}>
          <Text
            style={[styles.title, { color: colors.text }]}
            numberOfLines={1}
          >
            {entry.title || "Voice Note"}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.metaText, { color: colors.textMuted }]}>
              {formatTime(entry.created_at)} •{" "}
              {formatDuration(entry.duration_sec)}
            </Text>
            <View
              style={[
                styles.storageBadge,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                },
              ]}
              accessibilityLabel={storageBadge.description}
            >
              <MaterialIcons
                name={storageBadge.iconName}
                size={12}
                color={storageBadge.color}
                style={{ marginRight: 3 }}
              />
              <Text
                style={[styles.storageBadgeText, { color: storageBadge.color }]}
              >
                {storageBadge.label}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.playButton,
            {
              backgroundColor: isPlaying ? colors.primary : colors.surfaceAlt,
            },
          ]}
          onPress={onPlayPress}
          disabled={isDownloading}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityLabel={
            isDownloading
              ? "Downloading Audio"
              : isPlaying
                ? "Pause Audio"
                : "Play Audio"
          }
        >
          {isDownloading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <MaterialIcons
              name={isPlaying ? "pause" : "play-arrow"}
              size={20}
              color={isPlaying ? "#FFFFFF" : colors.primary}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* Background Transcription Indicator Banner */}
      {isUntranscribed && (
        <View
          style={[
            styles.transcriptionBanner,
            {
              backgroundColor: colors.surfaceAlt,
              borderColor:
                entry.transcription_status === "processing"
                  ? colors.primary
                  : entry.transcription_status === "queued"
                    ? colors.warning
                    : colors.danger,
            },
          ]}
        >
          {entry.transcription_status === "processing" ? (
            <View style={styles.transcriptionInner}>
              <ActivityIndicator
                size="small"
                color={colors.primary}
                style={styles.spinner}
              />
              <Text
                style={[styles.transcriptionText, { color: colors.primary }]}
              >
                Transcribing with Gemini 3.5...
              </Text>
            </View>
          ) : entry.transcription_status === "queued" ? (
            <View style={styles.transcriptionInner}>
              <MaterialIcons
                name="schedule"
                size={14}
                color={colors.warning}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[styles.transcriptionText, { color: colors.warning }]}
              >
                Queued for transcription (offline)
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.transcriptionInner}
              onPress={() => onRetryTranscription?.(entry.id)}
              activeOpacity={0.7}
            >
              <MaterialIcons
                name="refresh"
                size={14}
                color={colors.danger}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[styles.transcriptionText, { color: colors.danger }]}
              >
                Transcription failed • Tap to retry
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {entry.summary ? (
        <Text
          style={[styles.summary, { color: colors.text }]}
          numberOfLines={2}
        >
          {entry.summary}
        </Text>
      ) : null}

      {entry.tags && entry.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {entry.tags.slice(0, 3).map((tag) => (
            <View
              key={tag}
              style={[
                styles.tagBadge,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.tagText, { color: colors.textMuted }]}>
                {tag.toLowerCase()}
              </Text>
            </View>
          ))}
          {entry.tags.length > 3 && (
            <View
              style={[
                styles.tagBadge,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.tagText, { color: colors.textMuted }]}>
                +{entry.tags.length - 3}
              </Text>
            </View>
          )}
        </View>
      ) : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  titleArea: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  metaText: {
    fontSize: 12.5,
    fontWeight: "500",
  },
  storageBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  storageBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  transcriptionBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  transcriptionInner: {
    flexDirection: "row",
    alignItems: "center",
  },
  transcriptionText: {
    fontSize: 12,
    fontWeight: "600",
  },
  spinner: {
    marginRight: 6,
  },
  summary: {
    fontSize: 13.5,
    lineHeight: 19,
    marginBottom: 10,
    opacity: 0.9,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 12,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 11.5,
    fontWeight: "500",
    letterSpacing: 0.1,
  },
});
