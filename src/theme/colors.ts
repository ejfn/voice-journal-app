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
  background: "#F8FAFC",
  surface: "#FFFFFF",
  surfaceAlt: "#F1F5F9",
  surfaceHover: "#E2E8F0",
  text: "#0F172A",
  textMuted: "#64748B",
  textInverse: "#FFFFFF",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  primary: "#4F46E5",
  primaryActive: "#4338CA",
  accent: "#8B5CF6",
  danger: "#EF4444",
  warning: "#F59E0B",
  success: "#10B981",
  chipBackground: "#F1F5F9",
  chipSelected: "#4F46E5",
  waveformBar: "#E2E8F0",
  waveformActive: "#4F46E5",
};

export const darkColors: ThemeColors = {
  background: "#0B0F19",
  surface: "#111827",
  surfaceAlt: "#1F2937",
  surfaceHover: "#374151",
  text: "#F8FAFC",
  textMuted: "#94A3B8",
  textInverse: "#0B0F19",
  border: "#1F2937",
  borderStrong: "#374151",
  primary: "#6366F1",
  primaryActive: "#4F46E5",
  accent: "#A78BFA",
  danger: "#F87171",
  warning: "#FBBF24",
  success: "#34D399",
  chipBackground: "#1F2937",
  chipSelected: "#6366F1",
  waveformBar: "#1F2937",
  waveformActive: "#818CF8",
};
