import { getAppVersion } from "../src/utils/versioning";

describe("versioning", () => {
  it("returns a non-empty version string", () => {
    const version = getAppVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
    expect(version).toMatch(/^v\d+\.\d+\.\d+/);
  });
});
