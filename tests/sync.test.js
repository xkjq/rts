// Unit tests for RTS Background Sync

import { jest } from "@jest/globals";

// Mock Dexie and jQuery globally before importing modules that use them
const mockAnswersWhere = jest.fn();
const mockAnswersFilter = jest.fn();
const mockAnswersToArray = jest.fn();
const mockAnswersPut = jest.fn();
const mockTransaction = jest.fn();

globalThis.Dexie = class {
  constructor(name) {
    this.name = name;
    this.answers = {
      where: mockAnswersWhere,
      put: mockAnswersPut,
    };
  }
  version() {
    return {
      stores: () => {}
    };
  }
  transaction(mode, tables, cb) {
    return mockTransaction(mode, tables, cb);
  }
};

// Define mock jQuery $.ajax
const mockAjax = jest.fn();

globalThis.$ = {
  ajax: mockAjax,
};

// Mock DOM elements
const mockHtml = jest.fn();
globalThis.document = {
  getElementById: jest.fn(() => ({
    set innerHTML(val) {
      mockHtml(val);
    }
  })),
};

// Dynamic import to avoid ES module hoisting execution before mocks are set up
let performSync, updateSyncUI;

describe("RTS Sync Unit Tests", () => {
  beforeAll(async () => {
    const syncModule = await import("../js/sync.js");
    performSync = syncModule.performSync;
    updateSyncUI = syncModule.updateSyncUI;
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("updateSyncUI updates the DOM container", () => {
    updateSyncUI("syncing");
    expect(globalThis.document.getElementById).toHaveBeenCalledWith("sync-status");
    expect(mockHtml).toHaveBeenCalledWith(expect.stringContaining("Saving to server..."));
  });

  test("performSync does nothing if exam details are missing", async () => {
    await performSync(null, {});
    expect(mockAnswersWhere).not.toHaveBeenCalled();
  });

  test("performSync processes unsynced answers and marks them as synced", async () => {
    const examDetails = {
      aid: "session-123",
      cid: "9999",
      eid: "rapid/1",
      start_time: 1234567,
      exam_mode: true,
    };
    const URLS = {
      exam_submit_url: "/submit-url",
    };

    const unsyncedAnswers = [
      { aid: "session-123", cid: "9999", eid: "rapid/1", qid: 1, qidn: "1", ans: "Normal", synced: false }
    ];

    mockAnswersWhere.mockReturnValue({
      filter: mockAnswersFilter.mockReturnValue({
        toArray: mockAnswersToArray.mockResolvedValue(unsyncedAnswers)
      })
    });

    mockAjax.mockImplementation((options) => {
      if (options.success) {
        options.success({ success: true });
      }
    });

    mockTransaction.mockImplementation(async (mode, tables, cb) => {
      await cb();
    });

    await performSync(examDetails, URLS);

    expect(mockAnswersWhere).toHaveBeenCalledWith({
      aid: examDetails.aid,
      cid: examDetails.cid,
      eid: examDetails.eid,
    });
    expect(mockAjax).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "POST",
        url: URLS.exam_submit_url,
        dataType: "json",
        global: false,
        data: expect.objectContaining({
          in_progress: "true",
        }),
      })
    );
  });
});
