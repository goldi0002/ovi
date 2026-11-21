import { MAX_BULK_URLS, bulkErrors, csvFileName, lineRange, parseBulkInput, parseUrlLines, parseUrls, toCsv } from "./bulk";
import { link } from "./test/fakeApi";

describe("parseUrls", () => {
  it("trims lines, drops blank ones and keeps order and duplicates", () => {
    const text = "  https://a.test/1  \n\n   \nhttps://b.test\r\nhttps://a.test/1\rhttps://c.test\t\n";
    expect(parseUrls(text)).toEqual(["https://a.test/1", "https://b.test", "https://a.test/1", "https://c.test"]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(parseUrls("")).toEqual([]);
    expect(parseUrls(" \n\r\n\t \r")).toEqual([]);
  });

  it("keeps invalid lines so the server can report them by position", () => {
    expect(parseUrls("not a url\nftp://x.test")).toEqual(["not a url", "ftp://x.test"]);
  });

  it("keeps unicode and very long lines intact", () => {
    const long = "https://example.com/" + "a".repeat(5000);
    expect(parseUrls(`https://bücher.example/straße\n${long}`)).toEqual(["https://bücher.example/straße", long]);
  });

  it("counts more than the limit so the UI can refuse it", () => {
    const text = Array.from({ length: MAX_BULK_URLS + 1 }, (_, i) => `https://x.test/${i}`).join("\n");
    expect(MAX_BULK_URLS).toBe(25);
    expect(parseUrls(text)).toHaveLength(26);
  });
});

describe("toCsv", () => {
  it("writes the header and one CRLF-terminated row per link, in order", () => {
    const csv = toCsv([
      link({ code: "abc1234", url: "https://example.com/a", expiresAt: null }),
      link({ code: "xyz7890", url: "https://example.com/b", expiresAt: "2027-01-01T00:00:00Z" }),
    ]);
    expect(csv).toBe(
      "url,short_url,code,expires_at\r\n" +
        "https://example.com/a,https://ovi.test/abc1234,abc1234,\r\n" +
        "https://example.com/b,https://ovi.test/xyz7890,xyz7890,2027-01-01T00:00:00Z\r\n",
    );
  });

  it("writes only the header for no links", () => {
    expect(toCsv([])).toBe("url,short_url,code,expires_at\r\n");
  });

  it("quotes cells with commas, quotes and line breaks, doubling inner quotes", () => {
    const csv = toCsv([link({ code: "q1", url: 'https://example.com/a,b?q="x"' })]);
    expect(csv.split("\r\n")[1]).toBe('"https://example.com/a,b?q=""x""",https://ovi.test/q1,q1,');
  });

  it.each(["=", "+", "-", "@"])("guards a cell starting with %s against formula injection", (c) => {
    const csv = toCsv([link({ code: `${c}abc12`, shortUrl: "https://ovi.test/s" })]);
    const row = csv.split("\r\n")[1];
    expect(row).toBe(`https://example.com/some/long/path,https://ovi.test/s,"'${c}abc12",`);
  });

  it("guards a formula that also needs quoting", () => {
    const csv = toCsv([link({ code: 'c', url: '=HYPERLINK("http://evil.test","x")' })]);
    expect(csv.split("\r\n")[1].startsWith(`"'=HYPERLINK(""http://evil.test"",""x"")"`)).toBe(true);
  });

  it("does not guard a '-' or '=' in the middle of a cell", () => {
    const csv = toCsv([link({ code: "a-b=c", url: "https://example.com/?a=-1" })]);
    expect(csv.split("\r\n")[1]).toBe("https://example.com/?a=-1,https://ovi.test/a-b=c,a-b=c,");
  });

  it("keeps non-ASCII text as is and adds no BOM (the download adds it)", () => {
    const csv = toCsv([link({ code: "u1", url: "https://xn--bcher-kva.example/stra%C3%9Fe" })]);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv).toContain("https://xn--bcher-kva.example/stra%C3%9Fe");
  });
});

describe("csvFileName", () => {
  it("uses the local date, zero padded", () => {
    expect(csvFileName(new Date(2026, 0, 5, 23, 59))).toBe("ovi-links-2026-01-05.csv");
    expect(csvFileName(new Date(2026, 11, 31, 0, 0))).toBe("ovi-links-2026-12-31.csv");
  });
});

describe("bulkErrors", () => {
  it("pulls out per-item errors sorted by numeric index and ignores other fields", () => {
    expect(
      bulkErrors({
        "urls[10]": ["Ten"],
        "urls[2]": ["Two"],
        urls: ["Add at least one URL."],
        expiresAt: ["Bad"],
        "urls[0]": ["Zero"],
      }),
    ).toEqual([
      { index: 0, message: "Zero" },
      { index: 2, message: "Two" },
      { index: 10, message: "Ten" },
    ]);
  });

  it("returns nothing when there are no per-item errors", () => {
    expect(bulkErrors({})).toEqual([]);
  });
});

describe("parseUrlLines and lineRange", () => {
  it("numbers lines as the user sees them, counting blank lines", () => {
    expect(parseUrlLines("\n  https://a.test \n\n\nhttps://b.test\n")).toEqual([
      { url: "https://a.test", line: 2 },
      { url: "https://b.test", line: 5 },
    ]);
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("selects exactly the line each parsed URL came from (%s)", (_name, nl) => {
    const text = ["", "  https://a.test/1 ", "", "https://b.test/2", "\thttps://c.test/3", ""].join(nl);
    for (const { url, line } of parseUrlLines(text)) {
      const { start, end } = lineRange(text, line);
      expect(text.slice(start, end).trim()).toBe(url);
      expect(text.slice(start, end)).not.toMatch(/[\r\n]/);
    }
  });

  it("maps server indexes to line numbers with blank lines in between", () => {
    const lines = parseUrlLines("ok\n\nbad\n\n\nalso bad");
    const errors = bulkErrors({ "urls[1]": ["x"], "urls[2]": ["y"] });
    expect(errors.map((e) => lines[e.index].line)).toEqual([3, 6]);
  });

  it("keeps exactly the limit", () => {
    const text = Array.from({ length: MAX_BULK_URLS }, (_, i) => `https://x.test/${i}`).join("\r\n");
    expect(parseUrlLines(text)).toHaveLength(MAX_BULK_URLS);
    expect(parseUrlLines(text).at(-1)).toEqual({ url: "https://x.test/24", line: 25 });
  });
});

describe("parseBulkInput", () => {
  it("treats plain lines as URLs", () => {
    const parsed = parseBulkInput("https://a.test\n\nhttps://b.test,with-comma");
    expect(parsed.csv).toBe(false);
    expect(parsed.rows.map((r) => [r.url, r.line])).toEqual([["https://a.test", 1], ["https://b.test,with-comma", 3]]);
  });

  it("reads a CSV with a header, quoted cells, code and expiry, keeping line numbers", () => {
    const text = '\uFEFFurl,code,expires_at\r\nhttps://a.test/?x=1,spring,2030-01-31T09:00:00Z\r\n\r\n"https://b.test/?x=1,2",,\r\nhttps://c.test';
    const parsed = parseBulkInput(text);
    expect(parsed.csv).toBe(true);
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toEqual([
      { url: "https://a.test/?x=1", line: 2, code: "spring", expiresAt: "2030-01-31T09:00:00.000Z" },
      { url: "https://b.test/?x=1,2", line: 4 },
      { url: "https://c.test", line: 5 },
    ]);
  });

  it("accepts the downloaded results file (url,short_url,code,expires_at) and column order", () => {
    const parsed = parseBulkInput("code,url\nmenu,https://a.test");
    expect(parsed.rows).toEqual([{ url: "https://a.test", line: 2, code: "menu" }]);
    expect(parseBulkInput("url,short_url,code,expires_at\nhttps://a.test,https://o.vi/x,x,").rows[0].code).toBe("x");
  });

  it("reports an expires_at that isn't a date, and doesn't treat other first lines as a header", () => {
    expect(parseBulkInput("url,expires_at\nhttps://a.test,soon").problems).toEqual([
      expect.objectContaining({ line: 2, url: "https://a.test", message: expect.stringContaining("soon") }),
    ]);
    expect(parseBulkInput("url,notes\nhttps://a.test").csv).toBe(false);
  });

  it("maps items[i].field errors to the list position", () => {
    expect(bulkErrors({ "items[2].customCode": ["Taken."], "urls[0]": ["Bad."], "items[1].url": ["Bad url."] })).toEqual([
      { index: 0, message: "Bad." },
      { index: 1, message: "Bad url." },
      { index: 2, message: "Taken." },
    ]);
  });
});
