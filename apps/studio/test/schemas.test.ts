import { describe, expect, it } from "vitest";
import { DocumentDetailSchema } from "../lib/schemas";

const base = {
  id: "1", kind: "faq", title: "t", status: "ready", active_version_id: "v", active_version: 1,
  created_at: "2026-01-01", versions: [],
};

describe("DocumentDetailSchema faq", () => {
  it("accepts a parsed faq, null, or absence", () => {
    expect(DocumentDetailSchema.parse({ ...base, faq: { question: "q", answer: "a" } }).faq).toEqual({ question: "q", answer: "a" });
    expect(DocumentDetailSchema.parse({ ...base, faq: null }).faq).toBeNull();
    expect(DocumentDetailSchema.parse({ ...base, kind: "file" }).faq).toBeUndefined();
  });
});
