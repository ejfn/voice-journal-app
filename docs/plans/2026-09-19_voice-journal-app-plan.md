# Implementation Plan: Voice Journal App (VoiceJournal)

## Goal Description
Build the `voice-journal-app` (branded as **VoiceJournal** / **Voice Journal**) according to the technical specification in [voice-journal-app-complete-spec.pdf](file:///home/eric/Downloads/voice-journal-app-complete-spec.pdf), while adopting the CI/CD, versioning, release automation, and Dev Client architecture from [Tractor](file:///home/eric/repos/Tractor).

The application is an Android-targeted zero-subscription voice diary combining:
1. Native audio capture (pause, resume, stop, audio metering) with prominent circular hit targets, and multi-file SAF audio import (e.g. Google Recorder).
2. Direct audio-to-structured JSON extraction using Gemini Flash multimodal AI (title, transcript, tags in all-lowercase without `#` prefix like `school`, `science`, `poster`, summary).
3. Local relational database with FTS5 full-text search (`expo-sqlite`).
4. **Multiple Clips Per Day Support**:
   - Each voice note is an independent clip with its own UUID, exact timestamp (`HH:mm`), audio file, transcript, and AI summary.
   - Timeline groups clips by Month (`September 2026`) and Day (`Saturday, Sep 19`), stacking multiple clips recorded on the same day chronologically.
5. **Unified Single-Pane Layout** (No dual-pane complexity):
   - Consistent, clean single-pane layout across all devices (phones, foldables, tablets) with centered max-width content container for wide screens.
6. **Calendar/Month Hierarchical Google Drive Storage** (`VoiceJournal/YYYY/MM/`):
   - Files are organized hierarchically by year and month (e.g., `VoiceJournal/2026/09/{entry_id}.m4a` and `VoiceJournal/2026/09/{entry_id}.json`).
   - Pure file-based sync with no `appProperties` (eliminates 124-byte limits and drift).
7. **Comprehensive Scrolling Ergonomics**:
   - Pull-to-refresh on timeline `SectionList`.
   - Scrollable transcript and summary reader with `ScrollView` and `KeyboardAvoidingView` so long entries and keyboard interactions never clip.
   - Generous bottom content padding so floating action buttons (`+ New Recording`, `Import Audio Files`) never obscure list items.
8. On-demand audio streaming/caching with LRU cache eviction (>500MB / >30 days).
9. Comprehensive Light / Dark theme system with user toggle and default set to system auto.
10. Tractor's exact CI/CD workflows, semantic git version injection (`git-version` action), local dev versioning (`inject-dev-version.js`), and EAS Dev Client configuration.
11. Pure **agy** setup: removal of `CLAUDE.md` and `.claude/` directory in favor of `AGENTS.md` (Completed).
12. GitHub repository initialization under user `ejfn` via `gh` (Completed: `https://github.com/ejfn/voice-journal-app`).

---

## User Review & Configuration Context

> [!NOTE]
> **GitHub Repository (Completed)**: The public GitHub repository `ejfn/voice-journal-app` has been initialized and pushed on branch `main`.
>
> **EAS Project ID**: EAS workflows require an Expo project ID in `app.json` (`extra.eas.projectId`) and an `EXPO_TOKEN` secret in GitHub repository settings. We will configure placeholders and template scripts aligned with Tractor.
>
> **Gemini API & Google Drive OAuth**: Gemini Flash API key (`EXPO_PUBLIC_GEMINI_API_KEY`) and Google Sign-In web client ID (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`) will be managed via `.env` and runtime config. Direct REST API calls will be used for Gemini multimodal audio analysis to ensure full compatibility with the React Native Hermes engine.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph AudioEngine ["Audio and SAF Layer (Expo SDK 57)"]
        Mic["Microphone Input"] -->|"expo-audio (RecordingPresets.HIGH_QUALITY)"| RecService["AudioRecordingService"]
        ExtFiles["Google Recorder Files"] -->|"expo-document-picker / SAF"| ImportService["AudioImportService"]
        RecService --> SandboxFiles["Sandboxed Audio: audio/YYYY/MM/*.m4a"]
        ImportService --> SandboxFiles
    end

    subgraph AIProcessing ["Gemini Flash Multimodal (Hermes Compatible)"]
        SandboxFiles -->|"Base64 inlineData via REST API"| GeminiClient["Gemini AIService"]
        GeminiClient -->|"Structured JSON (title, transcript, tags, summary)"| DBRepo
    end

    subgraph StorageLayer ["expo-sqlite Database"]
        DBRepo[("SQLite: entries table")]
        FTS[("SQLite: entries_fts FTS5")]
        Outbox[("SQLite: sync_queue table")]
        DBRepo -.->|"FTS5 Triggers"| FTS
    end

    subgraph CloudSync ["Google Drive v3 (Calendar Hierarchy: YYYY/MM)"]
        GoogleAuth["Google Sign-In"] -->|"drive.file OAuth2"| DriveClient["DriveSyncService"]
        Outbox -->|"Upload to VoiceJournal/YYYY/MM/"| DriveClient
        DriveClient -->|"Hydrate SQLite from .json"| DBRepo
        DriveClient -->|"On-Demand Audio Download"| SandboxFiles
        LRUWorker["LRU Eviction Worker"] -->|"Evict >500MB / >30 days"| SandboxFiles
    end

    subgraph TimelineUI ["Theme & Multi-Clip Timeline UI"]
        ThemeContext["ThemeContext (auto / light / dark)"] --> UIComponents
        subgraph UIComponents ["Single-Pane Responsive UI"]
            TimelineSection["SectionList (Month / Day / Multi-Clips)"]
            RecordingModal["RecordingModal (Circular Controls)"]
            ReviewScreen["Review & Player Screen (Scrollable)"]
        end
    end

    subgraph CICDPattern ["Tractor CI/CD and Dev Client"]
        GitVersion["git-version composite action"] -->|"Injects version info"| AppJson["app.json"]
        DevVersion["scripts/inject-dev-version.js"] -->|"Generates local stamp"| LocalDev["src/dev-version.json"]
        EASBuild["eas.json (development, preview, production)"]
    end
```

---

## Multi-Clip Per Day Design

When a user records multiple times in a day (e.g. morning, afternoon, night):

```
📅 SEPTEMBER 2026
  │
  ├── 🗓️ Saturday, Sep 19
  │     ├── [Clip 1] 19:42 • 1m 45s  "Science poster prep"      (Audio Cached)
  │     │   "Finished presentation poster for science class..."
  │     │   [School] [Science]
  │     │
  │     └── [Clip 2] 09:15 • 0m 45s  "Morning coffee & run"       (Audio Cached)
  │         "Went for a 5k run before breakfast, feeling good..."
  │         [Sports] [Health]
  │
  └── 🗓️ Friday, Sep 18
        └── [Clip 1] 21:00 • 2m 10s  "Evening project reflection" (On Demand)
```

- Each clip maintains its own audio, duration, and Gemini AI summary.
- The UI nests multiple clips seamlessly under the day heading.
- Independent playback: tapping any clip plays that specific recording.

---

## Proposed Changes

### Component 1: Git & GitHub Repository Initialization & Cleanup [COMPLETED]

- **Purged Claude configuration**: Removed `CLAUDE.md` and `.claude/` directory in favor of pure Antigravity setup with [`AGENTS.md`](file:///home/eric/repos/voice-journal-app/AGENTS.md).
- **Configured `.gitignore`**: Established rules preventing commit of build artifacts (`node_modules/`, `.expo/`, `dist/`), native keys (`*.jks`, `*.p8`, `*.p12`, `*.key`), dev version file (`src/dev-version.json`), and environment files (`.env`, `.env*.local`).
- **GitHub Remote & Branch Setup**: Initial scaffolding committed to `main` and pushed to remote `https://github.com/ejfn/voice-journal-app.git`.

---

### Component 2: CI/CD, Versioning & EAS Configuration (Tractor Pattern)

#### [NEW] `eas.json`
Matches Tractor's EAS configuration with `developmentClient`, `preview`, and `production` channels:
```json
{
  "cli": {
    "version": ">= 19.0.5",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "APP_ENV": "development"
      }
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleRelease"
      },
      "env": {
        "NODE_ENV": "production"
      }
    },
    "production": {
      "channel": "production",
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleRelease"
      },
      "env": {
        "NODE_ENV": "production"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

#### [NEW] `scripts/inject-dev-version.js`
Exact script from Tractor: queries `git rev-parse HEAD` and latest `v*.*.0` tag, computes `v${baseVersion}-dev`, and writes to `src/dev-version.json`.

#### [NEW] `.github/actions/git-version/action.yml`
Exact composite action from Tractor:
- Calculates `full-version`, `version`, `runtime-version`, and `eas-branch` (`production`, `preview`, or `development`).
- Injects `version`, `runtimeVersion`, and `extra.version` directly into `app.json` via `jq`.

#### [NEW] `.github/workflows/pr-checks.yml`
Runs `npm ci` and `npm run qualitycheck` on PRs targeting `main`.

#### [NEW] `.github/workflows/build-dev-client.yml`
Triggered via `workflow_dispatch`. Injects version, overrides `app.json` name (`Voice Journal (Dev)`) and Android package (`com.personal.voicejournal.dev`), runs `eas build --platform android --profile development --wait`, and extracts build URL.

#### [NEW] `.github/workflows/build-apk.yml`
Triggered on GitHub release (`prereleased`, `released`) or manual dispatch. Runs `qualitycheck`, detects version via `git-version`, triggers `eas build --platform android --profile <branch>`, downloads built APK (`voice-journal-app-<version>.apk`), and uploads it to GitHub Release assets via `softprops/action-gh-release@v2`.

#### [NEW] `.github/workflows/ota-update.yml`
Triggered on push to `main` and manual dispatch. Runs `qualitycheck`, detects version via `git-version`, and publishes update via `eas update --branch ...`. (Dynamic test badge step from Tractor is omitted as badges are not needed for this project).

---

### Component 3: Project Configuration, Dependencies & Theming

#### [MODIFY] `package.json`
Add Tractor-aligned scripts and quality checking:
```json
{
  "name": "voice-journal-app",
  "version": "1.0.0",
  "main": "index.ts",
  "scripts": {
    "start:dev": "node scripts/inject-dev-version.js && expo start --dev-client",
    "start": "node scripts/inject-dev-version.js && expo start",
    "android": "node scripts/inject-dev-version.js && expo start --android",
    "ios": "node scripts/inject-dev-version.js && expo start --ios",
    "lint": "eslint src/ __tests__/",
    "test": "jest",
    "test:silent": "jest --silent",
    "typecheck": "tsc --noEmit",
    "qualitycheck": "npm-run-all typecheck lint test:silent"
  }
}
```

Dependencies to install:
- Runtime: `expo-audio`, `expo-file-system`, `expo-sqlite`, `expo-document-picker`, `expo-dev-client`, `expo-updates`, `@react-native-google-signin/google-signin` *(note: `expo-av` omitted as deprecated in SDK 57; `@google/genai` omitted in favor of direct REST API for Hermes compatibility)*
- Dev: `npm-run-all`, `jest`, `jest-expo`, `@types/jest`, `typescript`, `@types/react`, `eslint`, `eslint-config-expo`

#### [MODIFY] `app.json`
Configure neutral identifiers, plugins with explicit permissions, and automatic theme style:
- `name`: `"VoiceJournal"`
- `slug`: `"voice-journal-app"`
- `userInterfaceStyle`: `"automatic"` (allows OS-level light/dark theme switching)
- `android.package`: `"com.personal.voicejournal"`
- `permissions`: `["android.permission.RECORD_AUDIO"]`
- `plugins`:
  ```json
  [
    [
      "expo-audio",
      {
        "microphonePermission": "Allow VoiceJournal to access your microphone for journal recordings.",
        "enableBackgroundPlayback": true,
        "recordAudioAndroid": true
      }
    ],
    [
      "expo-sqlite",
      {
        "enableFTS": true
      }
    ],
    "@react-native-google-signin/google-signin",
    "expo-document-picker",
    "expo-updates"
  ]
  ```
- `runtimeVersion`: `"v1.0.0"`
- `updates.requestHeaders`: `{"expo-channel-name": "production"}`

#### [NEW] `src/theme/ThemeContext.tsx` & `src/theme/colors.ts`
- Theme modes: `'auto' | 'light' | 'dark'`, default set to `'auto'`.
- Subscribes to device color scheme with `useColorScheme()`.
- Design token system: `background`, `surface`, `surfaceAlt`, `text`, `textMuted`, `border`, `primary`, `danger`, `warning`, `success`.

---

### Component 4: Local Database & FTS5 (expo-sqlite)

#### [NEW] `src/db/schema.ts`
Implement SQL DDL migrations as specified in the PRD:
1. `entries` table: `id` (UUID text primary key), `title`, `summary`, `transcript`, `tags` (JSON text array, e.g. `["school", "science", "poster"]`), `duration_sec`, `source_type`, `local_audio_path`, `drive_audio_file_id`, `drive_sidecar_file_id`, `is_audio_cached`, `created_at`, `last_accessed_at`.
2. `entries_fts` virtual table using FTS5: `CREATE VIRTUAL TABLE entries_fts USING fts5(id UNINDEXED, title, transcript, summary, tags, tokenize = 'porter unicode61')`.
3. `sync_queue` table: `id`, `entry_id`, `action`, `status`, `retry_count`, `created_at`.
4. Triggers to keep `entries_fts` automatically in sync with `entries` (INSERT, UPDATE, DELETE).

#### [NEW] `src/db/database.ts`
Database connection manager and migration runner using `expo-sqlite` (new SDK 52+ `openDatabaseSync` / `openDatabaseAsync` API). For Jest unit test execution, provides a test-isolated adapter so tests run smoothly under Node.

#### [NEW] `src/db/dao/entriesDao.ts` & `src/db/dao/syncQueueDao.ts`
- `getEntries({ query, tag, limit, offset })`:
  - Free-text query: Executes FTS5 `MATCH ?` against `entries_fts` joined to `entries`.
  - Filter chip query: Executes exact tag query via SQLite `json_each(entries.tags)`:
    ```sql
    SELECT e.* FROM entries e, json_each(e.tags) WHERE json_each.value = ?
    ```
    (guarantees 100% exact tag matching without false positive substring matches).
- `getGroupedTimelineEntries({ query, tag })`: Returns entries grouped by Month (`September 2026`) and Day (`Saturday, Sep 19`) to support multiple clips per day chronologically.
- `insertEntry(entry)` / `updateEntry(entry)` / `deleteEntry(id)`
- `markAudioAccessed(id)`: Updates `last_accessed_at` for LRU cache tracking.
- `getPrunableCachedEntries()`: Fetches local entries whose audio can be purged if older than 30 days or cache is oversized (>500MB).

---

### Component 5: Audio Engine & External SAF Import (Pure expo-audio)

#### [NEW] `src/services/audio/AudioRecordingService.ts`
- Implemented purely with modern `expo-audio` (eliminates deprecated `expo-av`).
- Configures recording session with `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })`.
- Uses `RecordingPresets.HIGH_QUALITY` with `isMeteringEnabled: true`:
  - Output: High quality AAC in MPEG-4 container (`.m4a`).
  - Metering Normalization: Converts dB values (`-60` dB to `0` dB) to a normalized linear amplitude `0.0`–`1.0` via `Math.max(0, (meteringDb + 60) / 60)` for real-time waveform bars.
- Sandboxed Storage: Creates directory `FileSystem.documentDirectory + 'audio/YYYY/MM/'` with `{ intermediates: true }` and stores recording as `{entry_id}.m4a`.
- Provides pause, resume, stop, and status updates.

#### [NEW] `src/services/audio/AudioPlaybackService.ts`
- Audio playback controller using `expo-audio`'s `useAudioPlayer` / `createAudioPlayer`.
- Supports play, pause, seek (`seekTo`), and playback progress events (`currentTime`, `duration`).
- Transparently plays local audio or streams/caches on-demand audio.

#### [NEW] `src/services/audio/AudioImportService.ts`
- Uses `expo-document-picker` with `copyToCacheDirectory: true` and multi-file selection.
- Copies imported Google Recorder audio into local sandboxed calendar storage (`audio/YYYY/MM/{entry_id}.m4a`).
- Reads audio duration and enqueues entry for Gemini multimodal analysis.

---

### Component 6: Gemini Flash Multimodal AI Contract (Hermes Compatible)

#### [NEW] `src/services/ai/GeminiService.ts`
- Uses lightweight, direct HTTP `fetch` to Google's Gemini REST API endpoint:
  ```
  POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}
  ```
  *(Avoids heavy Node-only SDK polyfills like `@google/genai` to ensure full stability and fast execution on React Native's Hermes engine)*.
- Payload sends recorded `.m4a` audio as base64 in `inlineData` with `mimeType: "audio/mp4"`:
  ```json
  {
    "contents": [{
      "parts": [
        { "inlineData": { "mimeType": "audio/mp4", "data": "<base64_audio>" } },
        { "text": "Transcribe this audio recording verbatim, create a natural short headline title, generate 3-5 lowercase thematic tags without hashtags, and write a 1-sentence executive summary." }
      ]
    }],
    "generationConfig": {
      "responseMimeType": "application/json",
      "responseSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "description": "Short, natural diary headline (3-6 words)" },
          "transcript": { "type": "string", "description": "Verbatim transcript of speech, cleaned of filler words" },
          "tags": { "type": "array", "items": { "type": "string" }, "description": "Array of 3-5 relevant, lowercase tags without hashtags" },
          "summary": { "type": "string", "description": "1-sentence executive summary of the entry" }
        },
        "required": ["title", "transcript", "tags", "summary"]
      }
    }
  }
  ```
- Offline fallback: on network failure, enqueues item into `sync_queue` with action `ANALYZE_AND_UPLOAD`.

---

### Component 7: Google Drive Storage & Calendar/Month Hierarchical Sync

#### [NEW] `src/services/drive/GoogleDriveService.ts`
- Google OAuth2 authentication via `@react-native-google-signin/google-signin` with `https://www.googleapis.com/auth/drive.file`.
- **Folder ID Resolution & Hierarchy in Google Drive**:
  - Maintains an in-memory/cached mapping of resolved folder IDs (`VoiceJournal` -> `YYYY` -> `MM`) to avoid redundant API calls.
  - Idempotent folder query:
    `mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and '${parentId}' in parents and trashed = false`.
    If folder does not exist, creates it with `parents: [parentId]`.
  - Target hierarchy:
    ```
    VoiceJournal/
    └── YYYY/          (e.g., 2026)
        └── MM/        (e.g., 09)
            ├── {entry_id}.m4a
            └── {entry_id}.json
    ```
- **Multipart Upload**:
  - Uses `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` with metadata (`name`, `parents: [monthFolderId]`) and binary audio stream / JSON string.
  - Pure file-based sync: zero `appProperties` dependencies.
- **Timeline Hydration**:
  - Syncs `.json` sidecars across month folders, downloads new/missing JSON files (~2 KB each), and directly populates SQLite `entries` and `entries_fts`.
- **Audio On-Demand & LRU Eviction**:
  - Streams/downloads `{entry_id}.m4a` when tapped to local sandbox (`audio/YYYY/MM/{entry_id}.m4a`) and sets `is_audio_cached = 1`.
  - LRU Worker: Checks total audio cache size; if > 500MB or file > 30 days old, unlinks local `.m4a` while preserving SQLite record and setting `is_audio_cached = 0`.

---

### Component 8: Single-Pane Responsive Timeline & Scrolling UI

#### [NEW] `src/components/TimelineHeader.tsx` & `src/components/TagFilterChips.tsx`
- Search bar with instant FTS5 search and theme toggle indicator.
- Filter chips (`All`, `School`, `Sports`, `Imported`, etc.) in clean all-lowercase styling without `#` prefix.

#### [NEW] `src/components/MonthSectionHeader.tsx`, `src/components/DayGroupHeader.tsx` & `src/components/EntryCard.tsx`
- **Month Section Header**: Clean sticky header (`📅 September 2026`).
- **Day Group Subheader**: Displays date (`Saturday, Sep 19`) grouping that day's clips.
- **Entry Card**: Clip card showing title, exact time of recording (`19:42`), duration (`1m 45s`), summary snippet, tag badges, and audio status badge (`✓ Audio Cached` / `☁ On Demand`).

#### [NEW] `src/components/RecordingModal.tsx`
- Active recording overlay with enhanced ergonomics:
  - Centered circular timer: `01:45`
  - Dynamic audio metering waveform bars (`| | | | | | |`) fed by normalized linear amplitude.
  - Status text: "Pause to take a break, or stop to process with Gemini"
  - **Round / Circular Buttons for High Accessibility & Easy Hit**:
    - Large circular Pause / Resume button (`72x72` px, `borderRadius: 36`).
    - Large circular Stop button (`72x72` px, `borderRadius: 36`, red/crimson accent).
    - Centered Cancel text button.

#### [NEW] `src/components/ReviewModal.tsx` / `src/screens/ReviewScreen.tsx`
- **Full Smooth Scrolling**: Wrapped in `ScrollView` with `KeyboardAvoidingView` to easily view very long verbatim transcripts and AI summaries without clipping.
- Audio playback bar: `▶ 0:00 / 1:45 [========----] 🔊`
- Gemini Transcript & Summary display.
- Auto-generated clean tags & editable title.
- Primary CTA: `Save & Queue Sync`.

#### [MODIFY] `App.tsx`
Main application entry:
- Integrates `ThemeProvider` and unified single-pane layout.
- Timeline `SectionList` with pull-to-refresh (`refreshControl`) and extra bottom padding for floating action buttons.

---

## Verification Plan

### Automated Tests
1. **Quality Check Pipeline**:
   ```bash
   npm run qualitycheck
   ```
   Runs `typecheck` (`tsc --noEmit`), `lint` (`eslint src/ __tests__/`), and unit tests (`jest --silent`).
2. **Database & FTS5 Unit Tests**:
   - Verify table creation, FTS5 triggers, full-text search indexing, exact tag querying via `json_each`, and multi-clip day grouping queries in `__tests__/db.test.ts`.
3. **AI Schema Validation Unit Tests**:
   - Verify Gemini REST output parsing and clean lowercase tag validation (no `#`) in `__tests__/gemini.test.ts`.
4. **Calendar Hierarchy & Path Utilities Unit Tests**:
   - Verify year/month path generators (`audio/2026/09/...`) and audio metering normalization helper in `__tests__/path.test.ts`.
5. **CI/CD Workflow Validation**:
   - Validate YAML syntax of all GitHub workflows and composite action `git-version`.

### Manual Verification
1. Verify `scripts/inject-dev-version.js` generates `src/dev-version.json` with commit hash and version.
2. Verify local dev client start command (`npm run start:dev`).
3. Verify light/dark theme switching.
4. Verify recording multiple clips on the same day: each clip displays its exact recording time (`19:42`, `09:15`) under the shared date header (`Saturday, Sep 19`).
5. Verify smooth scrolling on timeline (pull-to-refresh) and review screen.
6. Verify recording modal: round/circular buttons, live metering waveform.
7. Verify Google Drive hierarchical folder creation (`VoiceJournal/YYYY/MM/`).
