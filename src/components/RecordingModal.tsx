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
import MaterialIcons from "@react-native-vector-icons/material-icons";
import { MIN_RECORDING_DURATION_SEC } from "../services/audio/AudioRecordingService";

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
  const canCancel = durationSec < MIN_RECORDING_DURATION_SEC;
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
      onRequestClose={() => {
        if (canCancel) {
          onCancel();
        }
      }}
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

                {canCancel ? (
                  <TouchableOpacity
                    onPress={onCancel}
                    style={[
                      styles.cancelHeaderButton,
                      {
                        backgroundColor: colors.surfaceAlt,
                        borderColor: colors.border,
                      },
                    ]}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="Discard recording"
                    testID="discard-recording-button"
                  >
                    <MaterialIcons
                      name="close"
                      size={20}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.cancelHeaderSpacer} />
                )}
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
                  ? durationSec < 3
                    ? "Recording paused (< 3s). Tap resume to continue, or discard."
                    : "Recording paused. Tap resume to continue, or stop to save."
                  : durationSec < 3
                    ? "Speak naturally. Minimum 3 seconds to save."
                    : "Speak naturally. Tap pause to take a break, or stop when finished."}
              </Text>

              {/* Action Buttons */}
              <View style={styles.controlsRow}>
                {/* Left: Pause / Resume */}
                <View style={styles.actionColumn}>
                  <View style={styles.buttonWrapper}>
                    <TouchableOpacity
                      style={[
                        styles.secondaryActionButton,
                        isPaused
                          ? {
                              backgroundColor: colors.primary,
                              borderColor: colors.primary,
                              shadowColor: colors.primary,
                            }
                          : {
                              backgroundColor: colors.surfaceAlt,
                              borderColor: colors.borderStrong,
                              shadowColor: "#000",
                            },
                      ]}
                      onPress={isPaused ? onResume : onPause}
                      activeOpacity={0.75}
                      accessibilityLabel={
                        isPaused ? "Resume recording" : "Pause recording"
                      }
                    >
                      {isPaused ? (
                        <MaterialIcons
                          name="play-arrow"
                          size={36}
                          color="#FFFFFF"
                          style={{ marginLeft: 2 }}
                        />
                      ) : (
                        <MaterialIcons
                          name="pause"
                          size={32}
                          color={colors.text}
                        />
                      )}
                    </TouchableOpacity>
                  </View>
                  <Text
                    style={[
                      styles.actionLabel,
                      isPaused
                        ? [styles.activeLabel, { color: colors.primary }]
                        : { color: colors.text },
                    ]}
                  >
                    {isPaused ? "Resume" : "Pause"}
                  </Text>
                </View>

                {/* Right: Stop */}
                <View style={styles.actionColumn}>
                  <View style={styles.buttonWrapper}>
                    <TouchableOpacity
                      style={[
                        styles.doneActionButton,
                        {
                          backgroundColor: colors.danger,
                          shadowColor: colors.danger,
                          opacity: durationSec < 3 ? 0.45 : 1,
                        },
                      ]}
                      onPress={onStop}
                      activeOpacity={0.8}
                      accessibilityLabel="Stop and save recording"
                    >
                      <MaterialIcons name="stop" size={34} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                  <Text
                    style={[
                      styles.actionLabel,
                      styles.doneLabel,
                      {
                        color: durationSec < 3 ? colors.textMuted : colors.text,
                      },
                    ]}
                  >
                    Stop
                  </Text>
                </View>
              </View>
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
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  cancelHeaderButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelHeaderSpacer: {
    width: 32,
    height: 32,
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
    justifyContent: "space-evenly",
    alignItems: "center",
    width: "100%",
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  actionColumn: {
    alignItems: "center",
    justifyContent: "center",
    width: 96,
    gap: 10,
  },
  buttonWrapper: {
    width: 84,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryActionButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  doneActionButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 4,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  doneLabel: {
    fontWeight: "600",
  },
  activeLabel: {
    fontWeight: "700",
  },
});
