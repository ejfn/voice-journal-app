import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  TouchableOpacity,
  GestureResponderEvent,
  PanResponderGestureState,
} from "react-native";
import MaterialIcons from "@react-native-vector-icons/material-icons";
import { useTheme } from "../theme/ThemeContext";
import { lightColors, darkColors } from "../theme/colors";

export interface RecordGestureFabProps {
  onStartRecording: () => void | Promise<void>;
  onImportAudio: () => void | Promise<void>;
  disabled?: boolean;
}

// Gesture timing and hit-box thresholds
export const HOLD_THRESHOLD_MS = 260;
export const TAP_DISPLACEMENT_MAX = 15;
export const EARLY_SLIDE_UP_THRESHOLD = -15;
export const DRAG_AWAY_THRESHOLD = 20;
export const TARGET_HIT_Y_MIN = -145;
export const TARGET_HIT_Y_MAX = -35;
export const TARGET_HIT_X_MAX = 50;

const getCurrentTime = (): number => Date.now();

export const RecordGestureFab: React.FC<RecordGestureFabProps> = ({
  onStartRecording,
  onImportAudio,
  disabled = false,
}) => {
  const { colors, isDark } = useTheme();
  // Swap theme colors for the import button: dark colors on light theme, light colors on dark theme
  const buttonColors = isDark ? lightColors : darkColors;

  const [isRevealed, setIsRevealed] = useState<boolean>(false);
  const [isTargetHovered, setIsTargetHovered] = useState<boolean>(false);

  const isRevealedRef = useRef<boolean>(false);
  const isTargetHoveredRef = useRef<boolean>(false);
  const isPressingRef = useRef<boolean>(false);
  const cancelledRef = useRef<boolean>(false);
  const pressStartTimeRef = useRef<number>(0);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Animated values
  const revealAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const targetScaleAnim = useRef(new Animated.Value(1)).current;
  const micScaleAnim = useRef(new Animated.Value(1)).current;

  const showImportTarget = () => {
    isRevealedRef.current = true;
    setIsRevealed(true);
    Animated.parallel([
      Animated.timing(revealAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 120,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const dismissImportTarget = () => {
    isRevealedRef.current = false;
    isTargetHoveredRef.current = false;
    setIsRevealed(false);
    setIsTargetHovered(false);
    Animated.parallel([
      Animated.timing(revealAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 20,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.spring(targetScaleAnim, {
        toValue: 1,
        tension: 150,
        friction: 6,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const setHovered = (hovered: boolean) => {
    if (isTargetHoveredRef.current !== hovered) {
      isTargetHoveredRef.current = hovered;
      setIsTargetHovered(hovered);
      Animated.spring(targetScaleAnim, {
        toValue: hovered ? 1.15 : 1.0,
        tension: 140,
        friction: 6,
        useNativeDriver: true,
      }).start();
    }
  };

  const checkIsOverTarget = (dx: number, dy: number): boolean => {
    return (
      dy <= TARGET_HIT_Y_MAX &&
      dy >= TARGET_HIT_Y_MIN &&
      Math.abs(dx) <= TARGET_HIT_X_MAX
    );
  };

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
      }
    };
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (evt: GestureResponderEvent) => {
        if (disabled) return;
        pressStartTimeRef.current =
          evt?.nativeEvent?.timestamp || getCurrentTime();
        isPressingRef.current = true;
        cancelledRef.current = false;
        isTargetHoveredRef.current = false;
        setIsTargetHovered(false);

        // Visual press feedback
        Animated.spring(micScaleAnim, {
          toValue: 0.92,
          tension: 150,
          friction: 6,
          useNativeDriver: true,
        }).start();

        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
        }
        holdTimerRef.current = setTimeout(() => {
          if (isPressingRef.current && !cancelledRef.current) {
            showImportTarget();
          }
        }, HOLD_THRESHOLD_MS);
      },

      onPanResponderMove: (
        _evt: GestureResponderEvent,
        gestureState: PanResponderGestureState,
      ) => {
        if (!isPressingRef.current || cancelledRef.current) return;

        const { dx, dy } = gestureState;

        if (!isRevealedRef.current) {
          if (dy < EARLY_SLIDE_UP_THRESHOLD) {
            // Intentional slide up before timer fires
            if (holdTimerRef.current) {
              clearTimeout(holdTimerRef.current);
              holdTimerRef.current = null;
            }
            showImportTarget();
          } else if (
            Math.abs(dx) > DRAG_AWAY_THRESHOLD ||
            dy > DRAG_AWAY_THRESHOLD
          ) {
            // Dragged sideways or downward
            if (holdTimerRef.current) {
              clearTimeout(holdTimerRef.current);
              holdTimerRef.current = null;
            }
            cancelledRef.current = true;
          }
        }

        if (isRevealedRef.current) {
          const isOver = checkIsOverTarget(dx, dy);
          setHovered(isOver);
        }
      },

      onPanResponderRelease: (
        evt: GestureResponderEvent,
        gestureState: PanResponderGestureState,
      ) => {
        isPressingRef.current = false;
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }

        Animated.spring(micScaleAnim, {
          toValue: 1.0,
          tension: 150,
          friction: 6,
          useNativeDriver: true,
        }).start();

        if (isRevealedRef.current) {
          const isOver =
            isTargetHoveredRef.current ||
            checkIsOverTarget(gestureState.dx, gestureState.dy);
          dismissImportTarget();

          if (isOver) {
            void onImportAudio();
          }
        } else {
          const currentTimestamp =
            evt?.nativeEvent?.timestamp || getCurrentTime();
          const pressDuration = currentTimestamp - pressStartTimeRef.current;
          const displacement = Math.hypot(gestureState.dx, gestureState.dy);

          if (
            !cancelledRef.current &&
            pressDuration < HOLD_THRESHOLD_MS &&
            displacement <= TAP_DISPLACEMENT_MAX
          ) {
            void onStartRecording();
          }
        }

        cancelledRef.current = false;
      },

      onPanResponderTerminate: () => {
        isPressingRef.current = false;
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        dismissImportTarget();
        Animated.spring(micScaleAnim, {
          toValue: 1.0,
          tension: 150,
          friction: 6,
          useNativeDriver: true,
        }).start();
        cancelledRef.current = false;
      },
    }),
  ).current;

  return (
    <View
      style={styles.container}
      pointerEvents="box-none"
      testID="record-gesture-fab-container"
    >
      {/* Revealed Import Audio Target */}
      <Animated.View
        style={[
          styles.importTargetWrapper,
          {
            opacity: revealAnim,
            transform: [{ translateY: slideAnim }, { scale: targetScaleAnim }],
          },
        ]}
        pointerEvents={isRevealed ? "auto" : "none"}
      >
        <View
          style={[
            styles.tooltipBadge,
            {
              backgroundColor: isTargetHovered
                ? buttonColors.primary
                : buttonColors.surfaceAlt,
              borderColor: isTargetHovered
                ? buttonColors.primaryActive
                : buttonColors.border,
            },
          ]}
          testID="import-tooltip"
        >
          <Text
            style={[
              styles.tooltipText,
              {
                color: isTargetHovered ? "#FFFFFF" : buttonColors.textMuted,
              },
            ]}
            testID="import-tooltip-text"
          >
            {isTargetHovered ? "Release to Import" : "Slide up to Import"}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => {
            dismissImportTarget();
            void onImportAudio();
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Import Audio Files"
          style={[
            styles.importButton,
            {
              backgroundColor: isTargetHovered
                ? buttonColors.primary
                : buttonColors.surface,
              borderColor: isTargetHovered
                ? buttonColors.primaryActive
                : buttonColors.border,
            },
          ]}
          testID="import-button"
        >
          <MaterialIcons
            name="file-download"
            size={24}
            color={isTargetHovered ? "#FFFFFF" : buttonColors.text}
          />
        </TouchableOpacity>
      </Animated.View>

      {/* Primary Microphone FAB */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.micButton,
          {
            backgroundColor: colors.danger,
            shadowColor: colors.danger,
            transform: [{ scale: micScaleAnim }],
          },
        ]}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="New Voice Recording"
        accessibilityHint="Tap to record voice, or hold and slide up to import audio files"
        accessibilityActions={[
          { name: "activate", label: "Record Voice" },
          { name: "import", label: "Import Audio" },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "import") {
            void onImportAudio();
          } else {
            void onStartRecording();
          }
        }}
        testID="mic-button"
      >
        <MaterialIcons name="mic" size={28} color="#FFFFFF" />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 58,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    pointerEvents: "box-none",
  },
  importTargetWrapper: {
    alignItems: "center",
    marginBottom: 14,
  },
  tooltipBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  tooltipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  importButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 4,
  },
  micButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
});
