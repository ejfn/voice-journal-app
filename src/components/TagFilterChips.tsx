import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";

interface TagFilterChipsProps {
  tags: string[];
  selectedTag: string;
  onSelectTag: (tag: string) => void;
}

export const TagFilterChips: React.FC<TagFilterChipsProps> = ({
  tags,
  selectedTag,
  onSelectTag,
}) => {
  const { colors } = useTheme();

  const allTags = ["all", ...tags.filter((t) => t.toLowerCase() !== "all")];

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {allTags.map((tag) => {
          const isSelected = selectedTag.toLowerCase() === tag.toLowerCase();
          return (
            <TouchableOpacity
              key={tag}
              style={[
                styles.chip,
                {
                  backgroundColor: isSelected ? colors.primary : colors.surface,
                  borderColor: isSelected ? colors.primary : colors.border,
                },
              ]}
              onPress={() => onSelectTag(tag)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color: isSelected ? "#FFFFFF" : colors.textMuted,
                    fontWeight: isSelected ? "600" : "500",
                  },
                ]}
              >
                {tag === "all" ? "All" : tag.toLowerCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 2,
    elevation: 1,
  },
  chipText: {
    fontSize: 13,
  },
});
