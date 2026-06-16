import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("web scaffold", () => {
  it("loads the landing page entrypoint", () => {
    expect(HomePage).toBeTypeOf("function");
  });
});
