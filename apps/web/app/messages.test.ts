import { describe, expect, it } from "vitest";
import { readingStates } from "@paper-viewer/core/paper-status";
import en from "../messages/en.json";
import zh from "../messages/zh.json";

type Messages = Record<string, Record<string, string>>;

function flatten(messages: Messages): string[] {
  return Object.entries(messages).flatMap(([namespace, group]) =>
    Object.keys(group).map((key) => `${namespace}.${key}`)
  );
}

/**
 * ICU argument names, e.g. `{count, plural, ...}` and `{date}`. The trailing
 * `[,}]` keeps plural branch text (`{# comment}`, `{Delete this annotation?}`)
 * out, and the set collapses names repeated across branches.
 */
function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((match) => match[1]!))].sort();
}

describe("message catalogs", () => {
  it("keeps both locales on the same keys in the same order", () => {
    expect(flatten(zh as Messages)).toEqual(flatten(en as Messages));
  });

  it("keeps the same ICU placeholders in every translation", () => {
    for (const [namespace, group] of Object.entries(en as Messages)) {
      for (const [key, message] of Object.entries(group)) {
        const translated = (zh as Messages)[namespace]![key]!;
        expect(placeholders(translated), `${namespace}.${key}`).toEqual(placeholders(message));
      }
    }
  });

  it("translates every reading state, which is looked up by its raw enum value", () => {
    for (const state of readingStates) {
      expect(Object.keys(en.readingState)).toContain(state);
      expect(Object.keys(zh.readingState)).toContain(state);
    }
  });
});
