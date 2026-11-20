import { describe, expect, it, vi } from "vitest";
import {
  FILING_FILE_REJECT_MESSAGE,
  filingFileRejected,
  uploadFiling,
} from "./insights";

const MAX_BYTES = 5 * 1024 * 1024;

function filingFile(name: string, size = 3): File {
  return new File([new Uint8Array(size)], name);
}

describe("filingFileRejected", () => {
  it("accepts spreadsheet and csv filings under 5 MB", () => {
    for (const name of ["a.xlsx", "a.xls", "a.xlsm", "a.csv", "A.XLSX"]) {
      expect(filingFileRejected(filingFile(name))).toBe(false);
    }
  });

  it("rejects other extensions", () => {
    for (const name of ["a.pdf", "a.txt", "a.xlsx.exe", "a"]) {
      expect(filingFileRejected(filingFile(name))).toBe(true);
    }
  });

  it("rejects files over 5 MB and accepts exactly 5 MB", () => {
    expect(filingFileRejected(filingFile("a.xlsx", MAX_BYTES + 1))).toBe(true);
    expect(filingFileRejected(filingFile("a.xlsx", MAX_BYTES))).toBe(false);
  });
});

describe("uploadFiling", () => {
  it("rejects an oversized file with the shared message before fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      uploadFiling("118741", filingFile("big.xlsx", MAX_BYTES + 1)),
    ).rejects.toThrow(FILING_FILE_REJECT_MESSAGE);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
