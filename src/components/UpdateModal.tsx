import React, { useState } from "react";
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
import { AppUpdateInfo } from "../services/updates/updateService";

export interface UpdateModalProps {
  visible: boolean;
  updateInfo: AppUpdateInfo | null;
  onDismiss: (hideFor7Days: boolean) => void;
  onUpdate: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  visible,
  updateInfo,
  onDismiss,
  onUpdate,
}) => {
  const { colors, isDark } = useTheme();
  const [dontRemind, setDontRemind] = useState<boolean>(false);

  if (!visible || !updateInfo) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => onDismiss(dontRemind)}
    >
      <TouchableWithoutFeedback onPress={() => onDismiss(dontRemind)}>
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
              {/* Top Accent Icon Circle */}
              <View
                style={[
                  styles.iconContainer,
                  {
                    backgroundColor: isDark
                      ? "rgba(99, 102, 241, 0.15)"
                      : "rgba(79, 70, 229, 0.1)",
                  },
                ]}
              >
                <MaterialIcons
                  name="system-update"
                  size={28}
                  color={colors.primary}
                />
              </View>

              {/* Title & Description */}
              <Text style={[styles.title, { color: colors.text }]}>
                Update Available
              </Text>
              <Text style={[styles.message, { color: colors.textMuted }]}>
                A new version of Voice Journal ({updateInfo.tagName}) is
                available to download.
              </Text>

              {/* Tick box: Don't remind for 7 days */}
              <TouchableOpacity
                style={styles.checkboxRow}
                activeOpacity={0.7}
                onPress={() => setDontRemind((prev) => !prev)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: dontRemind }}
                accessibilityLabel="Don't remind for 7 days"
              >
                <MaterialIcons
                  name={dontRemind ? "check-box" : "check-box-outline-blank"}
                  size={22}
                  color={dontRemind ? colors.primary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.checkboxLabel,
                    {
                      color: dontRemind ? colors.text : colors.textMuted,
                    },
                  ]}
                >
                  Don&apos;t remind for 7 days
                </Text>
              </TouchableOpacity>

              {/* Action Buttons: Dismiss & Update */}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.dismissButton,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surfaceAlt,
                    },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => onDismiss(dontRemind)}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss update notification"
                >
                  <Text style={[styles.dismissText, { color: colors.text }]}>
                    Dismiss
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.updateButton,
                    { backgroundColor: colors.primary },
                  ]}
                  activeOpacity={0.7}
                  onPress={onUpdate}
                  accessibilityRole="button"
                  accessibilityLabel="Update Voice Journal"
                >
                  <MaterialIcons
                    name="open-in-new"
                    size={18}
                    color="#FFFFFF"
                    style={styles.updateIcon}
                  />
                  <Text style={styles.updateText}>Update</Text>
                </TouchableOpacity>
              </View>
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
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  dialogCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
    letterSpacing: -0.2,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 20,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 20,
  },
  checkboxLabel: {
    fontSize: 14,
    marginLeft: 10,
    fontWeight: "500",
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    gap: 12,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  dismissButton: {
    borderWidth: 1,
  },
  dismissText: {
    fontSize: 15,
    fontWeight: "600",
  },
  updateButton: {},
  updateIcon: {
    marginRight: 6,
  },
  updateText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
