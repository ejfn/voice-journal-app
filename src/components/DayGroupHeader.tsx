import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeContext";

interface DayGroupHeaderProps {
  dayLabel: string;
  clipCount: number;
}

export const DayGroupHeader: React.FC<DayGroupHeaderProps> = ({
  dayLabel,
  clipCount,
}) => {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={[styles.dateText, { color: colors.text }]}>
          {dayLabel}
        </Text>
        {clipCount > 1 && (
          <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={[styles.badgeText, { color: colors.textMuted }]}>
              {clipCount} clips
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateText: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "500",
  },
});
