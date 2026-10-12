---
name: code-review
description: Review standards for the Voice Journal repository (React Native, Expo SDK 57, Android-only). Use for every code review in this repository — covers severity calibration, verifying claims before flagging, what CI already catches, and repo conventions.
---

# Code Review Standards — Voice Journal

Review changes with severity-classified, actionable findings. Report only what
matters; never dump line-by-line commentary. Verify every claim before flagging
it — an unverified finding is worse than no finding.

## Before flagging anything, verify the claim

This repository has been burned by unverified review claims (e.g. "expo-sharing
does not provide a config plugin" — false for SDK 57; the package ships
`app.plugin.js` and `expo config --type prebuild` resolves it). So:

- **Config / plugin claims**: CI runs `npm run config:check` (which executes
  `expo config --type prebuild`) on every PR. If it is green, plugin and config
  resolution works. Never claim "invalid plugin", "prebuild failure", or "EAS
  build failure" without a failing command as evidence.
- **Dependency / API claims**: This repo is on **Expo SDK 57**. Verify against
  the installed package in `node_modules/<package>` and the versioned docs at
  https://docs.expo.dev/versions/v57.0.0/ — never assume behavior from older
  SDK versions. Deprecated-API claims (e.g. "expo-av") are only valid if the
  deprecated package is actually imported.
- **"This pattern is new / introduced by this PR" claims**: Check whether the
  pattern already exists on the base branch (`main`) before treating new code
  as introducing it. Flagging a pre-existing repo convention as a new defect
  is noise.
- **"Missing test" claims**: Grep `__tests__/` for the behavior first.

## Severity calibration

Copilot labels findings High / Medium / Low. Calibrate strictly:

- **Do NOT flag new native modules, config plugin entries, or native
  dependency additions as blocking OTA/release concerns.** Noting "this
  requires a new binary before it reaches existing installs" is at most a
  Low-severity remark, and only when the change could realistically reach
  users via OTA before a build exists. Routine native changes on `main` are
  expected and fine; release/OTA sequencing is an owner decision.
- A finding about code that follows an existing codebase convention is a
  Low-severity style note at most, not a blocking defect.
- Reserve High severity for: data loss, correctness bugs (broken logic,
  unrecoverable states), security issues, or violations of the repo rules
  below. An inconvenience, a theoretical edge case, or a stylistic
  preference is never High.
- One finding, one issue. State the consequence ("this leaks the recorder
  instance, causing audio ducking on the next playback"), not just the rule.

## Do not re-report what CI already catches

CI runs `npm run qualitycheck` on every PR:

- `tsc --noEmit` (strict TypeScript)
- ESLint, including type-aware `@typescript-eslint/no-floating-promises`
  (error) — unhandled promise rejections are already lint-enforced
- jest (300+ tests)
- `expo config --type prebuild` (config/plugin validation)

Do not report type errors, lint violations, formatting, test failures, or
config resolution issues. Review only what machines cannot judge: race
conditions, data-safety invariants, security, design, and test *adequacy* for
new concurrency logic.

## Repo rules (violations are the only reliable High findings)

- **Android only.** Do not review for or suggest iOS adaptations.
- **Audio**: `expo-audio` only, never `expo-av`. Players, recorders, and
  listeners must be released to prevent audio-ducking and memory leaks.
- **Icons**: `@react-native-vector-icons/material-icons`. Never system emoji
  characters or `@expo/vector-icons`.
- **Dialogs**: `src/components/common/ConfirmDialog.tsx` and
  `src/components/common/Toast.tsx` — never raw `Alert.alert`. Themed colors
  via `useTheme()` from `src/theme/ThemeContext.tsx`.
- **Database**: all access via `src/db/dao/*` (DAO pattern). Never raw SQL in
  UI components or services. FTS5 search goes through `entriesDao`.
- **Tests**: real business logic only (DAOs, queues, state machines,
  algorithms). Never suggest shallow UI component tests over mocks.

## What to check, in priority order

1. **Correctness** — logic errors, race conditions (especially queue/backoff
   logic in `UploadQueueService`, `TranscriptionQueueService`,
   `SmartSyncService`), off-by-one, null paths, broken state transitions.
2. **Data safety** — offline-first invariants (user actions persist locally
   immediately), FTS5 trigger correctness, Drive upload/LRU eviction
   correctness, BYOK Gemini key handling (never log the API key).
3. **Security** — injection, path traversal on file names, secrets in code
   or logs, over-permissive Drive scopes.
4. **Performance** — unnecessary re-renders in list components, O(n²) over
   entries, synchronous disk/network work on the JS thread during recording
   or playback.
5. **Tests** — new concurrency-critical logic (flags, coalescing, re-entrancy
   guards) should come with a regression test; a missing one is Medium at
   most.
