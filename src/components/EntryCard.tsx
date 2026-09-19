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
          <Text style={[styles.metaText, { color: colors.textMuted }]}>
            {formatTime(entry.created_at)} •{" "}
            {formatDuration(entry.duration_sec)}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.playButton,
            {
              backgroundColor: isPlaying ? colors.primary : colors.surfaceAlt,
            },
          ]}
          onPress={onPlayPress}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityLabel={isPlaying ? "Pause Audio" : "Play Audio"}
        >
          <Text
            style={[
              styles.playIcon,
              { color: isPlaying ? "#FFFFFF" : colors.primary },
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
          {entry.summary}
        </Text>
      ) : null}

      {entry.tags && entry.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {entry.tags.map((tag) => (
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
  metaText: {
    fontSize: 12.5,
    fontWeight: "500",
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: {
    fontSize: 14,
    marginLeft: 2,
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
