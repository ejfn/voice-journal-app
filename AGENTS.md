# AGENTS.md

This file provides guidance and constraints for coding agents working in this repository.

## Core Agent Rules

- **Do Not Commit Until Asked**: Never commit code changes automatically. Do NOT run `git commit` unless the user explicitly requests you to commit.
- **Android Only at this stage**: Development, native modules, background recording, and notifications target Android exclusively at this stage. Do not spend effort or adapt workflows for iOS.
- **Expo HAS CHANGED**: Read the exact versioned documentation at https://docs.expo.dev/versions/v57.0.0/ before writing any code. Never use deprecated APIs (e.g. `expo-av`, `@expo/vector-icons`).
- **No Monitoring Pull Requests**: Do not watch, wait for, or poll GitHub pull request checks (`gh pr checks`, `gh pr checks --watch`, etc.) after creating a PR or pushing commits. Once created/pushed, provide the PR link and stop immediately without waiting for CI to finish.
- **Git Safety**: Never commit directly to the `main` branch.
- **Quality Checks**: Verify changes with `npm run qualitycheck` (or `npm run config:check`, `npm run typecheck`, `npm run lint`, and `npm test`) before concluding tasks.
- **No Shallow UI Component Tests**: Do NOT add shallow UI component unit tests that merely test mocks over mocks (e.g. `react-test-renderer` asserting props or mock buttons on mocked components). Tests must focus on real business logic, state machines, DAOs, services, and algorithms.
- **Pre-Push Code Review**: Before pushing a feature branch or creating a PR, run the local `code-review` skill (`.agents/skills/code-review/`) on the full diff against the base branch (e.g. `git diff main...HEAD`). Every [MUST FIX] finding must be resolved or explicitly refuted with evidence before pushing; [SHOULD FIX] and below are advisory. The skill's findings are subject to the same verification discipline as any AI reviewer (see "Verifying AI Code Review Claims" below). (`.github/skills/code-review/` is a separate skill that calibrates GitHub Copilot's reviews on GitHub — not for local use.)

## Project Overview

**Voice Journal** is a zero-subscription mobile voice diary application built with React Native and Expo (SDK 57).

- **Platform**: Android only (at this stage)
- **Tagline**: _Speak your mind. AI captures the rest._
- **Core Capabilities**: Custom native Android audio recording service with dynamic background notification controls, offline-first SQLite database with FTS5 search, background transcription with Gemini (`gemini-flash-lite-latest`, BYOK), on-demand Google Drive synchronization with LRU caching, and Google Photos-style storage status badges.

## Documentation References

- [README.md](README.md) - Project overview, features, and setup

## Setup & Verification Commands

```bash
# Install dependencies
npm install

# Start development server
npm run start         # Injects dev version and starts Expo
npm run start:dev     # Starts with --dev-client
npm run android       # Launch on Android

# Quality checks
npm run qualitycheck  # Runs config:check, typecheck, lint, and test:silent in sequence
npm run typecheck     # tsc --noEmit
npm run lint          # expo lint src/ __tests__/ App.tsx index.ts
npm test              # jest
npm run test:silent   # jest --silent
```

## Architecture & Code Organization

```
src/
├── components/          # UI components & screens
│   ├── common/          # Reusable UI primitives (ConfirmDialog, Toast)
│   ├── DayGroupHeader.tsx
│   ├── EntryCard.tsx    # Timeline card with playback & storage status
│   ├── MonthSectionHeader.tsx
│   ├── RecordingModal.tsx
│   ├── ReviewModal.tsx
│   ├── SettingsModal.tsx
│   ├── TagFilterChips.tsx
│   └── TimelineHeader.tsx
├── db/                  # SQLite database layer
│   ├── dao/             # Data Access Objects (entriesDao, syncQueueDao, deletedEntriesDao, settingsDao)
│   ├── database.ts      # SQLite connection initialization (expo-sqlite)
│   └── schema.ts        # Table definitions, FTS5 virtual table, triggers, and migrations
├── services/            # Business logic & external services
│   ├── ai/              # GeminiService (gemini-flash-lite-latest) & TranscriptionQueueService
│   ├── audio/           # AudioRecordingService, AudioPlaybackService (expo-audio)
│   └── drive/           # GoogleDriveService, UploadQueueService, SmartSyncService
├── theme/               # Semantic color definitions and ThemeContext (Light/Dark/Auto)
└── utils/               # Path resolvers, storageStatus helpers, uuid, versioning
```

### Test Directory Structure (`__tests__/`)

- `__tests__/helpers/testDb.ts`: Node-compatible SQLite in-memory database mock using `better-sqlite3` mimicking `expo-sqlite`.
- Unit and integration tests for DAOs, SmartSync, UploadQueue, TranscriptionQueue, GeminiService, storage status, and paths.

## Key Design Principles & Conventions

### 1. Modern Expo SDK 57 & Audio

- **Use `expo-audio`**: Always use `expo-audio` for recording and playback (`createAudioPlayer`, `AudioRecorder`). Do NOT use deprecated `expo-av`.
- **Resource Cleanup**: Always release audio player and recorder instances (`player.removeListener()`, player release/stop) to prevent memory leaks or audio ducking bugs.

### 2. UI, Icons & Dialogs

- **Vector Icons**: Use `@react-native-vector-icons/material-icons`. Never use system emoji characters (e.g., ▶️, 🎙️, ⚙️) or `@expo/vector-icons` for functional controls.
- **Themed Dialogs**: Never use raw `Alert.alert` for user confirmations or notifications. Use `src/components/common/ConfirmDialog.tsx` and `src/components/common/Toast.tsx`.
- **Theme Awareness**: Consume `useTheme()` from `src/theme/ThemeContext.tsx` and reference palette colors from `src/theme/colors.ts`.

### 3. Offline-First & Data Persistence

- **DAO Pattern**: All database interactions must go through DAOs (`src/db/dao/*`). Never execute raw SQL queries directly in UI components or services.
- **Immediate Local Writes**: User actions (recording save, edit, delete) persist to local SQLite immediately.
- **FTS5 Search**: Full-text search queries utilize the `entries_fts` SQLite virtual table via `entriesDao.ts`.

### 4. Background AI & Cloud Sync Queues

- **Gemini Transcription**: Use `gemini-flash-lite-latest` in `GeminiService.ts` for fast, cost-effective audio transcription and structured metadata extraction (title, summary, transcript, tags).
- **Background Transcription Queue**: On recording completion, entry is saved immediately with `transcription_status = 'queued'`. `TranscriptionQueueService` processes entries in the background with graduated exponential backoff.
- **Dedicated Upload Queue**: `UploadQueueService` manages background uploads to Google Drive (`VoiceJournal/YYYY/MM/`).
- **Storage Status**: Compute and display storage states on cards using `src/utils/storageStatus.ts`:
  - `local_only`: Recorded on device, pending backup.
  - `syncing`: Audio/metadata uploading.
  - `synced`: Backed up to Google Drive and cached locally.
  - `cloud_only`: Evicted locally by LRU, available in Drive (auto-download on play).

### 5. Type Safety & Code Quality

- Strict TypeScript: No `any` where avoidable. Use explicit interfaces and types.
- Always check that changes pass `npm run qualitycheck` before finishing.

### 6. Promise Hygiene (lint-enforced)

- **No fire-and-forget promises**: Any promise-returning call must be `await`ed, end with `.catch(...)`, or be explicitly marked with the `void` operator. This is enforced by the type-aware `@typescript-eslint/no-floating-promises` ESLint rule (error severity).
- **`.catch` for side-effect calls**: Calls like `uploadQueueService.enqueueUpload(...)` that can reject (SQLite failures) must attach a `.catch` that logs (`console.warn`).
- **`void` only for never-rejecting loaders**: `void loadData()` is acceptable only when the function has an internal try/catch and cannot reject.
- **Fix at the origin when possible**: If callers cannot meaningfully handle a helper's rejection (e.g. `handleRecordingStatusUpdate` catches `handleExternalStop` failures internally so its native-listener call sites stay simple), handle the rejection inside the helper.

### 7. Verifying AI Code Review Claims

- **Never accept an AI reviewer claim (e.g. GitHub Copilot) at face value** — especially severity labels, which are frequently inflated or based on outdated SDK knowledge.
- **Config/plugin claims**: Disprove or confirm with `npm run config:check` (runs `expo config --type prebuild`). If it passes, the config and all plugins resolve; claims of "invalid plugin / prebuild failure" are false.
- **"Missing test" claims**: Verify with `grep` against `__tests__/` before writing a duplicate test; verify "pattern X exists" claims against `main` before treating new code as introducing a novel pattern.
- **Dependency/API claims**: Check the installed version in `node_modules/<pkg>` and the versioned docs at https://docs.expo.dev/versions/v57.0.0/ — AI reviewers often have stale knowledge of older SDK versions.

## Git & PR Workflow

```bash
# 1. Create feature branch
git checkout -b ejfn/feature-name

# 2. Commit changes (when user requests)
git add . && git commit -m "feat(scope): descriptive message"

# 3. Self-review with the local code-review skill (resolve or refute all MUST FIX)
# 4. Push and create PR
git push origin ejfn/feature-name -u
GITHUB_TOKEN= gh pr create --title "feat(scope): descriptive title" --body "Summary of changes"
```

- **Commit Message Style**: Conventional Commits (`feat:`, `fix:`, `style:`, `refactor:`, `test:`, `docs:`, `ci:`).
- **GitHub CLI**: Prepend `GITHUB_TOKEN= ` before `gh` commands if `GITHUB_TOKEN` is misconfigured in the environment.
- **Remember**: Do NOT wait for PR checks or CI! Stop immediately after posting the PR link.
