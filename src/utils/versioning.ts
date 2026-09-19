import Constants from "expo-constants";

// Attempt to load dev-version.json if generated in development
let devVersionInfo: { version: string; gitCommit: string } | undefined;
try {
  const devVersion = require("../dev-version.json");
  devVersionInfo = devVersion;
} catch {
  // dev-version.json might not exist in production or clean checkouts
  devVersionInfo = undefined;
}

export const getAppVersion = (): string => {
  // Only use dev version file in development mode
  if (__DEV__) {
    if (devVersionInfo?.version && devVersionInfo?.gitCommit) {
      return `${devVersionInfo.version}+${devVersionInfo.gitCommit.substring(0, 7)}`;
    }
    return "v0.1.0-dev";
  }

  // For production or published EAS builds, use injected config
  try {
    const version =
      Constants.expoConfig?.extra?.version || Constants.expoConfig?.version;
    if (version) {
      return version;
    }
  } catch {
    // Fallback if Constants is unavailable
  }

  return "v0.1.0";
};
