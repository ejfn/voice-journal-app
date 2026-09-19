import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import MaterialIcons from "@react-native-vector-icons/material-icons";
import { useTheme } from "../../theme/ThemeContext";

export interface ToastOptions {
  message: string;
  icon?: string;
  type?: "success" | "info" | "warning" | "error";
  duration?: number;
}

interface ToastContextType {
  showToast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
});

export const useToast = (): ToastContextType => useContext(ToastContext);

interface ToastProviderProps {
  children: ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const { colors, isDark } = useTheme();
  const [toast, setToast] = useState<ToastOptions | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 20,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToast(null);
    });
  }, [opacity, translateY]);

  const showToast = useCallback(
    (options: ToastOptions) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      setToast(options);
      opacity.setValue(0);
      translateY.setValue(20);

      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();

      const duration = options.duration ?? 2800;
      timeoutRef.current = setTimeout(() => {
        hideToast();
      }, duration);
    },
    [opacity, translateY, hideToast],
  );

  const getIconName = (options: ToastOptions): string => {
    if (options.icon) return options.icon;
    switch (options.type) {
      case "error":
        return "error-outline";
      case "warning":
        return "warning";
      case "info":
        return "info-outline";
      case "success":
      default:
        return "check-circle";
    }
  };

  const getIconColor = (type?: string): string => {
    switch (type) {
      case "error":
        return colors.danger;
      case "warning":
        return "#F59E0B";
      case "info":
        return colors.primary;
      case "success":
      default:
        return "#10B981";
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastContainer,
            {
              opacity,
              transform: [{ translateY }],
            },
          ]}
        >
          <View
            style={[
              styles.toastBody,
              {
                backgroundColor: isDark ? "#27272A" : "#18181B",
                borderColor: isDark ? "#3F3F46" : "#27272A",
              },
            ]}
          >
            <MaterialIcons
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              name={getIconName(toast) as any}
              size={18}
              color={getIconColor(toast.type)}
              style={styles.toastIcon}
            />
            <Text style={styles.toastText} numberOfLines={2}>
              {toast.message}
            </Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
};

const styles = StyleSheet.create({
  toastContainer: {
    position: "absolute",
    bottom: 96,
    left: 20,
    right: 20,
    alignItems: "center",
    zIndex: 9999,
  },
  toastBody: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    maxWidth: "92%",
  },
  toastIcon: {
    marginRight: 10,
  },
  toastText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#FFFFFF",
    flexShrink: 1,
    lineHeight: 18,
  },
});
