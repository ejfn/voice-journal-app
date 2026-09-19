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
  // Array of 19 bars for waveform visualization
  const [waveformBars, setWaveformBars] = useState<number[]>(
    new Array(19).fill(0.1),
  );

  useEffect(() => {
    if (!visible) {
      setWaveformBars(new Array(19).fill(0.1));
      return;
    }

    if (isPaused) {
      setWaveformBars((prev) => [...prev.slice(1), 0.1]);
      return;
    }

    // Shift previous values and add current metering with subtle random variation for organic waveform feel
    const jitter = (Math.random() - 0.5) * 0.12;
    const barHeight = Math.max(0.12, Math.min(1.0, meteringLevel + jitter));
    setWaveformBars((prev) => [...prev.slice(1), barHeight]);
  }, [meteringLevel, visible, isPaused]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.6)" }]}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          {isProcessing ? (
            <View style={styles.processingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.processingTitle, { color: colors.text }]}>
                Processing Recording
              </Text>
              <Text style={[styles.processingSub, { color: colors.textMuted }]}>
                Transcribing audio and generating smart title & summary...
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <View
                  style={[
                    styles.recordingPill,
                    { backgroundColor: colors.surfaceAlt },
                  ]}
                >
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
                        height: Math.max(6, heightFactor * 54),
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
                  ? "Recording paused. Tap resume or stop to save."
                  : "Speak naturally. Pause or stop whenever you are ready."}
              </Text>

              {/* Action Buttons */}
              <View style={styles.controlsRow}>
                {/* Pause/Resume Button */}
                <TouchableOpacity
                  style={[
                    styles.circleButton,
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={isPaused ? onResume : onPause}
                  activeOpacity={0.75}
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

                {/* Stop Button */}
                <TouchableOpacity
                  style={[
                    styles.circleButton,
                    styles.stopCircleButton,
                    { backgroundColor: colors.danger },
                  ]}
                  onPress={onStop}
                  activeOpacity={0.75}
                  accessibilityLabel="Stop recording and save"
                >
                  <Text style={[styles.circleButtonIcon, { color: "#FFFFFF" }]}>
                    ⏹
                  </Text>
                  <Text
                    style={[styles.circleButtonLabel, { color: "#FFFFFF" }]}
                  >
                    Done
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Cancel Button */}
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onCancel}
                activeOpacity={0.7}
                hitSlop={{ top: 10, bottom: 10, left: 14, right: 14 }}
              >
                <Text style={[styles.cancelText, { color: colors.textMuted }]}>
                  Discard
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
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 44,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  processingContainer: {
    paddingVertical: 54,
    alignItems: "center",
  },
  processingTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 20,
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  processingSub: {
    fontSize: 13.5,
    textAlign: "center",
    paddingHorizontal: 20,
    lineHeight: 19,
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
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  timer: {
    fontSize: 52,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
    marginBottom: 18,
  },
  waveformContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 60,
    gap: 4,
    marginBottom: 16,
    width: "100%",
  },
  waveformBar: {
    width: 4,
    borderRadius: 2,
  },
  statusHint: {
    fontSize: 13,
    textAlign: "center",
    marginBottom: 26,
  },
  controlsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 32,
    marginBottom: 22,
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
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  stopCircleButton: {
    borderWidth: 0,
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  circleButtonIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  circleButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
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
