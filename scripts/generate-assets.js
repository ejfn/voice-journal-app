/**
 * Generates custom branding assets for Voice Journal:
 * - assets/icon.png (1024x1024, RGB no-alpha, iOS & App Store)
 * - assets/android-icon-foreground.png (512x512, RGBA, safe-zone safe)
 * - assets/android-icon-background.png (512x512, RGBA, matching gradient)
 * - assets/android-icon-monochrome.png (432x432, RGBA, single-color Material You)
 * - assets/splash-icon.png (1024x1024, RGBA, centered emblem)
 * - assets/favicon.png (48x48, RGBA, crisp web favicon)
 */

const sharp = require('sharp');
const path = require('path');

const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');

// Shared SVG definitions (gradients & filters)
const DEFS = `
  <defs>
    <!-- Background Gradient: Deep Midnight Indigo / Slate -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E1B4B" />
      <stop offset="45%" stop-color="#0F172A" />
      <stop offset="100%" stop-color="#080C15" />
    </linearGradient>

    <!-- Radial Ambient Glow -->
    <radialGradient id="ambientGlow" cx="50%" cy="48%" r="48%">
      <stop offset="0%" stop-color="#6366F1" stop-opacity="0.38" />
      <stop offset="60%" stop-color="#4F46E5" stop-opacity="0.14" />
      <stop offset="100%" stop-color="#0F172A" stop-opacity="0" />
    </radialGradient>

    <!-- Journal Cover Backing Gradient -->
    <linearGradient id="coverGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#312E81" />
      <stop offset="100%" stop-color="#1E1B4B" />
    </linearGradient>

    <!-- Left Page Gradient -->
    <linearGradient id="leftPageGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#F1F5F9" />
      <stop offset="85%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#E2E8F0" />
    </linearGradient>

    <!-- Right Page Gradient -->
    <linearGradient id="rightPageGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#CBD5E1" />
      <stop offset="15%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#F8FAFC" />
    </linearGradient>

    <!-- Waveform Gradient (Vibrant Cyan -> Electric Blue -> Indigo -> Violet -> Magenta) -->
    <linearGradient id="waveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38BDF8" />
      <stop offset="28%" stop-color="#60A5FA" />
      <stop offset="55%" stop-color="#6366F1" />
      <stop offset="80%" stop-color="#8B5CF6" />
      <stop offset="100%" stop-color="#C084FC" />
    </linearGradient>

    <!-- AI Sparkle Gradient -->
    <linearGradient id="sparkleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FCD34D" />
      <stop offset="50%" stop-color="#F59E0B" />
      <stop offset="100%" stop-color="#EC4899" />
    </linearGradient>

    <!-- Bookmark Ribbon Gradient -->
    <linearGradient id="ribbonGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#818CF8" />
      <stop offset="100%" stop-color="#4F46E5" />
    </linearGradient>

    <!-- Soft Drop Shadow Filter -->
    <filter id="bookShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#000000" flood-opacity="0.5" />
    </filter>

    <!-- Sparkle Glow Filter -->
    <filter id="sparkleGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="8" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>
`;

/**
 * Journal Emblem symbol group centered at (0, 0)
 */
const EMBLEM_GRAPHIC = `
  <g filter="url(#bookShadow)">
    <!-- Left Cover -->
    <path d="M -8 -180 C -42 -195, -125 -210, -245 -184 C -260 -181, -270 -167, -270 -151 L -270 148 C -270 164, -258 178, -242 176 C -128 162, -47 178, -8 198 Z"
          fill="url(#coverGrad)" />
    <!-- Right Cover -->
    <path d="M 8 -180 C 42 -195, 125 -210, 245 -184 C 260 -181, 270 -167, 270 -151 L 270 148 C 270 164, 258 178, 242 176 C 128 162, 47 178, 8 198 Z"
          fill="url(#coverGrad)" />

    <!-- Left Page Surface -->
    <path d="M -6 -170 C -38 -184, -118 -198, -232 -173 C -246 -170, -255 -157, -255 -143 L -255 135 C -255 150, -244 162, -229 160 C -122 147, -44 161, -6 180 Z"
          fill="url(#leftPageGrad)" />

    <!-- Right Page Surface -->
    <path d="M 6 -170 C 38 -184, 118 -198, 232 -173 C 246 -170, 255 -157, 255 -143 L 255 135 C 255 150, 244 162, 229 160 C 122 147, 44 161, 6 180 Z"
          fill="url(#rightPageGrad)" />

    <!-- Spine Center Crease -->
    <path d="M 0 -172 L 0 184" stroke="#94A3B8" stroke-width="3.5" stroke-linecap="round" opacity="0.6" />
  </g>

  <!-- Bookmark Ribbon -->
  <path d="M -10 -174 L 10 -174 L 10 -228 L 0 -216 L -10 -228 Z" fill="url(#ribbonGrad)" opacity="0.95" />

  <!-- Waveform Bars (8 bars, 4 per page) -->
  <g fill="url(#waveGrad)">
    <rect x="-195" y="-37.5" width="22" height="75" rx="11" />
    <rect x="-152" y="-75" width="22" height="150" rx="11" />
    <rect x="-109" y="-112.5" width="22" height="225" rx="11" />
    <rect x="-66" y="-142.5" width="22" height="285" rx="11" />

    <rect x="44" y="-142.5" width="22" height="285" rx="11" />
    <rect x="87" y="-112.5" width="22" height="225" rx="11" />
    <rect x="130" y="-75" width="22" height="150" rx="11" />
    <rect x="173" y="-37.5" width="22" height="75" rx="11" />
  </g>

  <!-- Primary AI Sparkle Star ("Speak your mind. AI captures the rest.") -->
  <g transform="translate(216, -192)" filter="url(#sparkleGlow)">
    <path d="M 0 -36 C 0 -11, 11 0, 36 0 C 11 0, 0 11, 0 36 C 0 11, -11 0, -36 0 C -11 0, 0 -11, 0 -36 Z"
          fill="url(#sparkleGrad)" />
    <circle cx="0" cy="0" r="4.5" fill="#FFFFFF" />
  </g>

  <!-- Secondary Smaller Sparkle -->
  <g transform="translate(254, -148) scale(0.42)" filter="url(#sparkleGlow)">
    <path d="M 0 -36 C 0 -11, 11 0, 36 0 C 11 0, 0 11, 0 36 C 0 11, -11 0, -36 0 C -11 0, 0 -11, 0 -36 Z"
          fill="url(#sparkleGrad)" />
  </g>
`;

/**
 * 1. Main App Icon (1024x1024, RGB, solid edge-to-edge background)
 */
function getMainIconSvg() {
  return `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${DEFS}
  <!-- Solid background layer -->
  <rect width="1024" height="1024" fill="url(#bgGrad)" />
  <rect width="1024" height="1024" fill="url(#ambientGlow)" />

  <!-- Centered Emblem -->
  <g transform="translate(512, 514) scale(0.84)">
    ${EMBLEM_GRAPHIC}
  </g>
</svg>
`;
}

/**
 * 2. Android Adaptive Icon Foreground (512x512, RGBA, transparent background, safe-zone compliant)
 */
function getAndroidForegroundSvg() {
  return `
<svg width="512" height="512" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${DEFS}
  <!-- Centered Emblem with transparent background -->
  <g transform="translate(512, 514) scale(0.84)">
    ${EMBLEM_GRAPHIC}
  </g>
</svg>
`;
}

/**
 * 3. Android Adaptive Icon Background (512x512, matching deep navy gradient)
 */
function getAndroidBackgroundSvg() {
  return `
<svg width="512" height="512" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${DEFS}
  <rect width="1024" height="1024" fill="url(#bgGrad)" />
  <rect width="1024" height="1024" fill="url(#ambientGlow)" />
</svg>
`;
}

/**
 * 4. Android Themed Monochrome Icon (432x432, RGBA, pure white single-color silhouette)
 */
function getAndroidMonochromeSvg() {
  return `
<svg width="432" height="432" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(512, 514) scale(0.84)" fill="#FFFFFF">
    <!-- Book Outline -->
    <path d="M -8 -180 C -42 -195, -125 -210, -245 -184 C -260 -181, -270 -167, -270 -151 L -270 148 C -270 164, -258 178, -242 176 C -128 162, -47 178, -8 198 Z"
          fill="none" stroke="#FFFFFF" stroke-width="24" stroke-linejoin="round" />
    <path d="M 8 -180 C 42 -195, 125 -210, 245 -184 C 260 -181, 270 -167, 270 -151 L 270 148 C 270 164, 258 178, 242 176 C 128 162, 47 178, 8 198 Z"
          fill="none" stroke="#FFFFFF" stroke-width="24" stroke-linejoin="round" />
    <line x1="0" y1="-180" x2="0" y2="198" stroke="#FFFFFF" stroke-width="20" stroke-linecap="round" />

    <!-- Bookmark Ribbon -->
    <path d="M -10 -174 L 10 -174 L 10 -228 L 0 -216 L -10 -228 Z" fill="#FFFFFF" />

    <!-- Waveform Bars -->
    <rect x="-195" y="-37.5" width="22" height="75" rx="11" />
    <rect x="-152" y="-75" width="22" height="150" rx="11" />
    <rect x="-109" y="-112.5" width="22" height="225" rx="11" />
    <rect x="-66" y="-142.5" width="22" height="285" rx="11" />

    <rect x="44" y="-142.5" width="22" height="285" rx="11" />
    <rect x="87" y="-112.5" width="22" height="225" rx="11" />
    <rect x="130" y="-75" width="22" height="150" rx="11" />
    <rect x="173" y="-37.5" width="22" height="75" rx="11" />

    <!-- AI Sparkles -->
    <g transform="translate(216, -192)">
      <path d="M 0 -36 C 0 -11, 11 0, 36 0 C 11 0, 0 11, 0 36 C 0 11, -11 0, -36 0 C -11 0, 0 -11, 0 -36 Z" />
    </g>
    <g transform="translate(254, -148) scale(0.42)">
      <path d="M 0 -36 C 0 -11, 11 0, 36 0 C 11 0, 0 11, 0 36 C 0 11, -11 0, -36 0 C -11 0, 0 -11, 0 -36 Z" />
    </g>
  </g>
</svg>
`;
}

/**
 * 5. Splash Screen Asset (1024x1024, RGBA, centered brand emblem on transparent background)
 */
function getSplashIconSvg() {
  return `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${DEFS}
  <!-- Centered Emblem with soft ambient glow on transparent background -->
  <circle cx="512" cy="514" r="320" fill="url(#ambientGlow)" />
  <g transform="translate(512, 514) scale(0.84)">
    ${EMBLEM_GRAPHIC}
  </g>
</svg>
`;
}

/**
 * 6. Web Favicon (48x48, RGBA, crisp geometry)
 */
function getFaviconSvg() {
  return `
<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1E1B4B" />
      <stop offset="100%" stop-color="#0F172A" />
    </linearGradient>
    <linearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#38BDF8" />
      <stop offset="50%" stop-color="#6366F1" />
      <stop offset="100%" stop-color="#C084FC" />
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="10" fill="url(#bg)" />

  <!-- Book Pages -->
  <path d="M 9 13 C 14 11.5, 20 12, 23.5 13.5 L 23.5 35.5 C 20 34, 14 33.5, 9 35 Z" fill="#F8FAFC" />
  <path d="M 39 13 C 34 11.5, 28 12, 24.5 13.5 L 24.5 35.5 C 28 34, 34 33.5, 39 35 Z" fill="#E2E8F0" />

  <!-- Spine -->
  <line x1="24" y1="13" x2="24" y2="35.5" stroke="#94A3B8" stroke-width="1" />

  <!-- Waveform Bars -->
  <g fill="url(#wave)">
    <rect x="13" y="21" width="2" height="6" rx="1" />
    <rect x="16.5" y="18" width="2" height="12" rx="1" />
    <rect x="20" y="15" width="2" height="18" rx="1" />

    <rect x="26" y="15" width="2" height="18" rx="1" />
    <rect x="29.5" y="18" width="2" height="12" rx="1" />
    <rect x="33" y="21" width="2" height="6" rx="1" />
  </g>
</svg>
`;
}

async function generateAllAssets() {
  console.log('Generating custom branding assets...');

  // 1. icon.png: 1024x1024, RGB, solid, no alpha
  await sharp(Buffer.from(getMainIconSvg()))
    .removeAlpha()
    .png()
    .toFile(path.join(ASSETS_DIR, 'icon.png'));
  console.log('✓ Generated assets/icon.png (1024x1024, RGB)');

  // 2. android-icon-foreground.png: 512x512, RGBA
  await sharp(Buffer.from(getAndroidForegroundSvg()))
    .ensureAlpha()
    .png()
    .toFile(path.join(ASSETS_DIR, 'android-icon-foreground.png'));
  console.log('✓ Generated assets/android-icon-foreground.png (512x512, RGBA)');

  // 3. android-icon-background.png: 512x512, RGBA
  await sharp(Buffer.from(getAndroidBackgroundSvg()))
    .png()
    .toFile(path.join(ASSETS_DIR, 'android-icon-background.png'));
  console.log('✓ Generated assets/android-icon-background.png (512x512, RGBA)');

  // 4. android-icon-monochrome.png: 432x432, RGBA
  await sharp(Buffer.from(getAndroidMonochromeSvg()))
    .ensureAlpha()
    .png()
    .toFile(path.join(ASSETS_DIR, 'android-icon-monochrome.png'));
  console.log('✓ Generated assets/android-icon-monochrome.png (432x432, RGBA)');

  // 5. splash-icon.png: 1024x1024, RGBA
  await sharp(Buffer.from(getSplashIconSvg()))
    .ensureAlpha()
    .png()
    .toFile(path.join(ASSETS_DIR, 'splash-icon.png'));
  console.log('✓ Generated assets/splash-icon.png (1024x1024, RGBA)');

  // 6. favicon.png: 48x48, RGBA
  await sharp(Buffer.from(getFaviconSvg()))
    .ensureAlpha()
    .png()
    .toFile(path.join(ASSETS_DIR, 'favicon.png'));
  console.log('✓ Generated assets/favicon.png (48x48, RGBA)');

  console.log('All branding assets successfully created!');
}

if (require.main === module) {
  generateAllAssets().catch((err) => {
    console.error('Failed to generate assets:', err);
    process.exit(1);
  });
}

module.exports = { generateAllAssets };
