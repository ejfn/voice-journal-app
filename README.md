# Voice Journal

A zero-subscription mobile voice diary application built with React Native and Expo. It features native audio recording, speech-to-structured metadata powered by Gemini Flash, local full-text search (FTS5 via `expo-sqlite`), and on-demand Google Drive synchronization.

## Features

- **Audio Capture**: Record, pause, resume, and play voice entries with real-time waveform metering and large touch targets.
- **Multimodal AI**: Automatically generates entry titles, executive summaries, verbatim transcripts, and lowercase tags via Gemini Flash.
- **Timeline Organization**: Groups entries chronologically by month and day, with support for multiple clips per day.
- **Offline-First**: Local SQLite database with FTS5 virtual table for instant offline full-text search.
- **Google Drive Sync**: Pure file-based synchronization (`VoiceJournal/YYYY/MM/`) with on-demand audio caching and LRU storage management.
- **Theme Support**: Adaptive light and dark theme (defaulting to system auto).

## Development Setup

```bash
# Install dependencies
npm install

# Start development server
npm run start

# Quality checks
npm run qualitycheck

# Run tests
npm test
```

## Documentation

- [Implementation Plan](docs/plans/voice-journal-app-plan.md)
- [UI Mockups](docs/plans/ui_mockups.md)
- [Agent Guidelines](AGENTS.md)

## License

MIT
