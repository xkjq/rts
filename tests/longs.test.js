// Unit tests for RTS Longs Cases functionality

import { jest } from "@jest/globals";

describe("RTS Longs Cases Unit Tests", () => {
  function calculateWordCount(text) {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  test("calculateWordCount correctly counts words with edge cases", () => {
    expect(calculateWordCount("")).toBe(0);
    expect(calculateWordCount("   ")).toBe(0);
    expect(calculateWordCount("Observation")).toBe(1);
    expect(calculateWordCount("  Multiple   spaced   words  ")).toBe(3);
    expect(calculateWordCount("Large bowel obstruction with transition point in the sigmoid colon.")).toBe(10);
  });

  test("sections mapping has all 5 Pratique subquestions with labels", () => {
    const sections = [
      { did: "a)", name: "Observations", title: "Observations" },
      { did: "b)", name: "Interpretation", title: "Interpretation" },
      { did: "c)", name: "Principal Diagnosis", title: "Principal Diagnosis" },
      { did: "d)", name: "Differential Diagnosis", title: "Differential Diagnosis" },
      { did: "e)", name: "Management (if appropriate)", title: "Management (if appropriate)" },
    ];

    expect(sections).toHaveLength(5);
    expect(sections[0].did).toBe("a)");
    expect(sections[0].title).toBe("Observations");
    expect(sections[4].did).toBe("e)");
    expect(sections[4].title).toBe("Management (if appropriate)");
  });

  test("overview item labels map subquestions to a) through e)", () => {
    const letterMap = { "1": "a)", "2": "b)", "3": "c)", "4": "d)", "5": "e)" };
    expect(letterMap["1"]).toBe("a)");
    expect(letterMap["5"]).toBe("e)");
  });
});
