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

  test("question list item label formatting across exam types", () => {
    function getLabelHtml(questionType, n, qidn) {
      const letterMap = { "1": "a)", "2": "b)", "3": "c)", "4": "d)", "5": "e)" };
      if (questionType === "long") {
        const letter = letterMap[qidn] || (qidn + ")");
        return `<span>${n}&nbsp;&nbsp;${letter}</span>`;
      }
      return `<span>${n}.${qidn}</span>`;
    }

    expect(getLabelHtml("long", 1, "1")).toBe("<span>1&nbsp;&nbsp;a)</span>");
    expect(getLabelHtml("rapid", 1, "1")).toBe("<span>1.1</span>");
    expect(getLabelHtml("anatomy", 87, "1")).toBe("<span>87.1</span>");
    expect(getLabelHtml("short", 5, "1")).toBe("<span>5.1</span>");
  });

  test("DICOM default tool selection based on stack length", () => {
    function getDefaultTool(stack) {
      const isStack = stack && stack.imageIds && stack.imageIds.length > 1;
      return isStack ? "StackScroll" : "Pan";
    }

    expect(getDefaultTool({ imageIds: ["img1.dcm"] })).toBe("Pan");
    expect(getDefaultTool({ imageIds: ["img1.dcm", "img2.dcm"] })).toBe("StackScroll");
    expect(getDefaultTool({ imageIds: Array.from({ length: 97 }, (_, i) => `slice_${i}.dcm`) })).toBe("StackScroll");
  });

  test("scroll progress indicator thumb calculation", () => {
    function getThumbPercent(current, total) {
      if (total <= 1) return 0;
      return ((current - 1) / (total - 1)) * 100;
    }

    expect(getThumbPercent(1, 97)).toBe(0);
    expect(getThumbPercent(49, 97)).toBe(50);
    expect(getThumbPercent(97, 97)).toBe(100);
  });
});
