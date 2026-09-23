# Voice Journal

> *Speak your mind. AI captures the rest.*

A zero-subscription mobile voice diary application built with React Native and Expo (SDK 57) targeting **Android**. It features custom native audio recording with background notification controls, background speech-to-structured metadata powered by Gemini Flash, local full-text search (FTS5 via `expo-sqlite`), Google Photos-style storage indicators, and on-demand Google Drive synchronization.

## Platform Support

Voice Journal targets **Android only** at this stage. It utilizes a custom native module (`voice-recorder`) for background recording, foreground service management, and notification controls. iOS is not supported.

## Features

- **Native Audio Capture**: Record, pause, resume, and play voice entries with real-time waveform metering and large touch targets using a custom native Android recording service with dynamic background notification controls (Pause, Resume, Stop).
- **Multimodal AI**: Automatically transcribes audio in the background and extracts entry titles, executive summaries, and lowercase tags via `gemini-3.5-flash-lite`.
- **Offline-First & Background Queue**: Immediate local saving with queued offline transcription and graduated exponential backoff retries.
- **Local Full-Text Search**: Instant search across titles, summaries, transcripts, and tags powered by SQLite FTS5.
- **Storage & Cloud Sync**: On-demand Google Drive sync (`VoiceJournal/YYYY/MM/`) with LRU audio caching and clear status badges (`local_only`, `syncing`, `synced`, `cloud_only`).
- **Theme Support**: Adaptive light and dark theme (defaulting to system preference).

## Gemini API Key & Zero-Cost Personal Usage

Voice Journal adopts a **Bring Your Own Key (BYOK)** model to deliver a premium AI journaling experience without recurring subscriptions or middleman fees.

### Free Tier for Personal Use
- **Generous Free Allowance**: Google AI Studio provides a free tier for Gemini models (`gemini-3.5-flash-lite`) offering up to **15 requests per minute** and **1,500 requests per day** at no cost.
- **No Credit Card Required**: Even active daily journalers recording 5–15 entries a day utilize less than 1% of the daily free tier quota. You do not need a paid Google Cloud account or billing method.
- **Privacy & Direct Connection**: Your API key is stored securely in your device's local SQLite database. Audio and transcripts are transmitted directly between your phone and Google's official Gemini API endpoints—never through a proprietary backend server.

### Setting Up Your API Key
1. Obtain a free API key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Open Voice Journal, navigate to **Settings (gear icon) → Gemini API Key**, paste your key, and tap **Save & Test Connection**.
3. *Alternative (for developers)*: Add `EXPO_PUBLIC_GEMINI_API_KEY=your_key_here` to your local `.env` file.

## Development Setup

```bash
# Clone and install dependencies
git clone https://github.com/ejfn/voice-journal-app.git
cd voice-journal-app
npm install

# Copy environment variables template
cp .env.example .env

# Start development server
npm run start         # Standard Expo bundler
npm run start:dev     # With Expo Dev Client

# Quality checks
npm run qualitycheck  # Runs typecheck, lint, and silent tests
npm test              # Run Jest unit tests
```

## Documentation

- [Agent Guidelines](AGENTS.md)

## License

MIT
