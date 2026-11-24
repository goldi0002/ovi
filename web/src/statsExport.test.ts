import { stats } from "./test/fakeApi";
import { MAX_STATS_DAYS, RANGES, csvCell, parseRange, statsFileName, statsToCsv } from "./statsExport";

describe("parseRange", () => {
  it("accepts the offered ranges", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("30")).toBe(30);
    expect(parseRange("90")).toBe(90);
  });

  it.each([null, undefined, "", "abc", "0", "-7", "8", "7.5", "1e2", " 7", "7 ", "366", "99999999999999999999"])("falls back to 30 for %j", (value) => {
    expect(parseRange(value)).toBe(30);
  });

  it("never offers more than the API accepts", () => {
    expect(Math.max(...RANGES)).toBeLessThanOrEqual(MAX_STATS_DAYS);
  });
});

describe("csvCell", () => {
  it("leaves plain text and numbers alone", () => {
    expect(csvCell("Direct")).toBe("Direct");
    expect(csvCell(12)).toBe("12");
  });

  it("quotes commas, quotes and line breaks, doubling quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it.each(["=SUM(A1)", "+1", "-1", "@cmd", "\t=1", "\r=1"])("neutralises a leading formula character in %j", (value) => {
    const cell = csvCell(value);
    expect(cell.replace(/^"/, "")).toMatch(/^'/);
  });

  it("neutralises and quotes when both apply", () => {
    expect(csvCell('=HYPERLINK("http://evil","x"),y')).toBe(`"'=HYPERLINK(""http://evil"",""x""),y"`);
  });

  it("does not touch formula characters that aren't first", () => {
    expect(csvCell("a=b")).toBe("a=b");
  });
});

describe("statsToCsv", () => {
  it("lists daily clicks, referrers, devices and browsers", () => {
    const csv = statsToCsv(stats("docs", 7));
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("section,name,clicks");
    expect(lines).toContain("daily,2026-11-16,3");
    expect(lines).toContain("daily,2026-11-15,1");
    expect(lines.filter((l) => l.startsWith("daily,"))).toHaveLength(7);
    expect(lines).toContain("referrer,news.ycombinator.com,3");
    expect(lines).toContain("device,Mobile,1");
    expect(lines).toContain("browser,Chrome,4");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("escapes hostile names from the data", () => {
    const csv = statsToCsv(stats("docs", 7, { referrers: [{ name: '=cmd|"x",1', clicks: 2 }] }));
    expect(csv).toContain(`referrer,"'=cmd|""x"",1",2`);
  });
});

describe("statsFileName", () => {
  it("names the link, range and last day", () => {
    expect(statsFileName(stats("docs", 30))).toBe("ovi-docs-stats-30d-2026-11-16.csv");
  });

  it("keeps odd characters out of the file name", () => {
    expect(statsFileName(stats("../a b", 7))).toBe("ovi-___a_b-stats-7d-2026-11-16.csv");
  });
});
