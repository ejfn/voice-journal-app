import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { formatTimer } from "../utils/paths";

interface RecordingModalProps {
  visible: boolean;
  durationSec: number;
  meteringLevel: number; // 0.0 to 1.0
  isPaused: boolean;
  isProcessing: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onCancel: () => void;
}

export const RecordingModal: React.FC<RecordingModalProps> = ({
  visible,
  durationSec,
  meteringLevel,
  isPaused,
  isProcessing,
  onPause,
  onResume,
  onStop,
  onCancel,
}) => {
  const { colors } = useTheme();
  // Array of 15 bars for waveform visualization
  const [waveformBars, setWaveformBars] = useState<number[]>(
    new Array(15).fill(0.1),
  );

  useEffect(() => {
    if (!visible) {
      setWaveformBars(new Array(15).fill(0.1));
      return;
    }

    if (isPaused) {
      setWaveformBars((prev) => [...prev.slice(1), 0.1]);
      return;
    }

    // Shift previous values and add current metering with subtle random variation for organic waveform feel
    const jitter = (Math.random() - 0.5) * 0.15;
    const barHeight = Math.max(0.1, Math.min(1.0, meteringLevel + jitter));
    setWaveformBars((prev) => [...prev.slice(1), barHeight]);
  }, [meteringLevel, visible, isPaused]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.65)" }]}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          {isProcessing ? (
            <View style={styles.processingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.processingTitle, { color: colors.text }]}>
                Analyzing with Gemini Flash...
              </Text>
              <Text style={[styles.processingSub, { color: colors.textMuted }]}>
                Extracting verbatim transcript, smart title, tags, and summary
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <View style={styles.recordingPill}>
                  <View
                    style={[
                      styles.recordDot,
                      {
                        backgroundColor: isPaused
                          ? colors.warning
                          : colors.danger,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.recordPillText,
                      { color: isPaused ? colors.warning : colors.danger },
                    ]}
                  >
                    {isPaused ? "PAUSED" : "RECORDING"}
                  </Text>
                </View>
              </View>

              {/* Centered Timer */}
              <Text style={[styles.timer, { color: colors.text }]}>
                {formatTimer(durationSec)}
              </Text>

              {/* Dynamic Waveform Bars */}
              <View style={styles.waveformContainer}>
                {waveformBars.map((heightFactor, index) => (
                  <View
                    key={index}
                    style={[
                      styles.waveformBar,
                      {
                        height: Math.max(8, heightFactor * 60),
                        backgroundColor: isPaused
                          ? colors.waveformBar
                          : colors.waveformActive,
                      },
                    ]}
                  />
                ))}
              </View>

              {/* Status Hint */}
              <Text style={[styles.statusHint, { color: colors.textMuted }]}>
                {isPaused
                  ? "Recording paused. Tap resume or finish to save."
                  : "Pause to take a break, or stop to process with Gemini"}
              </Text>

              {/* Circular Action Buttons */}
              <View style={styles.controlsRow}>
                {/* Large Round Pause/Resume Button */}
                <TouchableOpacity
                  style={[
                    styles.circleButton,
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={isPaused ? onResume : onPause}
                  activeOpacity={0.8}
                  accessibilityLabel={
                    isPaused ? "Resume recording" : "Pause recording"
                  }
                >
                  <Text
                    style={[styles.circleButtonIcon, { color: colors.text }]}
                  >
                    {isPaused ? "▶" : "⏸"}
                  </Text>
                  <Text
                    style={[styles.circleButtonLabel, { color: colors.text }]}
                  >
                    {isPaused ? "Resume" : "Pause"}
                  </Text>
                </TouchableOpacity>

                {/* Large Round Stop Button */}
                <TouchableOpacity
                  style={[
                    styles.circleButton,
                    styles.stopCircleButton,
                    { backgroundColor: colors.danger },
                  ]}
                  onPress={onStop}
                  activeOpacity={0.8}
                  accessibilityLabel="Stop recording and analyze"
                >
                  <Text
                    style={[
                      styles.circleButtonIcon,
                      { color: colors.textInverse },
                    ]}
                  >
                    ⏹
                  </Text>
                  <Text
                    style={[
                      styles.circleButtonLabel,
                      { color: colors.textInverse },
                    ]}
                  >
                    Stop
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Cancel Button */}
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onCancel}
                activeOpacity={0.7}
              >
                <Text style={[styles.cancelText, { color: colors.textMuted }]}>
                  Cancel Recording
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
    alignItems: "center",
  },
  processingContainer: {
    paddingVertical: 50,
    alignItems: "center",
  },
  processingTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 20,
    marginBottom: 8,
  },
  processingSub: {
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 16,
  },
  recordingPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 6,
  },
  recordDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  recordPillText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  timer: {
    fontSize: 48,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: 1,
    marginBottom: 20,
  },
  waveformContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 70,
    gap: 5,
    marginBottom: 16,
    width: "100%",
  },
  waveformBar: {
    width: 5,
    borderRadius: 3,
  },
  statusHint: {
    fontSize: 13,
    textAlign: "center",
    marginBottom: 28,
  },
  controlsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 36,
    marginBottom: 24,
  },
  circleButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  stopCircleButton: {
    borderWidth: 0,
  },
  circleButtonIcon: {
    fontSize: 24,
    marginBottom: 2,
  },
  circleButtonLabel: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: "500",
  },
});
