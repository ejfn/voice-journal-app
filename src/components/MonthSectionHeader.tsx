import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeContext";

interface MonthSectionHeaderProps {
  monthLabel: string;
}

export const MonthSectionHeader: React.FC<MonthSectionHeaderProps> = ({
  monthLabel,
}) => {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.label, { color: colors.textMuted }]}>
        📅 {monthLabel.toUpperCase()}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
});
