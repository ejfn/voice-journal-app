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
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.textMuted }]}>
        {monthLabel.toUpperCase()}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
  },
  label: {
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
});
