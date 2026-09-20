# Privacy Policy

**Effective Date:** September 20, 2026

## Overview

VoiceJournal ("the App", "we", "our") is a personal voice diary application. This Privacy Policy explains how the App handles your information. **VoiceJournal has no backend server.** All your data is stored locally on your device or in your own Google Drive account. We never see, collect, or transmit your personal data to any developer-controlled server.

---

## 1. Information We Collect

VoiceJournal does **not** collect any personal information on our behalf. The App operates entirely on your device.

The following data is created by you and stored **only on your device** in a local SQLite database:

- **Voice recordings** — audio files you record within the App (`.m4a` format)
- **Transcripts** — text transcriptions of your recordings
- **Titles, summaries, and tags** — AI-generated or manually edited metadata for your entries
- **Your Gemini API key** — stored locally in the on-device database; never transmitted to any developer-controlled server

---

## 2. Microphone Access

The App requires access to your device's microphone to record voice journal entries. Microphone access is used solely for recording audio within the App. Audio is processed on your device and, if you have configured a Gemini API key, sent directly from your device to Google's Gemini API for transcription and analysis.

---

## 3. Google Gemini API (Optional)

If you choose to enable AI transcription, you must provide your own Google Gemini API key (Bring Your Own Key — BYOK). When enabled:

- Your audio recordings are sent **directly from your device** to the [Google Gemini API](https://ai.google.dev/) (`gemini-3.5-flash-lite` model).
- Audio is **never** routed through or stored on any VoiceJournal developer-controlled server.
- Google processes the audio and returns structured text (title, transcript, summary, tags) back to your device.
- Your API key and usage are governed by [Google's Privacy Policy](https://policies.google.com/privacy) and the [Google Gemini API Terms of Service](https://ai.google.dev/terms).

You are responsible for your own API key usage costs and compliance with Google's terms.

---

## 4. Google Drive Sync (Optional)

If you choose to enable Google Drive backup, the App uses your personal Google account to store audio files in your own Google Drive under the folder `VoiceJournal/YYYY/MM/`. When enabled:

- You authenticate via Google Sign-In using OAuth 2.0. The App only requests the Drive-specific OAuth scope required for file access.
- Your Google email address and profile name are used solely to authenticate with Google Drive and are not stored or shared by the App.
- Audio files are uploaded directly from your device to your personal Google Drive account.
- The App never accesses files outside the `VoiceJournal/` folder it creates.
- Your Drive data is governed by [Google's Privacy Policy](https://policies.google.com/privacy) and [Google Drive Terms of Service](https://www.google.com/drive/terms-of-service/).

---

## 5. Third-Party Services

The App may communicate with the following third-party services at your direction:

| Service | Provider | Purpose | Privacy Policy |
|---------|----------|---------|----------------|
| Gemini API | Google LLC | AI transcription, title & summary generation | [google.com/privacy](https://policies.google.com/privacy) |
| Google Drive API | Google LLC | Optional cloud backup of audio files | [google.com/privacy](https://policies.google.com/privacy) |
| Google Sign-In | Google LLC | Authentication for Google Drive | [google.com/privacy](https://policies.google.com/privacy) |

No other third-party analytics, advertising, or tracking services are used.

---

## 6. Data Retention and Deletion

- **On-device data**: All recordings, transcripts, and metadata remain on your device under your full control. You can delete individual entries or all data at any time within the App.
- **Google Drive data**: Files you have backed up to Google Drive remain in your personal Drive account. You can delete them at any time from within the App or directly through Google Drive.
- **Uninstalling the App**: Uninstalling VoiceJournal removes all locally stored data. Google Drive files remain in your Drive until you delete them.

---

## 7. No Developer Access to Your Data

VoiceJournal operates with a zero-knowledge architecture:

- There is **no backend server** operated by the developer.
- The developer has **no access** to your recordings, transcripts, API keys, or any other personal data.
- The App does **not** transmit any data to the developer.

---

## 8. Children's Privacy

VoiceJournal is not directed at children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided personal information through the App, please contact us so we can take appropriate action.

---

## 9. Security

Your data is stored locally using SQLite on your device, protected by your device's built-in security (screen lock, encryption). We recommend keeping your device and operating system up to date and using a strong device passcode.

Your Gemini API key is stored in the local database and is only transmitted to Google's Gemini API over HTTPS.

---

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be reflected by an updated effective date. Continued use of the App after changes constitutes acceptance of the updated policy.

---

## 11. Contact

If you have questions or concerns about this Privacy Policy, please open an issue on our [GitHub repository](https://github.com/ejfn/voice-journal-app/issues).

---

*VoiceJournal — Speak your mind. AI captures the rest.*
