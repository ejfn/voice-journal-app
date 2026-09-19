# VoiceJournal Feature Roadmap & GitHub Issues Plan
**Date:** 2026-09-20  
**Target Architecture:** Expo SDK 57 / React Native 0.81+  

---

## Overview

This plan defines 6 discrete, high-impact improvements to modernize VoiceJournal's icon ecosystem, recording UX, dialog styling, background AI processing, sync status transparency, and version tracking.

---

## 1. Migrate to `@react-native-vector-icons` & Eliminate All Emojis

### Motivation & Background
Per Expo's architectural advisory ([Moving away from @expo/vector-icons](https://expo.dev/blog/moving-away-from-expo-vector-icons)), `@expo/vector-icons` is being deprecated in favor of the modular `@react-native-vector-icons` family, which integrates directly with `expo-font` and reduces bundle size by up to ~4 MB. Simultaneously, replacing inconsistent system emoji characters with crisp vector icons elevates the visual polish across Android and iOS.

### Technical Implementation
- **Dependencies**:
  - Install `@react-native-vector-icons/material-icons` (or Lucide `@react-native-vector-icons/lucide`).
  - Remove `@expo/vector-icons`.
- **Icon Replacements**:
  - `EntryCard.tsx`: Replace emoji playback buttons (▶️, ⏸️), tags (🏷️), calendar (📅), and duration (⏱️) with Material/Lucide vector icons.
  - `RecordingModal.tsx`: Replace emoji microphone, waveforms, and control indicators with vector icons.
  - `ReviewModal.tsx`: Clean vector icons for edit, transcript, summary, audio waveform, and tags.
  - `SettingsModal.tsx`: Vector icons for Google Drive, sync actions, API keys, cache cleaner, and theme toggles.
  - `TimelineHeader.tsx`: Vector icons for search magnifying glass, filter funnel, calendar picker, and settings gear.

---

## 2. Fix Recording Screen Controls (Stop Button)

### Motivation & Background
Currently, the stop button in `RecordingModal` displays a tick/check icon. Users naturally associate a checkmark with "submit" or "approve", leading to confusion while recording.

### Technical Implementation
- Update `RecordingModal.tsx` control states:
  - **Recording**: Central pulsating indicator with distinct **Pause** (two vertical bars) and **Stop** (solid square) buttons.
  - **Paused**: Distinct **Resume** (microphone/record circle) and **Finish/Stop** (solid square) buttons.
  - Remove tick/check icon from the stop action.

---

## 3. Polish In-App Dialogs & Notification Feedback

### Motivation & Background
The app currently relies on unstyled `Alert.alert` dialogs for Google Sign-In, sync completion, and entry deletion. These interrupt user flow and look unbranded.

### Technical Implementation
- **Component**: Create a reusable `src/components/common/DialogModal.tsx` and `ToastNotification.tsx`:
  - **Delete Confirmation Dialog**: Themed modal with warning icon, entry title, "Cancel" and destructive "Delete" action.
  - **Sync Completed Feedback**: Subtle, non-blocking toast or snackbar at the bottom of the screen ("Sync complete &bull; 3 entries updated") that auto-dismisses after 2.5s.
  - **Sign Out / Cache Cleanup**: Themed confirmation prompts with matching theme palette.

---

## 4. Background Transcription Queue with `gemini-3.5-flash-lite`

### Motivation & Background
Currently, stopping a recording forces the user to wait in the recording screen while Gemini processes the audio. If the network is slow or unavailable, the user is trapped. Furthermore, `gemini-3.6-flash` is overkill and slower (~4.1s) compared to `gemini-3.5-flash-lite` (~1.3s, ~$8/mo at 5 hours/day).

### Technical Implementation
- **Model**: Hardcode `gemini-3.5-flash-lite` in `GeminiService.ts`.
- **Immediate Save**:
  - When the user taps Stop, write the audio file and insert the entry into SQLite immediately with `transcription_status = 'queued'`.
  - Close `RecordingModal` instantly, returning the user to the timeline.
- **Queue Service (`TranscriptionQueueService.ts`)**:
  - Background worker checks for entries where `transcription_status = 'queued'`.
  - When online, sends base64 audio to `gemini-3.5-flash-lite`.
  - On success: updates `title`, `transcript`, `tags`, `summary`, and sets `transcription_status = 'completed'`.
  - If offline or rate-limited: retains `queued` status and schedules retry when connectivity returns.
- **UI Indicators on `EntryCard`**:
  - `transcribing`: Subtle animated spinner or pulsing wave icon with text *"Transcribing..."*.
  - `queued`: Clock / pending icon with text *"Queued for transcription (offline)"*.
  - `completed`: Normal full headline and summary display.

---

## 5. Google Photos-Style Sync & Storage Status Indicators

### Motivation & Background
Users need immediate clarity on whether their audio files are stored locally, uploaded to Google Drive, or stored only in the cloud after LRU cache eviction.

### Technical Implementation
- **Storage & Sync States**:
  1. **Local-only** (`local_only`): Entry recorded on device, pending Google Drive backup. Icon: Device outline or cloud with slash.
  2. **Syncing** (`syncing`): Audio or metadata currently uploading. Icon: Cloud with animated/blue sync arrows.
  3. **Synced** (`synced`): Securely stored on Google Drive and cached locally. Icon: Green checkmark in cloud.
  4. **Cloud-only** (`cloud_only`): Local audio file evicted by LRU cleanup, but master copy resides in Drive. Icon: Cloud outline with download arrow. Tapping downloads and plays seamlessly.
- **Database Schema**:
  - Add or compute `storage_status` enum (`local_only | syncing | synced | cloud_only`) based on `drive_file_id`, `sync_status`, and local file existence.
- **Card Badge**:
  - Render a compact, clean badge on each `EntryCard` in the top-right corner.

---

## 6. Git Version & Commit Hash Injection (Tractor Pattern)

### Motivation & Background
Following the pattern in `../Tractor`, build versions should include the git commit hash (e.g. `v0.1.0-beta.12+a1b2c3d`) for precise traceability in bug reports and pre-releases.

### Technical Implementation
- **Utility (`src/utils/versioning.ts`)**:
  - Reads `Constants.expoConfig?.extra?.version || Constants.expoConfig?.version`.
  - In `__DEV__` mode, falls back to dev version with local git commit if available.
- **GitHub Actions Workflow Integration**:
  - Add `.github/actions/git-version/action.yml` (or adapt existing workflow).
  - Uses `git rev-parse --short HEAD` and `git rev-list --count` to compute the version string.
  - Injects `full-version` into `app.json` under `.expo.extra.version`.
- **UI**:
  - Display the full version label in `SettingsModal` footer.

---

## Created GitHub Issues

1. [#7 - feat(icons): migrate to @react-native-vector-icons and replace all emojis](https://github.com/ejfn/voice-journal-app/issues/7)
2. [#8 - fix(recorder): replace tick stop button with standard square stop icon](https://github.com/ejfn/voice-journal-app/issues/8)
3. [#9 - feat(ui): implement polished themed dialogs and toast notifications](https://github.com/ejfn/voice-journal-app/issues/9)
4. [#10 - feat(ai): background transcription queue with gemini-3.5-flash-lite & offline support](https://github.com/ejfn/voice-journal-app/issues/10)
5. [#11 - feat(sync): add Google Photos-style local/cloud/synced status indicators](https://github.com/ejfn/voice-journal-app/issues/11)
6. [#12 - ci(version): inject git commit hash into app version label via GitHub Actions](https://github.com/ejfn/voice-journal-app/issues/12)
