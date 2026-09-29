import { describe, expect, it } from "vitest";
import { normalizePath, repoName, samePath } from "./repo";


describe("path helpers", () => {
  it("normalizes Windows paths from git's forward-slash form", () => {
    expect(normalizePath("C:/Users/me/proj")).toBe("C:\\Users\\me\\proj");
    expect(normalizePath("C:\\Users\\me\\proj\\")).toBe("C:\\Users\\me\\proj");
    expect(normalizePath("C:\\")).toBe("C:\\");
    expect(normalizePath("/home/me/proj/")).toBe("/home/me/proj");
  });

  it("compares Windows paths case-insensitively", () => {
    expect(samePath("C:/Users/Me/Proj", "c:\\users\\me\\proj\\")).toBe(true);
    expect(samePath("/a/B", "/a/b")).toBe(false);
  });

  it("names a repo after its last segment", () => {
    expect(repoName("C:\\Users\\me\\ClaudeGit")).toBe("ClaudeGit");
    expect(repoName("C:/x/y/")).toBe("y");
  });
});
