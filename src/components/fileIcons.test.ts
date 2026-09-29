import { describe, expect, it } from "vitest";
import { fileType } from "./fileIcons";

describe("fileType", () => {
  it("picks by extension, case-insensitively", () => {
    expect(fileType("src/App.tsx")).toBe("react");
    expect(fileType("src/git/api.ts")).toBe("ts");
    expect(fileType("src-tauri/src/lib.rs")).toBe("rust");
    expect(fileType("docs/LOGO.PNG")).toBe("image");
    expect(fileType("a.b/c.json")).toBe("json");
  });

  it("lets a whole file name win over its extension", () => {
    expect(fileType("package.json")).toBe("npm");
    expect(fileType("src-tauri/Cargo.toml")).toBe("rust");
    expect(fileType("Dockerfile")).toBe("docker");
    expect(fileType(".gitignore")).toBe("git");
  });

  it("treats .env files as config", () => {
    expect(fileType(".env")).toBe("config");
    expect(fileType("app/.env.local")).toBe("config");
  });

  it("falls back to a plain file", () => {
    expect(fileType("README")).toBe("file");
    expect(fileType("notes.unknownext")).toBe("file");
    expect(fileType("dir.with.dots/noext")).toBe("file");
  });
});
