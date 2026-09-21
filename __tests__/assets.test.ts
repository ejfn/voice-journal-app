import fs from "fs";
import path from "path";
import sharp from "sharp";

describe("App Assets & Branding Verification", () => {
  const assetsDir = path.resolve(__dirname, "..", "assets");
  const appJsonPath = path.resolve(__dirname, "..", "app.json");

  test("all required asset files exist and are non-empty", () => {
    const requiredAssets = [
      "icon.png",
      "android-icon-foreground.png",
      "android-icon-background.png",
      "android-icon-monochrome.png",
      "splash-icon.png",
      "favicon.png",
    ];

    for (const filename of requiredAssets) {
      const filePath = path.join(assetsDir, filename);
      expect(fs.existsSync(filePath)).toBe(true);
      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  test("main app icon (icon.png) meets iOS/App Store requirements", async () => {
    const iconPath = path.join(assetsDir, "icon.png");
    const metadata = await sharp(iconPath).metadata();

    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(1024);
    // iOS and App Store require solid icon with no alpha channel
    expect(metadata.hasAlpha).toBe(false);
  });

  test("android adaptive foreground has transparent background and complies with safe zone", async () => {
    const fgPath = path.join(assetsDir, "android-icon-foreground.png");
    const metadata = await sharp(fgPath).metadata();

    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
    expect(metadata.hasAlpha).toBe(true);

    // Safe zone verification: on a 512x512 canvas, outer corners should be fully transparent
    // Test the 4 corners: (0,0), (511,0), (0,511), (511,511)
    const { data } = await sharp(fgPath)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const getAlphaAt = (x: number, y: number): number => {
      const index = (y * 512 + x) * 4;
      return data[index + 3];
    };

    expect(getAlphaAt(0, 0)).toBe(0);
    expect(getAlphaAt(511, 0)).toBe(0);
    expect(getAlphaAt(0, 511)).toBe(0);
    expect(getAlphaAt(511, 511)).toBe(0);

    // Also check 10% margin from edges to ensure core artwork is inside safe zone
    expect(getAlphaAt(30, 30)).toBe(0);
    expect(getAlphaAt(480, 30)).toBe(0);
    expect(getAlphaAt(30, 480)).toBe(0);
    expect(getAlphaAt(480, 480)).toBe(0);
  });

  test("android adaptive background has correct dimensions", async () => {
    const bgPath = path.join(assetsDir, "android-icon-background.png");
    const metadata = await sharp(bgPath).metadata();

    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
  });

  test("android monochrome icon has single-color channels for dynamic theming", async () => {
    const monoPath = path.join(assetsDir, "android-icon-monochrome.png");
    const metadata = await sharp(monoPath).metadata();

    expect(metadata.width).toBe(432);
    expect(metadata.height).toBe(432);
    expect(metadata.hasAlpha).toBe(true);

    // Check pixel data: any non-transparent pixel should have R == G == B (white or neutral grayscale)
    const { data } = await sharp(monoPath)
      .raw()
      .toBuffer({ resolveWithObject: true });
    let nonTransparentCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a > 20) {
        nonTransparentCount++;
        // Allow tiny rounding tolerances for antialiasing
        expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
        expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
      }
    }

    expect(nonTransparentCount).toBeGreaterThan(100);
  });

  test("splash screen asset has correct dimensions and transparency", async () => {
    const splashPath = path.join(assetsDir, "splash-icon.png");
    const metadata = await sharp(splashPath).metadata();

    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(1024);
    expect(metadata.hasAlpha).toBe(true);
  });

  test("web favicon has correct dimensions", async () => {
    const faviconPath = path.join(assetsDir, "favicon.png");
    const metadata = await sharp(faviconPath).metadata();

    expect(metadata.width).toBe(48);
    expect(metadata.height).toBe(48);
  });

  test("app.json configures splash screen and matching adaptiveIcon backgroundColor", () => {
    const appJsonRaw = fs.readFileSync(appJsonPath, "utf8");
    const appJson = JSON.parse(appJsonRaw);

    expect(appJson.expo.icon).toBe("./assets/icon.png");
    expect(appJson.expo.splash).toBeDefined();
    expect(appJson.expo.splash.image).toBe("./assets/splash-icon.png");
    expect(appJson.expo.splash.backgroundColor).toBe("#0B0F19");
    expect(appJson.expo.android.adaptiveIcon.backgroundColor).toBe("#0B0F19");
    expect(appJson.expo.android.adaptiveIcon.foregroundImage).toBe(
      "./assets/android-icon-foreground.png",
    );
    expect(appJson.expo.android.adaptiveIcon.backgroundImage).toBe(
      "./assets/android-icon-background.png",
    );
    expect(appJson.expo.android.adaptiveIcon.monochromeImage).toBe(
      "./assets/android-icon-monochrome.png",
    );
    expect(appJson.expo.web.favicon).toBe("./assets/favicon.png");
  });
});
