import { describe, expect, it } from "vitest";
import { promptToMessage } from "./prompts";

describe("prompt → commit message", () => {
  it("takes the first line and tidies it", () => {
    expect(promptToMessage("add a dark mode toggle\n\nuse the OS setting by default")).toBe("Add a dark mode toggle");
    expect(promptToMessage("  \n  fix the tray flicker.  ")).toBe("Fix the tray flicker");
  });

  it("drops the conversational wrapping", () => {
    expect(promptToMessage("can you add a dark mode toggle?")).toBe("Add a dark mode toggle");
    expect(promptToMessage("ok, please rename the store keys please")).toBe("Rename the store keys");
    expect(promptToMessage("Now let's split App.tsx!")).toBe("Split App.tsx");
  });

  it("leaves an empty prompt empty", () => {
    expect(promptToMessage("   \n ")).toBe("");
  });
});
