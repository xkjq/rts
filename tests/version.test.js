// Unit tests for RTS Version & Update Checking System

import { jest } from "@jest/globals";
import { VERSION, checkForUpdate, startUpdateChecker } from "../js/version.js";

describe("RTS Version Update Checker Unit Tests", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("checkForUpdate calls onUpdate when remote version is newer", async () => {
    const mockOnUpdate = jest.fn();
    const remoteVersion = "9.9.9";

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: remoteVersion }),
    });

    const result = await checkForUpdate(mockOnUpdate);
    expect(result.update).toBe(true);
    expect(result.remote).toBe(remoteVersion);
    expect(mockOnUpdate).toHaveBeenCalledWith(remoteVersion);
  });

  test("checkForUpdate does not call onUpdate when versions match", async () => {
    const mockOnUpdate = jest.fn();

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: VERSION }),
    });

    const result = await checkForUpdate(mockOnUpdate);
    expect(result.update).toBe(false);
    expect(result.remote).toBe(VERSION);
    expect(mockOnUpdate).not.toHaveBeenCalled();
  });

  test("checkForUpdate skips check completely when shouldCheck returns false", async () => {
    const mockOnUpdate = jest.fn();
    const shouldCheck = jest.fn(() => false);
    const mockFetch = jest.fn();
    globalThis.fetch = mockFetch;

    const result = await checkForUpdate(mockOnUpdate, "version.json", shouldCheck);
    expect(shouldCheck).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockOnUpdate).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.update).toBe(false);
  });

  test("checkForUpdate performs check when shouldCheck returns true", async () => {
    const mockOnUpdate = jest.fn();
    const shouldCheck = jest.fn(() => true);

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "9.9.9" }),
    });

    const result = await checkForUpdate(mockOnUpdate, "version.json", shouldCheck);
    expect(shouldCheck).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBeUndefined();
    expect(result.update).toBe(true);
    expect(mockOnUpdate).toHaveBeenCalledWith("9.9.9");
  });

  test("checkForUpdate supports passing shouldCheck as the second argument", async () => {
    const mockOnUpdate = jest.fn();
    const shouldCheck = jest.fn(() => false);
    const mockFetch = jest.fn();
    globalThis.fetch = mockFetch;

    // Called as checkForUpdate(onUpdate, shouldCheck)
    const result = await checkForUpdate(mockOnUpdate, shouldCheck);
    expect(shouldCheck).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
  });

  test("startUpdateChecker respects shouldCheck predicate during polling", () => {
    jest.useFakeTimers();
    try {
      const mockOnUpdate = jest.fn();
      let isExamActive = true;
      const shouldCheck = jest.fn(() => !isExamActive);

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "9.9.9" }),
      });

      const stop = startUpdateChecker(mockOnUpdate, shouldCheck);

      // Initial check should have evaluated shouldCheck
      expect(shouldCheck).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();

      // Advance interval by 60 seconds while exam is still active
      jest.advanceTimersByTime(60 * 1000);
      expect(shouldCheck).toHaveBeenCalledTimes(2);
      expect(globalThis.fetch).not.toHaveBeenCalled();

      // Exam ends
      isExamActive = false;
      jest.advanceTimersByTime(60 * 1000);
      expect(shouldCheck).toHaveBeenCalledTimes(3);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      stop();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("RTS isTakingExam Unit Tests", () => {
  let isTakingExam, setIsTakingExam;

  beforeAll(async () => {
    // Setup minimal DOM and globals for main.js imports
    globalThis.Dexie = class {
      constructor() {}
      version() { return { stores: () => {} }; }
    };
    globalThis.cornerstone = { imageCache: { setMaximumSizeBytes: () => {} } };
    globalThis.cornerstoneTools = { init: () => {} };
    globalThis.cornerstoneBase64ImageLoader = { external: {} };
    globalThis.cornerstoneWebImageLoader = { external: {} };
    globalThis.cornerstoneWADOImageLoader = { external: {} };
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };
    globalThis.sessionStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };
    globalThis.log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, setLevel: () => {} };
    globalThis.$ = jest.fn(() => ({
      length: 0,
      is: () => false,
      hide: () => {},
      show: () => {},
      text: () => {},
      empty: () => ({ text: () => {}, append: () => {} }),
      val: () => ({ show: () => {} }),
      on: () => {},
      off: () => ({ on: () => {} }),
      click: () => {},
      contextmenu: () => {},
      append: () => {},
    }));
    globalThis.$.ajax = jest.fn(() => Promise.resolve({}));
    globalThis.document = {
      getElementById: jest.fn(() => null),
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => []),
      documentElement: { requestFullscreen: jest.fn() },
      exitFullscreen: jest.fn(),
    };
    globalThis.window = {
      location: { search: "", reload: jest.fn() },
      document: globalThis.document,
      localStorage: globalThis.localStorage,
      sessionStorage: globalThis.sessionStorage,
    };

    const mainModule = await import("../js/main.js");
    isTakingExam = mainModule.isTakingExam;
    setIsTakingExam = mainModule.setIsTakingExam;
  });

  test("isTakingExam returns false in default state", () => {
    setIsTakingExam(false);
    expect(isTakingExam()).toBe(false);
  });

  test("isTakingExam returns true when is_taking_exam is true", () => {
    setIsTakingExam(true);
    expect(isTakingExam()).toBe(true);
  });

  test("isTakingExam returns false when setIsTakingExam(false) is called", () => {
    setIsTakingExam(true);
    expect(isTakingExam()).toBe(true);
    setIsTakingExam(false);
    expect(isTakingExam()).toBe(false);
  });

  test("isTakingExam returns false when options panel is visible", () => {
    setIsTakingExam(false);
    globalThis.$ = jest.fn((selector) => {
      if (selector === "#options-panel") {
        return { length: 1, is: (s) => s === ":visible" };
      }
      return { length: 0, is: () => false };
    });

    expect(isTakingExam()).toBe(false);
  });

  test("isTakingExam returns true when start-dialog is open and options-panel is not visible", () => {
    setIsTakingExam(false);
    globalThis.$ = jest.fn((selector) => {
      if (selector === "#options-panel") {
        return { length: 1, is: (s) => false };
      }
      if (selector === "#start-dialog") {
        return { length: 1, is: (s) => s === ":visible" };
      }
      return { length: 0, is: () => false };
    });

    expect(isTakingExam()).toBe(true);
  });
});
