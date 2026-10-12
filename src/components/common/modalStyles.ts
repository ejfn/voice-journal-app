import { Platform, StatusBar, StyleSheet } from "react-native";

/**
 * Shared styles for full-screen modals (BinModal, SettingsModal, ReviewModal).
 *
 * `modalHeader` offsets the header below the Android status bar so modal
 * headers never clash with the top bar, and keeps header padding consistent
 * across all full-screen modals. Bottom sheets and centered dialogs
 * (RecordingModal, UpdateModal, ConfirmDialog) do not need this offset.
 */
export const modalStyles = StyleSheet.create({
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop:
      Platform.OS === "android" ? (StatusBar.currentHeight || 24) + 12 : 54,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
