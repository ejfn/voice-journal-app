import React from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
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

  const todayString = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

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
            {todayString}
          </Text>
        </View>

        <View style={styles.topActions}>
          {onSyncPress && (
            <TouchableOpacity
              style={[
                styles.iconButton,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                },
              ]}
              onPress={onSyncPress}
              disabled={isSyncing}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Sync with Google Drive"
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text
                  style={[styles.iconButtonText, { color: colors.primary }]}
                >
                  ☁️
                </Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.iconButton,
              {
                backgroundColor: colors.surfaceAlt,
                borderColor: colors.border,
              },
            ]}
            onPress={toggleTheme}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Toggle Theme"
          >
            <Text style={styles.iconButtonText}>
              {mode === "dark" ? "☀️" : "🌙"}
            </Text>
          </TouchableOpacity>

          {onSettingsPress && (
            <TouchableOpacity
              style={[
                styles.iconButton,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                },
              ]}
              onPress={onSettingsPress}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Settings"
            >
              <Text style={styles.iconButtonText}>⚙️</Text>
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
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonText: {
    fontSize: 15,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 10,
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
    fontSize: 13,
    fontWeight: "bold",
  },
});
