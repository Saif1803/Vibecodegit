import { describe, expect, it } from "vitest";
import { fileType } from "./fileIcons";

describe("fileType", () => {
  it("picks by extension, case-insensitively", () => {
    expect(fileType("src/App.tsx")).toBe("reactts");
    expect(fileType("src/git/api.ts")).toBe("typescript");
    expect(fileType("src-tauri/src/lib.rs")).toBe("rust");
    expect(fileType("docs/LOGO.PNG")).toBe("image");
    expect(fileType("a.b/c.json")).toBe("json");
  });

  it("prefers the longest extension", () => {
    expect(fileType("src/vite-env.d.ts")).toBe("typescriptdef");
    expect(fileType("src/git/repo.test.ts")).toBe("testts");
  });

  it("lets a whole file name win over its extension", () => {
    expect(fileType("package.json")).toBe("npm");
    expect(fileType("src-tauri/Cargo.toml")).toBe("cargo");
    expect(fileType("Dockerfile")).toBe("docker");
    expect(fileType(".gitignore")).toBe("git");
    expect(fileType("CMakeLists.txt")).toBe("cmake");
    expect(fileType("Makefile")).toBe("gnu");
  });

  it("uses the file's own language when several claim an extension", () => {
    expect(fileType("src/index.css")).toBe("css");
    expect(fileType("config.yml")).toBe("yaml");
  });

  it("treats .env files as dotenv", () => {
    expect(fileType(".env")).toBe("dotenv");
    expect(fileType("app/.env.local")).toBe("dotenv");
  });

  it("falls back to a plain file", () => {
    expect(fileType("README")).toBe("file");
    expect(fileType("notes.unknownext")).toBe("file");
    expect(fileType("dir.with.dots/noext")).toBe("file");
  });
});
