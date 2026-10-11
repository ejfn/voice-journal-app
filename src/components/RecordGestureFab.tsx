import React, { useRef } from "react";
import { View, StyleSheet, Animated, TouchableOpacity } from "react-native";
import MaterialIcons from "@react-native-vector-icons/material-icons";
import { useTheme } from "../theme/ThemeContext";

export interface RecordGestureFabProps {
  onStartRecording: () => void | Promise<void>;
  disabled?: boolean;
}

export const RecordGestureFab: React.FC<RecordGestureFabProps> = ({
  onStartRecording,
  disabled = false,
}) => {
  const { colors } = useTheme();
  const micScaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(micScaleAnim, {
      toValue: 0.92,
      tension: 150,
      friction: 6,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(micScaleAnim, {
      toValue: 1.0,
      tension: 150,
      friction: 6,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View
      style={styles.container}
      pointerEvents="box-none"
      testID="record-gesture-fab-container"
    >
      <TouchableOpacity
        onPress={() => {
          if (!disabled) {
            void onStartRecording();
          }
        }}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        activeOpacity={0.9}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="New Voice Recording"
        accessibilityHint="Tap to record voice"
        testID="mic-button"
      >
        <Animated.View
          style={[
            styles.micButton,
            {
              backgroundColor: colors.danger,
              shadowColor: colors.danger,
              transform: [{ scale: micScaleAnim }],
            },
          ]}
        >
          <MaterialIcons name="mic" size={28} color="#FFFFFF" />
        </Animated.View>
      </TouchableOpacity>
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
