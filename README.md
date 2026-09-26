# Voice Journal

> *Speak your mind. AI captures the rest.*

Voice Journal is a zero-subscription, privacy-first mobile voice diary application for **Android**. Speak your mind naturally—Voice Journal captures your audio, automatically transcribes your entries, generates concise titles, summaries, and tags with AI, and keeps your memories searchable and safely backed up to your personal Google Drive.

## Platform Support

Voice Journal is developed specifically for **Android**. It includes a custom native recording service with background controls so you can record, pause, and stop seamlessly from your notification shade. *(iOS is not supported).*

## Features

- **Effortless Voice Recording**: Capture your thoughts with a single tap. Pause, resume, and stop directly from the Android notification bar even while your screen is off or you're using another app.
- **Smart AI Transcriptions & Summaries**: Turn spoken voice into clear text automatically in the background. Each entry gets an AI-crafted title, executive summary, and organized topic tags so you never have to type.
- **Works Anywhere, Even Offline**: Journal on planes, subway commutes, or remote trails. Recordings are saved to your device immediately, and AI transcription processes automatically as soon as you're connected.
- **Instant Keyword Search**: Find past memories and reflections in seconds. Search across all your transcripts, titles, summaries, and tags with fast, on-device keyword search.
- **Private Cloud Backup & Smart Storage**: Back up entries securely to your personal Google Drive account. Visual backup badges let you know what's stored on your phone or in the cloud, while smart storage management lets you clear older local audio files to save space and re-download them whenever you want to listen.
- **Import Audio Anytime**: Bring in voice memos, voice notes, or recorded conversations from other apps by simply holding and sliding up on the record button.
- **Adaptive Day & Night Themes**: Enjoy a clean interface that automatically matches your device's light or dark mode.

## Gemini API Key & Zero-Cost Personal Usage

Voice Journal adopts a **Bring Your Own Key (BYOK)** model to deliver a premium AI journaling experience without recurring subscriptions or middleman fees.

### Free Tier for Personal Use
- **Generous Free Allowance**: Google AI Studio provides a free tier for Gemini models (`gemini-3.5-flash-lite`) offering up to **15 requests per minute** and **1,500 requests per day** at no cost.
- **No Credit Card Required**: Even active daily journalers recording 5–15 entries a day utilize less than 1% of the daily free tier quota. You do not need a paid Google Cloud account or billing method.
- **Privacy & Direct Connection**: Your API key is stored locally on your device. Audio and transcripts are transmitted directly between your phone and Google's official Gemini API endpoints—never through a proprietary backend server.

### Setting Up Your API Key
1. Obtain a free API key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Open Voice Journal, navigate to **Settings (gear icon) → Gemini API Key**, paste your key, tap **Test Key** to verify, and tap **Save Key**.
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
npm run android       # Launch on Android

# Quality checks
npm run qualitycheck  # Runs typecheck, lint, and silent tests
npm test              # Run Jest unit tests
```

## Documentation

- [Agent Guidelines](AGENTS.md)
- [Privacy Policy](PRIVACY_POLICY.md)

## Repository & Mobile Access

Scan this QR code with your mobile camera to open this repository on GitHub:

<p align="center">
  <a href="https://github.com/ejfn/voice-journal-app">
    <img src="./assets/github-qr.png" alt="Voice Journal GitHub Repository QR Code" width="180" />
  </a>
  <br />
  <sub><a href="https://github.com/ejfn/voice-journal-app">https://github.com/ejfn/voice-journal-app</a></sub>
</p>

## License

MIT
