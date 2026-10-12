// Tests for image URL classification helpers.
//
// Media URLs are content-versioned by the server (`?v=<hash>`). The viewer must
// still recognise such URLs as DICOM objects and prefix `wadouri:`, otherwise
// images fail to load once the unbased exam list is in use.
import { describe, test, expect } from "@jest/globals";

import {
  urlPath,
  isDicomUrl,
  questionUrlForExam,
  absoluteUrl,
  isDicomImage,
} from "../js/helpers.js";

describe("urlPath", () => {
  test("strips a query string", () => {
    expect(urlPath("/media/x.dcm?v=abc123")).toBe("/media/x.dcm");
  });

  test("strips a fragment", () => {
    expect(urlPath("/media/x.dcm#frag")).toBe("/media/x.dcm");
  });

  test("strips both query and fragment", () => {
    expect(urlPath("/media/x.dcm?a=1#f")).toBe("/media/x.dcm");
  });

  test("leaves a plain path untouched", () => {
    expect(urlPath("/media/x.dcm")).toBe("/media/x.dcm");
  });
});

describe("isDicomUrl", () => {
  test("recognises .dcm with and without a version query", () => {
    expect(isDicomUrl("/media/a.dcm")).toBe(true);
    expect(isDicomUrl("/media/a.dcm?v=abc123")).toBe(true);
    expect(isDicomUrl("https://example.test/media/a.dcm?v=abc123")).toBe(true);
  });

  test("recognises extensionless final path segments", () => {
    expect(isDicomUrl("/media/atlas/dicom/12345")).toBe(true);
    expect(isDicomUrl("/media/atlas/dicom/12345?v=abc")).toBe(true);
  });

  test("does not treat web images as DICOM", () => {
    expect(isDicomUrl("/media/a.jpg")).toBe(false);
    expect(isDicomUrl("/media/a.jpg?v=1")).toBe(false);
    expect(isDicomUrl("/media/x/y.png")).toBe(false);
  });

  test("handles empty or invalid input", () => {
    expect(isDicomUrl("")).toBe(false);
    expect(isDicomUrl(null)).toBe(false);
    expect(isDicomUrl(undefined)).toBe(false);
    expect(isDicomUrl("/media/")).toBe(false);
  });
});

describe("questionUrlForExam", () => {
  test("appends /question/<id> for based exam URLs", () => {
    expect(questionUrlForExam("/longs/exam/json/5/123/abc", 9)).toBe(
      "/longs/exam/json/5/123/abc/question/9"
    );
  });

  test("inserts /question/<id> before the /unbased suffix", () => {
    expect(questionUrlForExam("/rapids/exam/json/5/unbased", 9)).toBe(
      "/rapids/exam/json/5/question/9/unbased"
    );
    expect(questionUrlForExam("/rapids/exam/json/5/123/abc/unbased", 9)).toBe(
      "/rapids/exam/json/5/123/abc/question/9/unbased"
    );
  });
});

describe("absoluteUrl", () => {
  test("leaves data and blob urls unchanged", () => {
    expect(absoluteUrl("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA"
    );
    expect(absoluteUrl("blob:abc")).toBe("blob:abc");
  });

  test("leaves absolute urls unchanged", () => {
    expect(absoluteUrl("https://example.test/media/x.jpg")).toBe(
      "https://example.test/media/x.jpg"
    );
  });

  test("returns relative urls unchanged when there is no document base", () => {
    // jsdom-less node has no `location`; the browser resolves them instead.
    expect(absoluteUrl("/media/x.jpg")).toBe("/media/x.jpg");
  });
});

describe("isDicomImage", () => {
  test("uses the server-provided flag when present", () => {
    const map = { "/media/a.jpg": true, "/media/b.dcm": false };
    expect(isDicomImage("/media/a.jpg", map)).toBe(true);
    expect(isDicomImage("/media/b.dcm", map)).toBe(false);
  });

  test("falls back to the filename heuristic without a map entry", () => {
    expect(isDicomImage("/media/a.dcm", null)).toBe(true);
    expect(isDicomImage("/media/a.jpg", {})).toBe(false);
  });
});
