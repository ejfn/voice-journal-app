import React from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";

interface TimelineHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSyncPress?: () => void;
  isSyncing?: boolean;
  onSettingsPress?: () => void;
}

export const TimelineHeader: React.FC<TimelineHeaderProps> = ({
  searchQuery,
  onSearchChange,
  onSyncPress,
  isSyncing,
  onSettingsPress,
}) => {
  const { colors, mode, toggleTheme } = useTheme();

  const getThemeIcon = () => {
    if (mode === "dark") return "🌙 Dark";
    if (mode === "light") return "☀️ Light";
    return "🌓 Auto";
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.surface, borderBottomColor: colors.border },
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.titleContainer}>
          <Text style={[styles.title, { color: colors.text }]}>
            Voice Journal
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Zero-subscription diary
          </Text>
        </View>
        <View style={styles.topActions}>
          {onSyncPress && (
            <TouchableOpacity
              style={[
                styles.actionButton,
                { backgroundColor: colors.surfaceAlt },
              ]}
              onPress={onSyncPress}
              disabled={isSyncing}
              accessibilityLabel="Sync with Google Drive"
            >
              <Text style={[styles.actionText, { color: colors.primary }]}>
                {isSyncing ? "⟳ Syncing..." : "☁ Drive"}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: colors.surfaceAlt },
            ]}
            onPress={toggleTheme}
            accessibilityLabel="Toggle Theme"
          >
            <Text style={[styles.actionText, { color: colors.text }]}>
              {getThemeIcon()}
            </Text>
          </TouchableOpacity>
          {onSettingsPress && (
            <TouchableOpacity
              style={[
                styles.actionButton,
                { backgroundColor: colors.surfaceAlt },
              ]}
              onPress={onSettingsPress}
              accessibilityLabel="Open Settings & Sync"
            >
              <Text style={[styles.actionText, { color: colors.text }]}>
                ⚙️
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View
        style={[
          styles.searchBar,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.searchIcon, { color: colors.textMuted }]}>🔍</Text>
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search transcripts, titles, tags..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={onSearchChange}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => onSearchChange("")}
            style={styles.clearButton}
          >
            <Text style={[styles.clearText, { color: colors.textMuted }]}>
              ✕
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "400",
    marginTop: 1,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  actionText: {
    fontSize: 12,
    fontWeight: "600",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: "100%",
    padding: 0,
  },
  clearButton: {
    padding: 4,
  },
  clearText: {
    fontSize: 14,
    fontWeight: "bold",
  },
});
