# GCP & Google Auth Platform Setup Guide for VoiceJournal

> **Project:** `voice-journal-app`  
> **UI Version:** Google Cloud Console & Google Auth Platform  
> **Goal:** Configure Drive API, Gemini API, OAuth permissions, and EAS variables so the Dev Client APK works out-of-the-box on Android.  
> **No local `.env` required:** All keys are injected directly into the APK via EAS.

---

## What You Will Obtain

| Item | Where in GCP Console | Where It Goes |
| :--- | :--- | :--- |
| **Google Drive API** | APIs & Services &rarr; Library | Enabled in project |
| **Gemini API** | APIs & Services &rarr; Library / Marketplace | Enabled in project |
| **Data Access (Scope)** | Google Auth Platform &rarr; Data Access | Scope `drive.file` saved |
| **Audience (Test Users)** | Google Auth Platform &rarr; Audience | Your test Google email added |
| **Gemini API Key** | APIs & Services &rarr; Credentials &rarr; API key | EAS: `EXPO_PUBLIC_GEMINI_API_KEY` |
| **Web Client ID** | Google Auth Platform &rarr; Clients (Web application) | EAS: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` |
| **Android Client ID** | Google Auth Platform &rarr; Clients (Android) | Package `com.voicejournal.app.dev` + SHA-1 |

---

## Step 1: Create the Project

1. Open [console.cloud.google.com](https://console.cloud.google.com/).
2. In the top navigation bar, click the project selector dropdown (next to "Google Cloud").
3. Click **New Project** in the upper right.
4. Set **Project name:** `voice-journal-app`.
5. Click **Create**.
6. In the top bar dropdown, switch to the new **`voice-journal-app`** project.

---

## Step 2: Enable the 2 Required APIs

### 1. Google Drive API
1. In the top search bar, search for `Google Drive API` and press Enter.
2. Click **Google Drive API** (under Marketplace / Top results).  
   *(Direct link: [`https://console.cloud.google.com/apis/library/drive.googleapis.com`](https://console.cloud.google.com/apis/library/drive.googleapis.com))*
3. Click the blue **Enable** button.

### 2. Gemini API (Generative Language API)
1. In the top search bar, search for `Gemini API` and press Enter.
2. Click:  
   👉 **`Gemini API`** *(Marketplace Product • Google • Build with latest models from Google Deepmind...)*.  
   *(Direct link: [`https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com`](https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com))*
3. Click the blue **Enable** button.

---

## Step 3: Configure Google Auth Platform (Consent, Scopes & Users)

In Google Cloud Console, the consent screen is managed under the **Google Auth Platform** section (in the left menu under **APIs & Services** &rarr; **Google Auth Platform** or **OAuth consent screen**).

*(If you see a "Get started" button, click it to initialize the platform).*

---

### Tab 1: Branding
1. Click **Branding** in the Google Auth Platform menu.
2. Enter the required details:
   - **App name:** `VoiceJournal`
   - **User support email:** Select your Google account from the dropdown.
   - **Developer contact information:** Enter your email address.
   - Leave logo and domains blank.
3. Click **Save**.

---

### Tab 2: Data Access (Scopes)
*(This is where scopes live in the new interface. The table starts empty until you add them).*

1. Click **Data Access** in the Google Auth Platform menu.
2. Click the button at the top: **ADD OR REMOVE SCOPES**.
3. A panel slides out on the right:
   - In the **Filter** box, type `drive.file`.
   - Check the box next to `.../auth/drive.file` (*See, edit, create, and delete only the specific Google Drive files you use with this app*).
   - *(If `drive.file` does not show in the filter: scroll down to **Manually add scopes**, paste `https://www.googleapis.com/auth/drive.file`, and click **Add to table**).*
4. Click the blue **Update** button at the bottom of the side panel.
5. Click **Save**.

---

### Tab 3: Audience (User Type & Test Users)
1. Click **Audience** in the Google Auth Platform menu.
2. Under **User type**, select **External** (if prompted).
3. Under **Test users**, click **+ ADD USERS**.
4. Type the Google email of the account you will use on your physical test phone.
5. Click **Save**.

> [!IMPORTANT]
> While publishing status is in **Testing**, Google rejects any sign-in from accounts that are not explicitly listed under Test users.

---

## Step 4: Create Credential 1 &mdash; Gemini API Key

1. Go to **APIs & Services** &rarr; **Credentials**.
2. Click **+ Create Credentials** at the top &rarr; select **API key**.
3. A modal appears showing your new key (`AIzaSy...`).
4. Click **Edit API key** in the modal:
   - **Name:** `VoiceJournal Gemini Key`
   - Under **API restrictions**, select **Restrict key**.
   - Check **Generative Language API** in the dropdown.
   - Click **Save**.
5. **Copy this key.** This is your `EXPO_PUBLIC_GEMINI_API_KEY`.

---

## Step 5: Create Credential 2 &mdash; Web Client ID

> **Why Web type for an Android app?**  
> `@react-native-google-signin/google-signin` uses Google Play Services on Android. Google Play Services requires a **Web Client ID** as the backend server audience parameter (`webClientId`) to exchange authentication tokens for Drive API access. Without it, Google Sign-In throws `DEVELOPER_ERROR (code 10)`.

1. Go to **Google Auth Platform** &rarr; **Clients** (or **APIs & Services** &rarr; **Credentials** &rarr; **+ Create Credentials** &rarr; **OAuth client ID**).
2. **Application type:** Select **Web application**.
3. **Name:** `VoiceJournal Web Client`.
4. Leave origins and redirect URIs blank.
5. Click **Create**.
6. Copy the **Client ID** (ends with `.apps.googleusercontent.com`). This is your `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.

---

## Step 6: Create Credential 3 &mdash; Android Client ID

> **Why is Android type needed if not publishing to Google Play Store?**  
> Even for sideloaded dev APKs, Android OS (Google Play Services running locally on your phone) inspects the installed APK's **Package Name** and cryptographic **SHA-1 certificate signature** before opening the Google Sign-In prompt. Google verifies this against the registered Android Client ID to prevent app spoofing. Without this, Google Sign-In throws `DEVELOPER_ERROR (code 10)`.

### A. Your Exact SHA-1 Fingerprints from EAS

Because EAS generates independent keystores for different application identifiers, the Dev Client APK and Production APK have different SHA-1 fingerprints:

| Environment | Package Name | SHA-1 Certificate Fingerprint |
| :--- | :--- | :--- |
| **Development Build (Dev Client)** | `com.voicejournal.app.dev` | `05:F9:40:16:F4:4A:EF:DF:F1:C7:C5:70:F5:40:55:A9:11:93:05:8C` |
| **Production Build (Release APK)** | `com.voicejournal.app` | `3B:C9:69:B7:0B:33:43:E3:8E:1B:32:62:4B:B6:C6:1D:23:F0:D4:ED` |

---

### B. Create in GCP

#### Client 1: Dev Client (Required for local development & Dev Client APK)
1. In **Google Auth Platform** &rarr; **Clients** (or **APIs & Services** &rarr; **Credentials**), click **+ Create client** (or **+ Create Credentials** &rarr; **OAuth client ID**).
2. **Application type:** Select **Android**.
3. **Name:** `VoiceJournal Android Dev`.
4. **Package name:**
   ```
   com.voicejournal.app.dev
   ```
5. **SHA-1 certificate fingerprint:**
   ```
   05:F9:40:16:F4:4A:EF:DF:F1:C7:C5:70:F5:40:55:A9:11:93:05:8C
   ```
6. Click **Create**.

#### Client 2: Production Client (For release APKs)
1. Click **+ Create client** &rarr; **Android**.
2. **Name:** `VoiceJournal Android Prod`.
3. **Package name:**
   ```
   com.voicejournal.app
   ```
4. **SHA-1 certificate fingerprint:**
   ```
   3B:C9:69:B7:0B:33:43:E3:8E:1B:32:62:4B:B6:C6:1D:23:F0:D4:ED
   ```
5. Click **Create**.

---

## Step 7: Put Keys into EAS (Bakes Them Into the APK)

You do **not** need a local `.env` file. Put both values directly into EAS:

1. Go to [expo.dev](https://expo.dev/) &rarr; select project **`voice-journal-app`**.
2. In the left menu: **Configuration** &rarr; **Environment Variables**.
3. Click **Add Variable**:
   - **Name:** `EXPO_PUBLIC_GEMINI_API_KEY`
   - **Value:** *(paste your Gemini API Key from Step 4)*
   - **Visibility:** Select **Plain text** *(EAS does not allow "Secret" for EXPO_PUBLIC_ variables because they are inlined into the client bundle)*
   - **Environment:** Check `Development`, `Preview`, and `Production`
   - Click **Save**.
4. Click **Add Variable** again:
   - **Name:** `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
   - **Value:** *(paste your Web Client ID from Step 5)*
   - **Visibility:** Select **Plain text**
   - **Environment:** Check `Development`, `Preview`, and `Production`
   - Click **Save**.

---

## Step 8: Build the Dev Client APK

1. Ensure `EXPO_TOKEN` is set in your GitHub repository secrets (if using GitHub Actions):
   ```bash
   gh secret set EXPO_TOKEN
   ```
   *(Generate an access token at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens)).*

2. Trigger the build:
   - **Via GitHub Actions:** In your GitHub repository, go to **Actions** &rarr; **Build Dev Client** &rarr; **Run workflow** (on `main`).
   - **Or via Terminal:**
     ```bash
     npx eas build -p android --profile development
     ```

3. When the build finishes, download the `.apk` file to your Android phone, install it, and launch VoiceJournal. Both Gemini AI and Google Drive sync will work automatically.

---

## Step 9: On-Device Verification Runbook

1. **Install APK**: Download and install the `.apk` on your physical Android phone.
2. **Launch VoiceJournal**: Open the app.
3. **Check Status**:
   - Tap the **Gear** (Settings) icon in the header.
   - Verify that **API KEY STATUS** displays `✓ EXPO_PUBLIC_GEMINI_API_KEY configured (Gemini 2.5 Flash)`.
   - Verify that **CONFIGURATION SOURCE** displays `✓ EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID configured`.
4. **Test Gemini Multimodal AI**:
   - Close Settings, tap the **Microphone** button, and record a 10-second voice journal entry.
   - Tap **Stop**.
   - Verify that the Review modal displays the verbatim transcript, a generated 3–6 word title, a 1-sentence summary, and clean lowercase tags.
   - Tap **Save Entry**.
5. **Test Google Drive Cloud Sync**:
   - Tap the **Gear** icon &rarr; tap **Sign In with Google**.
   - Select your test Google account.
   - Grant permission on the consent dialog.
   - Confirm status changes to `✓ Connected (<your-email>)`.
   - Tap **Sync Now**.
   - Open [Google Drive Web](https://drive.google.com/) and confirm the entry audio and `.json` file exist in the `VoiceJournal/` folder.

---

## Troubleshooting Matrix

| Error Code / Symptom | Root Cause | Resolution |
| :--- | :--- | :--- |
| **`DEVELOPER_ERROR` (code 10)** | Package Name or SHA-1 mismatch in GCP Android Client ID | Ensure GCP Android Client ID package name is `com.voicejournal.app.dev` (for dev builds) or `com.voicejournal.app` (for production), and the SHA-1 matches `npx eas credentials -p android`. |
| **`DEVELOPER_ERROR` (code 10) on configure** | Invalid or missing `webClientId` | Ensure `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in EAS is the **Web application** client ID (NOT the Android client ID). |
| **`Access blocked: VoiceJournal has not completed the Google verification process`** | Google account not added to Test Users | In Google Auth Platform &rarr; **Audience** &rarr; **Test users**, add your Google email address. |
| **`400 API_KEY_INVALID` (Gemini)** | Gemini API key invalid or Generative Language API not enabled | Check that Generative Language API is enabled in GCP and that the key in EAS Environment Variables is copied correctly. |
| **`429 RESOURCE_EXHAUSTED` (Gemini)** | Free-tier rate limit reached (15 RPM) | Wait a minute before sending another audio recording. |
| **`PLAY_SERVICES_NOT_AVAILABLE`** | Device lacks Google Play Services (e.g. AOSP emulator) | Use a physical Android phone or an emulator with Google Play Services. |

