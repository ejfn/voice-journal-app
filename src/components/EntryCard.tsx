import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { JournalEntry } from "../db/schema";
import { useTheme } from "../theme/ThemeContext";
import { formatDuration, formatTime } from "../utils/paths";

interface EntryCardProps {
  entry: JournalEntry;
  isPlaying: boolean;
  onPlayPress: () => void;
  onPress: () => void;
}

export const EntryCard: React.FC<EntryCardProps> = ({
  entry,
  isPlaying,
  onPlayPress,
  onPress,
}) => {
  const { colors } = useTheme();

  const isCached = entry.is_audio_cached === 1;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: isPlaying ? colors.primary : colors.border,
          shadowColor: colors.text,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleArea}>
          <Text
            style={[styles.title, { color: colors.text }]}
            numberOfLines={1}
          >
            {entry.title || "Voice Entry"}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.metaText, { color: colors.textMuted }]}>
              {formatTime(entry.created_at)} •{" "}
              {formatDuration(entry.duration_sec)}
            </Text>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: isCached
                    ? colors.surfaceAlt
                    : colors.surfaceHover,
                },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  { color: isCached ? colors.success : colors.primary },
                ]}
              >
                {isCached ? "✓ Cached" : "☁ On Demand"}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.playButton,
            { backgroundColor: isPlaying ? colors.primary : colors.surfaceAlt },
          ]}
          onPress={onPlayPress}
          activeOpacity={0.7}
          accessibilityLabel={isPlaying ? "Pause Audio" : "Play Audio"}
        >
          <Text
            style={[
              styles.playIcon,
              { color: isPlaying ? colors.textInverse : colors.primary },
            ]}
          >
            {isPlaying ? "⏸" : "▶"}
          </Text>
        </TouchableOpacity>
      </View>

      {entry.summary ? (
        <Text
          style={[styles.summary, { color: colors.text }]}
          numberOfLines={2}
        >
          {`"${entry.summary}"`}
        </Text>
      ) : null}

      {entry.tags && entry.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {entry.tags.map((tag) => (
            <View
              key={tag}
              style={[styles.tagBadge, { backgroundColor: colors.surfaceAlt }]}
            >
              <Text style={[styles.tagText, { color: colors.textMuted }]}>
                {tag.toLowerCase()}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 5,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  titleArea: {
    flex: 1,
    marginRight: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 3,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaText: {
    fontSize: 12,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "600",
  },
  playButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: {
    fontSize: 15,
    marginLeft: 2, // optical center for play icon
  },
  summary: {
    fontSize: 13,
    lineHeight: 18,
    fontStyle: "italic",
    marginBottom: 8,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  tagText: {
    fontSize: 11,
    fontWeight: "500",
  },
});
