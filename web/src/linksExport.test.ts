import { link } from "./test/fakeApi";
import { linksFileName, linksToCsv, shortLinksText } from "./linksExport";

describe("links export", () => {
  it("writes a header and one row per link", () => {
    const csv = linksToCsv([
      link({ code: "docs", url: "https://example.com/a,b", clicks: 3, createdAt: "2026-11-01T10:00:00Z", expiresAt: "2026-12-01T00:00:00Z" }),
      link({ code: "x", createdAt: "2026-11-02T10:00:00Z" }),
    ]);
    expect(csv.split("\r\n")).toEqual([
      "code,short_url,destination,clicks,created,expires",
      'docs,https://ovi.test/docs,"https://example.com/a,b",3,2026-11-01T10:00:00Z,2026-12-01T00:00:00Z',
      "x,https://ovi.test/x,https://example.com/some/long/path,0,2026-11-02T10:00:00Z,",
      "",
    ]);
  });

  it("defuses formulas in the destination", () => {
    const csv = linksToCsv([link({ code: "evil", url: "=HYPERLINK(\"http://x\")" })]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it("lists short URLs one per line", () => {
    expect(shortLinksText([link({ code: "a" }), link({ code: "b" })])).toBe("https://ovi.test/a\nhttps://ovi.test/b");
  });

  it("names the file by date", () => {
    expect(linksFileName(new Date("2026-11-27T12:00:00Z"))).toBe("ovi-links-2026-11-27.csv");
  });
});
