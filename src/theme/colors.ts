export interface ThemeColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceHover: string;
  text: string;
  textMuted: string;
  textInverse: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryActive: string;
  accent: string;
  danger: string;
  warning: string;
  success: string;
  chipBackground: string;
  chipSelected: string;
  waveformBar: string;
  waveformActive: string;
}

export const lightColors: ThemeColors = {
  background: "#F8F9FA",
  surface: "#FFFFFF",
  surfaceAlt: "#F1F3F5",
  surfaceHover: "#E9ECEF",
  text: "#1A1D20",
  textMuted: "#6C757D",
  textInverse: "#FFFFFF",
  border: "#E2E6EA",
  borderStrong: "#CED4DA",
  primary: "#0D6EFD",
  primaryActive: "#0B5ED7",
  accent: "#7950F2",
  danger: "#DC3545",
  warning: "#F59F00",
  success: "#198754",
  chipBackground: "#E9ECEF",
  chipSelected: "#0D6EFD",
  waveformBar: "#CBD5E1",
  waveformActive: "#0D6EFD",
};

export const darkColors: ThemeColors = {
  background: "#121417",
  surface: "#1A1D21",
  surfaceAlt: "#23272D",
  surfaceHover: "#2C323B",
  text: "#F1F3F5",
  textMuted: "#9BA3AF",
  textInverse: "#121417",
  border: "#2C3138",
  borderStrong: "#3D4450",
  primary: "#3B82F6",
  primaryActive: "#2563EB",
  accent: "#9775FA",
  danger: "#EF4444",
  warning: "#FBBF24",
  success: "#22C55E",
  chipBackground: "#262A30",
  chipSelected: "#3B82F6",
  waveformBar: "#374151",
  waveformActive: "#60A5FA",
};
