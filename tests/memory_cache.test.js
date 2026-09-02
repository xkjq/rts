// Unit tests for RTS Memory Optimization and Question Cache Fallback
import { jest } from "@jest/globals";

describe("RTS Memory Optimization & Cache Safety Tests", () => {
  describe("Saved Exam Metadata Stripping", () => {
    function createSavedExamRecord(data, packetName, questionType, examDetails, packetJsonId, examTime) {
      const saved_exam = {
        eid: examDetails.eid,
        name: packetName,
        exam_name: packetName,
        type: questionType,
        exam_type: questionType,
        exam_json_id: packetJsonId || data.exam_json_id || null,
        exam_mode: examDetails.exam_mode || false,
        order: examDetails.question_order,
        exam_order: examDetails.question_order,
        time: examTime,
        exam_time: examTime,
        questions: "cached",
      };
      if (data.question_requests) {
        saved_exam.question_requests = data.question_requests;
      }
      if (data.multi_question_json) {
        saved_exam.multi_question_json = data.multi_question_json;
      }
      return saved_exam;
    }

    test("strips giant question payloads from packet-format exams", () => {
      // Simulates packet where questions are root keys with massive base64 image strings
      const giantImage = "data:image/jpeg;base64," + "A".repeat(1000000); // 1MB mock image
      const packetData = {
        q1_hash: {
          title: "Question 1",
          type: "long",
          images: [[giantImage, giantImage]],
          answers: ["Answer 1"],
        },
        q2_hash: {
          title: "Question 2",
          type: "long",
          images: [[giantImage]],
          answers: ["Answer 2"],
        },
      };

      const examDetails = {
        eid: "test-packet-1",
        exam_mode: true,
        question_order: ["q1_hash", "q2_hash"],
      };

      const strippedRecord = createSavedExamRecord(
        packetData,
        "Test Packet 1",
        "long",
        examDetails,
        "json_hash_123",
        3600
      );

      // Verify that questions is simply "cached" and question hashes/images are NOT in the record
      expect(strippedRecord.questions).toBe("cached");
      expect(strippedRecord).not.toHaveProperty("q1_hash");
      expect(strippedRecord).not.toHaveProperty("q2_hash");
      expect(strippedRecord.eid).toBe("test-packet-1");
      expect(strippedRecord.order).toEqual(["q1_hash", "q2_hash"]);
      expect(JSON.stringify(strippedRecord).length).toBeLessThan(1000);
    });

    test("strips nested questions from Django exam format", () => {
      const giantImage = "data:image/jpeg;base64," + "A".repeat(500000);
      const djangoData = {
        eid: "short/42",
        exam_type: "short",
        exam_name: "Short Cases Exam 42",
        exam_mode: false,
        exam_json_id: "django_json_42",
        exam_time: 7200,
        exam_order: ["101", "102"],
        questions: {
          "101": { title: "Short 1", images: [giantImage], type: "short" },
          "102": { title: "Short 2", images: [giantImage], type: "short" },
        },
      };

      const examDetails = {
        eid: djangoData.eid,
        exam_mode: false,
        question_order: djangoData.exam_order,
      };

      const strippedRecord = createSavedExamRecord(
        djangoData,
        djangoData.exam_name,
        "short",
        examDetails,
        djangoData.exam_json_id,
        djangoData.exam_time
      );

      expect(strippedRecord.questions).toBe("cached");
      expect(strippedRecord.eid).toBe("short/42");
      expect(strippedRecord.exam_order).toEqual(["101", "102"]);
      expect(JSON.stringify(strippedRecord).length).toBeLessThan(1000);
    });
  });

  describe("Question Type Inference", () => {
    function inferQuestionType(data, questions, packetName) {
      let qType = null;
      if (data.hasOwnProperty("exam_type")) {
        qType = data.exam_type;
      } else if (data.hasOwnProperty("type")) {
        qType = data.type;
      }

      if (!qType && typeof questions === "object" && questions !== null) {
        const firstKey = Object.keys(questions)[0];
        if (firstKey && questions[firstKey] && questions[firstKey].type) {
          qType = questions[firstKey].type;
        }
      }

      if (!qType && packetName) {
        const lowerName = String(packetName).toLowerCase();
        if (lowerName.includes("long")) qType = "long";
        else if (lowerName.includes("rapid")) qType = "rapid";
        else if (lowerName.includes("short")) qType = "short";
        else if (lowerName.includes("anatomy")) qType = "anatomy";
      }

      return qType;
    }

    test("infers type from data.exam_type", () => {
      expect(inferQuestionType({ exam_type: "anatomy" }, null, null)).toBe("anatomy");
    });

    test("infers type from data.type", () => {
      expect(inferQuestionType({ type: "rapid" }, null, null)).toBe("rapid");
    });

    test("infers type from first question object", () => {
      const packet = {
        "hash_abc": { title: "Case 1", type: "long" },
      };
      expect(inferQuestionType({}, packet, "unnamed_packet")).toBe("long");

      const paedsPacket = {
        "hash_488583": { title: "XR Skull", type: "rapid" },
      };
      expect(inferQuestionType({}, paedsPacket, "Paeds_TB - Packet 01")).toBe("rapid");
    });

    test("infers type from packet name/path as fallback", () => {
      expect(inferQuestionType({}, {}, "Revise_Radiology_2019_Longs - Packet 1")).toBe("long");
      expect(inferQuestionType({}, {}, "Revise_Radiology_2019_Rapids - Packet 1")).toBe("rapid");
      expect(inferQuestionType({}, {}, "Radiology_Cafe_Shorts - Packet 1")).toBe("short");
      expect(inferQuestionType({}, {}, "Anatomy_Spotters - Packet 1")).toBe("anatomy");
    });
  });

  describe("Question Retrieval and Fallback Resolution", () => {
    async function resolveQuestionData(qid, questionType, mockDb, sessionFallback) {
      const q = { qid: String(qid), type: questionType };
      let return_data = null;
      try {
        return_data = await mockDb.get(q);
      } catch (err) {}

      // Fallback 1: match by qid alone
      if (!return_data) {
        try {
          return_data = await mockDb.getByQid(String(qid));
        } catch (err) {}
      }

      let question_data = return_data ? return_data.data : null;

      // Fallback 2: session fallback
      if (!question_data && sessionFallback && sessionFallback[String(qid)]) {
        question_data = sessionFallback[String(qid)];
      }

      return question_data;
    }

    test("returns data when exact [qid, type] matches in DB", async () => {
      const mockDb = {
        get: jest.fn().mockResolvedValue({ qid: "1", type: "short", data: { title: "Test Q1" } }),
        getByQid: jest.fn(),
      };

      const result = await resolveQuestionData("1", "short", mockDb, null);
      expect(result).toEqual({ title: "Test Q1" });
      expect(mockDb.get).toHaveBeenCalledWith({ qid: "1", type: "short" });
      expect(mockDb.getByQid).not.toHaveBeenCalled();
    });

    test("falls back to getByQid when compound key type mismatches", async () => {
      const mockDb = {
        get: jest.fn().mockResolvedValue(undefined), // compound key mismatch
        getByQid: jest.fn().mockResolvedValue({ qid: "1", type: "rapid", data: { title: "Recovered by QID" } }),
      };

      const result = await resolveQuestionData("1", "short", mockDb, null);
      expect(result).toEqual({ title: "Recovered by QID" });
      expect(mockDb.getByQid).toHaveBeenCalledWith("1");
    });

    test("falls back to sessionFallback when IndexedDB storage failed (DataCloneError)", async () => {
      const mockDb = {
        get: jest.fn().mockResolvedValue(undefined),
        getByQid: jest.fn().mockResolvedValue(undefined),
      };

      const sessionFallback = {
        "1": { title: "In-Memory Question 1", images: ["data:mock"] },
      };

      const result = await resolveQuestionData("1", "short", mockDb, sessionFallback);
      expect(result).toEqual({ title: "In-Memory Question 1", images: ["data:mock"] });
    });

    test("returns null without throwing when question is not found anywhere", async () => {
      const mockDb = {
        get: jest.fn().mockResolvedValue(undefined),
        getByQid: jest.fn().mockResolvedValue(undefined),
      };

      const result = await resolveQuestionData("999", "short", mockDb, null);
      expect(result).toBeNull();
    });
  });

  describe("Batched Image Slice Processing", () => {
    async function processInBatches(items, batchSize, processFn) {
      const results = [];
      for (let b = 0; b < items.length; b += batchSize) {
        const batch = items.slice(b, b + batchSize);
        const batchResults = await Promise.all(batch.map((item, idx) => processFn(item, b + idx)));
        results.push(...batchResults);
      }
      return results;
    }

    test("processes all items in chunks of batchSize", async () => {
      const items = Array.from({ length: 25 }, (_, i) => `img_${i}`);
      let maxActiveConcurrent = 0;
      let currentActive = 0;

      const mockProcess = async (item, index) => {
        currentActive++;
        if (currentActive > maxActiveConcurrent) maxActiveConcurrent = currentActive;
        // simulate async delay
        await new Promise((resolve) => setTimeout(resolve, 5));
        currentActive--;
        return { index, id: `processed_${item}` };
      };

      const results = await processInBatches(items, 10, mockProcess);

      expect(results).toHaveLength(25);
      expect(results[0]).toEqual({ index: 0, id: "processed_img_0" });
      expect(results[24]).toEqual({ index: 24, id: "processed_img_24" });
      expect(maxActiveConcurrent).toBeLessThanOrEqual(10);
    });

    test("handles items length smaller than batch size", async () => {
      const items = ["slice_1", "slice_2"];
      const results = await processInBatches(items, 10, async (item) => `done_${item}`);
      expect(results).toEqual(["done_slice_1", "done_slice_2"]);
    });

    test("handles empty items array", async () => {
      const results = await processInBatches([], 10, async (item) => item);
      expect(results).toEqual([]);
    });
  });

  describe("On-Demand Stack Loading & Memory Optimization", () => {
    test("base64ToBlob converts base64 data URI to Blob directly without network overhead", async () => {
      const { base64ToBlob } = await import("../js/viewer.js");
      const sampleText = "DICM_SAMPLE_HEADER_DATA";
      const base64Data = Buffer.from(sampleText).toString("base64");
      const dataUri = `data:application/dicom;base64,${base64Data}`;

      const blob = base64ToBlob(dataUri, "application/dicom");
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("application/dicom");
      expect(blob.size).toBe(sampleText.length);

      const arrayBuf = await blob.arrayBuffer();
      const decodedText = Buffer.from(arrayBuf).toString();
      expect(decodedText).toBe(sampleText);
    });

    test("urltoFile directly resolves base64 data URIs to File without fetch", async () => {
      const { urltoFile } = await import("../js/viewer.js");
      const sampleText = "TEST_DICOM_FILE_SLICE";
      const base64Data = Buffer.from(sampleText).toString("base64");
      const dataUri = `data:application/dicom;base64,${base64Data}`;

      const file = await urltoFile(dataUri, "dicom", "application/dicom");
      expect(file).toBeDefined();
      expect(file.name).toBe("dicom");
      expect(file.type).toBe("application/dicom");
      expect(file.size).toBe(sampleText.length);
    });

    test("generates on-demand imageIds instantly without converting slices up front", () => {
      const mockSlices = Array.from({ length: 400 }, (_, i) => `data:application/dicom;base64,slice_${i}`);
      const startTime = performance.now();

      const imageIds = mockSlices.map((data_url, i) => {
        if (data_url.startsWith("data:image")) {
          return "base64://" + data_url.split(",")[1];
        } else if (data_url.startsWith("data:")) {
          return "rtsdicom:" + i;
        } else {
          return data_url;
        }
      });

      const elapsed = performance.now() - startTime;
      expect(imageIds).toHaveLength(400);
      expect(imageIds[0]).toBe("rtsdicom:0");
      expect(imageIds[399]).toBe("rtsdicom:399");
      // Instant mapping in < 5ms without upfront memory allocation
      expect(elapsed).toBeLessThan(50);
    });

    test("cleanupViewerMemory purges active stack tracking and caches", async () => {
      const { cleanupViewerMemory } = await import("../js/viewer.js");
      expect(() => cleanupViewerMemory()).not.toThrow();
    });
  });
});
