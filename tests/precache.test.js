// Tests for the exam pre-cache module (image enumeration + Cache Storage).
import { describe, test, expect } from "@jest/globals";

import {
  collectImageUrls,
  collectExamImageUrls,
  normalizeUrl,
  isCacheableUrl,
  prefetchImageUrls,
  preCacheExam,
  selectExpiredExams,
  subtractUrls,
  clearImageCache,
  COMPLETED_EXAM_RETENTION_MS,
} from "../js/precache.js";

class FakeCache {
  constructor() {
    this.map = new Map();
    this.puts = 0;
  }
  async match(url) {
    return this.map.get(url);
  }
  async put(url, response) {
    this.puts++;
    this.map.set(url, response);
  }
  async delete(url) {
    return this.map.delete(url);
  }
}

function fakeResponse(status = 200, contentLength = 10) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === "content-length" ? String(contentLength) : null) },
  };
}

describe("collectImageUrls", () => {
  test("collects a flat images array", () => {
    expect(collectImageUrls({ images: ["/a.dcm", "/b.dcm"] })).toEqual([
      "/a.dcm",
      "/b.dcm",
    ]);
  });

  test("collects nested series arrays (longs)", () => {
    expect(
      collectImageUrls({ images: [["/s1/a.dcm"], ["/s2/a.dcm", "/s2/b.dcm"]] })
    ).toEqual(["/s1/a.dcm", "/s2/a.dcm", "/s2/b.dcm"]);
  });

  test("includes feedback images", () => {
    expect(
      collectImageUrls({ images: ["/q.dcm"], feedback_images: ["/f.dcm"] })
    ).toEqual(["/q.dcm", "/f.dcm"]);
  });

  test("deduplicates and ignores inline data URLs", () => {
    expect(
      collectImageUrls({
        images: ["/a.dcm", "/a.dcm", "data:image/png;base64,AAAA"],
      })
    ).toEqual(["/a.dcm"]);
  });

  test("handles missing or invalid payloads", () => {
    expect(collectImageUrls(null)).toEqual([]);
    expect(collectImageUrls({})).toEqual([]);
  });
});

describe("collectExamImageUrls", () => {
  test("unions across questions", () => {
    expect(
      collectExamImageUrls([
        { images: ["/a.dcm"] },
        { images: [["/a.dcm", "/b.dcm"]] },
      ])
    ).toEqual(["/a.dcm", "/b.dcm"]);
  });
});

describe("normalizeUrl / isCacheableUrl", () => {
  test("leaves relative URLs alone without a document base", () => {
    expect(normalizeUrl("/media/a.dcm?v=1")).toBe("/media/a.dcm?v=1");
  });

  test("data and blob URLs are not cacheable", () => {
    expect(isCacheableUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isCacheableUrl("blob:abc")).toBe(false);
    expect(isCacheableUrl("/media/a.dcm")).toBe(true);
  });
});

describe("prefetchImageUrls", () => {
  test("downloads missing images and records bytes", async () => {
    const cache = new FakeCache();
    const fetched = [];
    const result = await prefetchImageUrls(["/a.dcm", "/b.dcm"], {
      cache,
      fetchFn: async (url) => {
        fetched.push(url);
        return fakeResponse(200, 100);
      },
    });

    expect(result.total).toBe(2);
    expect(result.downloaded).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.bytes).toBe(200);
    expect(fetched.sort()).toEqual(["/a.dcm", "/b.dcm"]);
    expect(cache.puts).toBe(2);
  });

  test("skips already-cached images (resume)", async () => {
    const cache = new FakeCache();
    await cache.put("/a.dcm", fakeResponse());
    let fetchCount = 0;
    const result = await prefetchImageUrls(["/a.dcm", "/b.dcm"], {
      cache,
      fetchFn: async () => {
        fetchCount++;
        return fakeResponse();
      },
    });

    expect(result.downloaded).toBe(1);
    expect(result.skipped).toBe(1);
    expect(fetchCount).toBe(1);
  });

  test("retries then records failures as missing", async () => {
    const cache = new FakeCache();
    let attempts = 0;
    const result = await prefetchImageUrls(["/bad.dcm"], {
      cache,
      retries: 2,
      fetchFn: async () => {
        attempts++;
        return fakeResponse(500);
      },
    });

    expect(attempts).toBe(3); // initial + 2 retries
    expect(result.failed).toBe(1);
    expect(result.missing).toEqual(["/bad.dcm"]);
  });

  test("reports everything missing when Cache Storage is unavailable", async () => {
    const result = await prefetchImageUrls(["/a.dcm"], {
      cache: null,
      fetchFn: null,
    });
    // openImageCache() returns null in the jsdom-less node env.
    expect(result.missing).toEqual(["/a.dcm"]);
    expect(result.failed).toBe(1);
  });

  test("invokes onProgress for each settled URL", async () => {
    const cache = new FakeCache();
    const seen = [];
    await prefetchImageUrls(["/a.dcm", "/b.dcm"], {
      cache,
      fetchFn: async () => fakeResponse(),
      onProgress: (r, url) => seen.push(url),
    });
    expect(seen.sort()).toEqual(["/a.dcm", "/b.dcm"]);
  });
});

describe("preCacheExam", () => {
  test("returns the enumerated urls", async () => {
    const cache = new FakeCache();
    const result = await preCacheExam(
      [{ images: ["/a.dcm"] }, { images: [["/b.dcm"]] }],
      { cache, fetchFn: async () => fakeResponse() }
    );
    expect(result.urls.sort()).toEqual(["/a.dcm", "/b.dcm"]);
    expect(result.downloaded).toBe(2);
  });
});

describe("selectExpiredExams", () => {
  const now = 10 * COMPLETED_EXAM_RETENTION_MS;

  test("selects only completed sessions past the retention window", () => {
    const expired = selectExpiredExams(
      [
        { eid: "old/1", status: "complete", date: now - COMPLETED_EXAM_RETENTION_MS - 1 },
        { eid: "recent/2", status: "complete", date: now - 1000 },
        { eid: "active/3", status: "active", date: now - COMPLETED_EXAM_RETENTION_MS - 1 },
      ],
      now
    );
    expect(expired).toEqual(["old/1"]);
  });

  test("ignores records without a date and deduplicates", () => {
    const expired = selectExpiredExams(
      [
        { eid: "old/1", status: "complete", date: now - COMPLETED_EXAM_RETENTION_MS - 1 },
        { eid: "old/1", status: "complete", date: now - COMPLETED_EXAM_RETENTION_MS - 1 },
        { eid: "nodate/9", status: "complete" },
      ],
      now
    );
    expect(expired).toEqual(["old/1"]);
  });
});

describe("subtractUrls", () => {
  test("removes urls still referenced by a retained exam", () => {
    expect(subtractUrls(["/a.dcm", "/b.dcm"], ["/b.dcm"])).toEqual(["/a.dcm"]);
  });

  test("ignores inline data urls and dedupes", () => {
    expect(
      subtractUrls(
        ["/a.dcm", "/a.dcm", "data:image/png;base64,AAAA"],
        []
      )
    ).toEqual(["/a.dcm"]);
  });
});

describe("clearImageCache", () => {
  test("is a no-op when Cache Storage is unavailable", async () => {
    expect(await clearImageCache()).toBe(false);
  });
});
