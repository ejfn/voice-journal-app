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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
                  backgroundColor: isSelected
                    ? colors.primary
                    : colors.surfaceAlt,
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
                    color: isSelected ? colors.textInverse : colors.text,
                    fontWeight: isSelected ? "600" : "400",
                  },
                ]}
              >
                {tag.toLowerCase()}
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
    paddingVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    textTransform: "lowercase",
  },
});
