import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
} from "react-native";
import MaterialIcons from "@react-native-vector-icons/material-icons";
import { useTheme } from "../theme/ThemeContext";

export interface ShareOptionsModalProps {
  visible: boolean;
  isAudioAvailable: boolean;
  isTranscriptAvailable: boolean;
  onShareAudio: () => void;
  onShareTranscript: () => void;
  onClose: () => void;
}

export const ShareOptionsModal: React.FC<ShareOptionsModalProps> = ({
  visible,
  isAudioAvailable,
  isTranscriptAvailable,
  onShareAudio,
  onShareTranscript,
  onClose,
}) => {
  const { colors } = useTheme();

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View
              style={[
                styles.dialogCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              {/* Header */}
              <View style={styles.headerRow}>
                <View style={styles.titleContainer}>
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: colors.surfaceAlt },
                    ]}
                  >
                    <MaterialIcons
                      name="share"
                      size={20}
                      color={colors.primary}
                    />
                  </View>
                  <Text style={[styles.title, { color: colors.text }]}>
                    Share Entry
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  style={styles.closeButton}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                >
                  <MaterialIcons
                    name="close"
                    size={20}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>

              {/* Options List */}
              <View style={styles.optionsContainer}>
                {/* Option 1: Audio Recording */}
                <TouchableOpacity
                  style={[
                    styles.optionItem,
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderColor: colors.border,
                      opacity: isAudioAvailable ? 1 : 0.5,
                    },
                  ]}
                  onPress={onShareAudio}
                  disabled={!isAudioAvailable}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Share audio recording"
                  accessibilityState={{ disabled: !isAudioAvailable }}
                >
                  <View
                    style={[
                      styles.optionIconContainer,
                      {
                        backgroundColor: colors.surface,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name="graphic-eq"
                      size={22}
                      color={
                        isAudioAvailable ? colors.primary : colors.textMuted
                      }
                    />
                  </View>
                  <View style={styles.optionTextContainer}>
                    <Text
                      style={[
                        styles.optionTitle,
                        {
                          color: isAudioAvailable
                            ? colors.text
                            : colors.textMuted,
                        },
                      ]}
                    >
                      Audio Recording
                    </Text>
                    <Text
                      style={[
                        styles.optionSubtitle,
                        { color: colors.textMuted },
                      ]}
                    >
                      {isAudioAvailable
                        ? ".m4a audio file"
                        : "Download from Drive to share"}
                    </Text>
                  </View>
                  <MaterialIcons
                    name="chevron-right"
                    size={20}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>

                {/* Option 2: Transcript */}
                <TouchableOpacity
                  style={[
                    styles.optionItem,
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderColor: colors.border,
                      opacity: isTranscriptAvailable ? 1 : 0.5,
                    },
                  ]}
                  onPress={onShareTranscript}
                  disabled={!isTranscriptAvailable}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Share transcript"
                  accessibilityState={{ disabled: !isTranscriptAvailable }}
                >
                  <View
                    style={[
                      styles.optionIconContainer,
                      {
                        backgroundColor: colors.surface,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name="description"
                      size={22}
                      color={
                        isTranscriptAvailable
                          ? colors.primary
                          : colors.textMuted
                      }
                    />
                  </View>
                  <View style={styles.optionTextContainer}>
                    <Text
                      style={[
                        styles.optionTitle,
                        {
                          color: isTranscriptAvailable
                            ? colors.text
                            : colors.textMuted,
                        },
                      ]}
                    >
                      Transcript
                    </Text>
                    <Text
                      style={[
                        styles.optionSubtitle,
                        { color: colors.textMuted },
                      ]}
                    >
                      {isTranscriptAvailable
                        ? "Verbatim text"
                        : "No transcript available"}
                    </Text>
                  </View>
                  <MaterialIcons
                    name="chevron-right"
                    size={20}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>

              {/* Cancel Button */}
              <TouchableOpacity
                style={[
                  styles.cancelButton,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                  },
                ]}
                onPress={onClose}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  dialogCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  titleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  closeButton: {
    padding: 4,
  },
  optionsContainer: {
    gap: 12,
    marginBottom: 16,
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  optionIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  optionSubtitle: {
    fontSize: 12,
  },
  cancelButton: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
