import { generateUUID } from "../src/utils/uuid";

describe("UUID Generator", () => {
  it("generates valid v4 UUID strings", () => {
    const uuid = generateUUID();
    expect(uuid).toBeDefined();
    // Match RFC4122 v4 pattern
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuid).toMatch(uuidRegex);
  });

  it("generates unique UUIDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateUUID());
    }
    expect(ids.size).toBe(100);
  });
});
