# GCP & Gemini API Setup & Google Drive OAuth Configuration Plan

> **Document Version:** 1.1.0  
> **Date:** 2026-09-19  
> **Status:** Active Plan  
> **Related Architecture:** [2026-09-19_voice-journal-app-plan.md](file:///home/eric/repos/voice-journal-app/docs/plans/2026-09-19_voice-journal-app-plan.md)  
> **Scope:** Google Cloud Platform (GCP) Console, Google AI Studio (Gemini 2.5 Flash), OAuth 2.0 Credentials, Google Drive API v3, EAS Keystore Integration

---

## 1. Executive Summary

VoiceJournal requires two core cloud integrations provided by the Google ecosystem:
1. **Multimodal AI Analysis (Gemini API):** Performs on-device-initiated speech transcription, diary headline title generation, executive 1-sentence summaries, and 3–5 lowercase topic tags using `gemini-2.5-flash` via direct REST endpoints.
2. **Offline-First Cloud Sync (Google Drive API):** Backs up local SQLite metadata and `.m4a` audio recordings to a hierarchical folder structure (`VoiceJournal/YYYY/MM/`) on Google Drive via `@react-native-google-signin/google-signin` and Drive REST API v3.

To enable both capabilities on Android physical devices and emulators, the developer must configure:
- A Google Cloud Platform (GCP) project with the **Google Drive API** enabled.
- A **Gemini API Key** generated via Google AI Studio or GCP Generative Language API (`EXPO_PUBLIC_GEMINI_API_KEY`).
- An **OAuth Consent Screen** configured with the minimal, non-sensitive scope `https://www.googleapis.com/auth/drive.file`.
- A **Web Application OAuth 2.0 Client ID** passed as the server audience parameter (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`).
- An **Android OAuth 2.0 Client ID** linked to package `com.personal.voicejournal` and authorized by the signing certificate SHA-1 fingerprint.

---

## 2. Architecture & Service Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as User Device (Android)
    participant App as VoiceJournal App
    participant GPS as Google Play Services
    participant Gemini as Gemini 2.5 Flash (AI Studio)
    participant Drive as Google Drive API v3

    Note over User,App: Step 1: Audio Capture & AI Processing
    User->>App: Record voice clip & tap Stop
    App->>Gemini: POST /v1beta/models/gemini-2.5-flash:generateContent?key=GEMINI_API_KEY<br/>(Base64 audio + Structured JSON prompt)
    Gemini-->>App: { transcript, title, tags, summary }
    App->>App: Save Entry & Sync Queue item to local SQLite (FTS5 indexed)

    Note over User,Drive: Step 2: Google Authentication & Sync
    User->>App: Tap "Connect Google Drive"
    App->>GPS: GoogleSignin.signIn({ webClientId, scopes })
    GPS-->>App: Access Token (drive.file scope)
    App->>Drive: GET /drive/v3/files (Locate VoiceJournal/ folder)
    Drive-->>App: Folder ID
    App->>Drive: Multipart POST (Upload audio clip + JSON metadata)
    Drive-->>App: Upload confirmed (File ID, ETag)
    App->>App: Update sync status to 'synced'
```

---

## 3. Prerequisites

- A standard Google account (e.g., `ericvan76@gmail.com`).
- Access to [Google Cloud Console](https://console.cloud.google.com/).
- Access to [Google AI Studio](https://aistudio.google.com/).
- EAS CLI installed and authenticated (`npx eas whoami`).
- GitHub repository with locked `main` branch (merges via Pull Requests).

---

## 4. Step-by-Step Implementation Guide

### Step 1: Create or Select GCP Project

1. Navigate to [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown in the top header navigation bar and click **New Project**.
3. Configure the project:
   - **Project Name:** `voice-journal-app`
   - **Organization:** *No organization* (or select your personal organization if applicable).
4. Click **Create** and ensure the newly created project is selected in the top bar.

---

### Step 2: Enable Google Drive API

1. In the left navigation menu, go to **APIs & Services** &rarr; **Library** (or visit `https://console.cloud.google.com/apis/library`).
2. In the search box, type `Google Drive API`.
3. Select **Google Drive API** from the search results.
4. Click **Enable**.
5. Wait for the API dashboard to confirm activation.

---

### Step 3: Configure OAuth Consent Screen

1. In the left navigation menu, select **APIs & Services** &rarr; **OAuth consent screen** (or `https://console.cloud.google.com/apis/credentials/consent`).
2. **User Type**:
   - Select **External**.
   - Click **Create**.
3. **App Information**:
   - **App name:** `VoiceJournal`
   - **User support email:** Select your Google account email (`ericvan76@gmail.com`).
   - **App logo:** *(Optional)* Leave blank for internal testing.
   - **Application home page / terms:** Leave blank.
   - **Developer contact information:** `ericvan76@gmail.com`.
   - Click **Save and Continue**.
4. **Scopes**:
   - Click **Add or Remove Scopes**.
   - In the filter box, search for `drive.file`.
   - Select the checkbox for:
     - `.../auth/drive.file` &mdash; *See, edit, create, and delete only the specific Google Drive files you use with this app*.
   - > [!IMPORTANT]
   - > **Scope Selection Rationale:** Do **NOT** select `.../auth/drive` or `.../auth/drive.readonly`. The `drive.file` scope grants per-file access solely to files created by VoiceJournal. Because it is non-sensitive, it avoids the requirement for Google Tier-2 security verification (CASA audit), making setup seamless for personal use.
   - Click **Update** &rarr; **Save and Continue**.
5. **Test Users (Testing Mode)**:
   - Click **+ Add Users**.
   - Enter your personal Google email: `ericvan76@gmail.com`.
   - Add any additional Google accounts that will test the app on physical devices.
   - > [!WARNING]
   - > While the publishing status is **Testing**, only explicitly listed test user accounts can authenticate. Any unlisted account will be rejected with an `Access blocked: VoiceJournal has not completed the Google verification process` error.
   - Click **Save and Continue**.
6. **Summary**: Review the settings and click **Back to Dashboard**.

---

### Step 4: Create Web Application OAuth 2.0 Client ID

> [!NOTE]
> Even though VoiceJournal runs as an Android native app, `@react-native-google-signin/google-signin` requires a **Web Application Client ID** passed into `GoogleSignin.configure({ webClientId: '...' })`. Android Play Services uses this server audience parameter to securely issue access tokens with the required `drive.file` scope.

1. Navigate to **APIs & Services** &rarr; **Credentials**.
2. Click **+ Create Credentials** at the top &rarr; select **OAuth client ID**.
3. **Application type**: Select **Web application**.
4. **Name:** `VoiceJournal Web Client`.
5. **Authorized JavaScript origins & Redirect URIs:** Leave empty.
6. Click **Create**.
7. A dialog will appear displaying:
   - **Your Client ID** (e.g., `123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com`).
   - **Your Client Secret** (not required by the mobile client).
8. Copy the **Client ID**.
9. Add the Client ID to your local `.env` file:
   ```env
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com
   ```

---

### Step 5: Extract Keystore SHA-1 Certificate Fingerprints

Google Play Services on Android authenticates the calling APK using the combination of its Android Package Name (`com.personal.voicejournal`) and the cryptographic **SHA-1 Fingerprint** of the signing keystore.

#### Option A: EAS Managed Keystore (Cloud & Dev Builds)
1. In your terminal, run:
   ```bash
   npx eas credentials -p android
   ```
2. Select your build profile (e.g., `production` or `development`).
3. Select **Keystore: Manage your keystore**.
4. EAS prints the fingerprint details:
   - Look for **SHA-1 Fingerprint** (e.g., `AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:11:22:33:44`).
   - Copy this hexadecimal string.

*(Note: When you run your first `npx eas build -p android --profile development`, EAS automatically generates a managed keystore if one does not exist and prints the SHA-1 in the build summary).*

#### Option B: Local Debug Keystore (Local Run & Emulators)
If running a local development build via `npx expo run:android`:
1. The default debug keystore is located at `~/.android/debug.keystore`.
2. Extract the fingerprint using `keytool`:
   ```bash
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```
3. Locate the line starting with `SHA1:` and copy the fingerprint.

---

### Step 6: Create Android OAuth 2.0 Client ID

1. Return to [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
2. Click **+ Create Credentials** &rarr; select **OAuth client ID**.
3. **Application type:** Select **Android**.
4. **Name:** `VoiceJournal Android Client (EAS Production / Dev)`.
5. **Package name:**
   ```
   com.personal.voicejournal
   ```
   *(Must match `expo.android.package` in [app.json](file:///home/eric/repos/voice-journal-app/app.json)).*
6. **SHA-1 certificate fingerprint:**
   - Paste the SHA-1 fingerprint extracted in Step 5 (e.g., `AA:BB:CC:DD:...`).
7. Click **Create**.

> [!TIP]
> If you have multiple signing keys (e.g., a local debug keystore for fast emulator iteration AND an EAS remote keystore for cloud builds), create **two** Android OAuth Client IDs in GCP:
> 1. `VoiceJournal Android (Local Debug)` &rarr; local SHA-1.
> 2. `VoiceJournal Android (EAS Cloud)` &rarr; EAS remote SHA-1.
> Both can share the same package name `com.personal.voicejournal`.

---

### Step 7: Generate Gemini API Key

VoiceJournal uses the **Gemini 2.5 Flash** model for fast multimodal audio processing (verbatim transcription, title generation, summary, and clean lowercase tags).

#### Option A: Via Google AI Studio (Fastest & Recommended)
1. Open [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account (`ericvan76@gmail.com`).
3. In the left navigation menu, click **Get API key** (or visit `https://aistudio.google.com/app/apikey`).
4. Click **Create API key**.
5. When prompted to select a Google Cloud project, choose the **`voice-journal-app`** project created in Step 1.
   *(Linking to the existing GCP project keeps all billing, credentials, and quotas consolidated).*
6. Google AI Studio generates an API key string (e.g., `AIzaSyD-EXAMPLEKEY1234567890abcdef`).
7. Click **Copy** to copy the key.

#### Option B: Via Google Cloud Console (Direct GCP Management)
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Select project `voice-journal-app`.
3. In the search box, search for **Generative Language API** and click **Enable**.
4. Go to **APIs & Services** &rarr; **Credentials**.
5. Click **+ Create Credentials** &rarr; select **API key**.
6. A dialog appears with your newly generated API key.
7. *(Recommended Security Practice)* Click **Edit API key** in the dialog:
   - Name: `VoiceJournal Gemini Key`.
   - **API restrictions:** Select **Restrict key** &rarr; check **Generative Language API** only.
   - Click **Save**.

#### Adding the Gemini Key to VoiceJournal
Add the generated key to your local `.env` file:
```env
EXPO_PUBLIC_GEMINI_API_KEY=AIzaSyD-EXAMPLEKEY1234567890abcdef
```

To configure for EAS cloud builds:
```bash
npx eas secret:create --name EXPO_PUBLIC_GEMINI_API_KEY --value "AIzaSyD-EXAMPLEKEY..." --type string
```

> [!IMPORTANT]
> All credentials are baked in at build time via Expo public environment variables (`.env` for local/development builds and EAS Secrets for cloud builds). There are no in-app credential text inputs, eliminating security risks from storing keys in mutable app storage.

---

## 5. Configuration Reference

### Complete `.env` Specification

```env
# Gemini API Key (multimodal audio transcription, summary, tagging)
EXPO_PUBLIC_GEMINI_API_KEY=AIzaSy...

# Google OAuth 2.0 Web Client ID (audience ID for Google Play Services on Android)
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=123456789012-xxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
```

### Environment Variables Matrix

| Variable | Service | Required In | Public / Secret | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `EXPO_PUBLIC_GEMINI_API_KEY` | Gemini 2.5 Flash | `.env` / EAS Secret | Public in bundle | Embedded at build time |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google Sign-In & Drive | `.env` / EAS Secret | Public in bundle | Must be OAuth "Web application" type |

---

## 6. Verification and Testing Runbook

### Phase 1: Verify Gemini AI Transcription & Analysis
1. Launch VoiceJournal in dev client or emulator.
2. Ensure the Gemini API key is configured in `.env` (or EAS secrets for cloud builds).
3. Tap the **Record** microphone button and record 10 seconds of speech:
   > *"Today I went for a 5-kilometer run in the morning park. The weather was cool and refreshing, and I felt great afterwards."*
4. Tap **Stop**.
5. The app displays the processing indicator while `GeminiService.ts` uploads the audio to `gemini-2.5-flash`.
6. Verify the Review Modal:
   - **Transcript:** Accurately reflects spoken words without filler words.
   - **Title:** Generated short title (e.g., *"Morning Park Run"*).
   - **Summary:** Concise 1-sentence summary.
   - **Tags:** 3 to 5 lowercase tags (e.g., `running`, `morning`, `fitness`, `park`).
7. Tap **Save Entry**.

---

### Phase 2: Verify Google Drive Sync
1. In VoiceJournal, tap **Settings** (gear icon in header).
2. Confirm the Configuration Source indicates `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID configured`.
3. Tap **Connect Google Drive**.
4. Expected behavior:
   - Google Play Services bottom-sheet account picker appears.
   - Select your test account (`ericvan76@gmail.com`).
   - Consent dialog displays: *"VoiceJournal wants to access your Google Account... See, edit, create, and delete only the specific Google Drive files you use with this app"*.
   - Tap **Allow**.
   - Settings modal displays `Connected as ericvan76@gmail.com` with a green status badge.
5. In the timeline, observe the entry sync status indicator transition from `pending` to `synced`.
6. Open [Google Drive Web](https://drive.google.com/):
   - Navigate to `VoiceJournal/` folder.
   - Confirm subfolders `YYYY/MM/` contain the uploaded `.m4a` audio clip and `.json` entry metadata file.

---

## 7. Troubleshooting Matrix

| Error Code / Symptom | Root Cause | Resolution |
| :--- | :--- | :--- |
| **`400 API_KEY_INVALID` (Gemini)** | Missing, mistyped, or disabled Gemini API key | Check `.env` or EAS secrets. Confirm the key is active in [Google AI Studio](https://aistudio.google.com/app/apikey). |
| **`429 RESOURCE_EXHAUSTED` (Gemini)** | Rate limit exceeded on Gemini free tier | Free tier provides 15 RPM. Implement brief backoff or verify billing on the linked GCP project. |
| **`DEVELOPER_ERROR` (code 10) (Google Sign-In)** | SHA-1 mismatch or Package Name mismatch in GCP Android Client ID | Verify `app.json` package is `com.personal.voicejournal`. Re-extract SHA-1 from `npx eas credentials` and ensure exact match in GCP Console Android Client ID. |
| **`DEVELOPER_ERROR` (code 10) on configure** | Invalid or missing `webClientId` | Ensure `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is defined and matches the Web Client ID (type: Web application, NOT Android). |
| **`Access blocked: VoiceJournal has not completed the Google verification process`** | Google account not added to OAuth Consent Screen Test Users | Add the user's Google email under **OAuth consent screen** &rarr; **Test users** in GCP Console. |
| **`SIGN_IN_CANCELLED` (code 13)** | User dismissed the Google sign-in dialog | Normal user action. App allows retry without error. |
| **`PLAY_SERVICES_NOT_AVAILABLE`** | Device lacks Google Play Services (e.g. AOSP emulator) | Use an Android Virtual Device (AVD) image that includes **Google Play** or test on a physical Android device. |
| **403 Insufficient Permissions during Drive upload** | Scopes mismatch or user revoked Drive permission | Ensure consent screen includes `drive.file` scope. Call `GoogleSignin.signOut()` and re-authenticate. |

---

## 8. Rollout Checklist

- [ ] GCP Project `voice-journal-app` created.
- [ ] Google Drive API v3 enabled in API Library.
- [ ] OAuth Consent Screen created (User Type: External).
- [ ] Scope `https://www.googleapis.com/auth/drive.file` added.
- [ ] Test user `ericvan76@gmail.com` added under Test Users.
- [ ] Web Application OAuth Client ID generated.
- [ ] Android OAuth Client ID generated with package `com.personal.voicejournal`.
- [ ] SHA-1 fingerprint from EAS Keystore linked to Android OAuth Client ID.
- [ ] **Gemini API Key** generated via Google AI Studio / GCP Console.
- [ ] Gemini API Key restricted to Generative Language API (optional security best practice).
- [ ] Both `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GEMINI_API_KEY` added to `.env`.
- [ ] Dev client APK built and installed on Android device.
- [ ] Multimodal audio transcription, title, summary, and auto-tagging verified.
- [ ] End-to-end Google Drive upload verified.
