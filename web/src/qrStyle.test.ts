import { encode } from "uqr";
import {
  DEFAULT_STYLE,
  MAX_LOGO_BYTES,
  MIN_CONTRAST,
  buildSvg,
  contrastRatio,
  downloadFilename,
  logoFileError,
  normalizeHex,
  readLogo,
  validateStyle,
  type QrStyle,
} from "./qrStyle";

const URL_ = "https://ovi.test/abc1234";
// A 1x1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const style = (o: Partial<QrStyle> = {}): QrStyle => ({ ...DEFAULT_STYLE, ...o });
const viewBox = (svg: string) => Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
const pathOf = (svg: string) => /d="([^"]+)"/.exec(svg)![1];

describe("contrast", () => {
  it("is 21:1 for black on white and 1:1 for identical colours", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1, 5);
  });

  it("accepts dark on light and rejects low contrast", () => {
    expect(validateStyle(style({ foreground: "#1a2b3c", background: "#ffffff" }))).toEqual({});
    const low = validateStyle(style({ foreground: "#999999", background: "#ffffff" }));
    expect(low.contrast).toContain(`at least ${MIN_CONTRAST}:1`);
  });

  it("rejects a light code on a dark background even with high contrast", () => {
    expect(validateStyle(style({ foreground: "#ffffff", background: "#000000" })).contrast).toMatch(/darker code on a lighter/);
  });
});

describe("validation", () => {
  it("normalises hex colours and rejects the rest", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex(" #1A2B3C ")).toBe("#1a2b3c");
    for (const bad of ["red", "#12", "#12345g", "123456", "url(x)", '#000" onload="x']) expect(normalizeHex(bad)).toBeNull();
    const errors = validateStyle(style({ foreground: "red", background: "" }));
    expect(errors.foreground).toBeDefined();
    expect(errors.background).toBeDefined();
  });

  it("limits the size", () => {
    expect(validateStyle(style({ size: 64 })).size).toBeDefined();
    expect(validateStyle(style({ size: 5000 })).size).toBeDefined();
    expect(validateStyle(style({ size: 1.5 })).size).toBeDefined();
    expect(validateStyle(style({ size: 2048 })).size).toBeUndefined();
  });

  it("refuses to build an invalid style", () => {
    expect(() => buildSvg(URL_, style({ foreground: "#cccccc" }))).toThrow(/Contrast/);
  });
});

describe("download filenames", () => {
  it("names SVG and PNG files from the code and size", () => {
    expect(downloadFilename("docs", "svg", 512)).toBe("docs-qr.svg");
    expect(downloadFilename("docs", "png", 1024)).toBe("docs-qr-1024.png");
  });

  it("strips anything unsafe from the code", () => {
    expect(downloadFilename("../a b/c", "png", 256)).toBe("abc-qr-256.png");
    expect(downloadFilename("///", "svg", 256)).toBe("link-qr.svg");
  });
});

describe("SVG output", () => {
  it("uses the chosen colours and size, with no script or image", () => {
    const svg = buildSvg(URL_, style({ foreground: "#112233", background: "#fafafa", size: 1024 }));
    expect(svg).toContain('fill="#112233"');
    expect(svg).toContain('fill="#fafafa"');
    expect(svg).toContain('width="1024"');
    expect(svg).not.toMatch(/<script|<image|onload/i);
  });

  it("draws exactly the dark modules of the code", () => {
    const { data } = encode(URL_, { ecc: "M", border: 0, boostEcc: true });
    const dark = data.flat().filter(Boolean).length;
    const area = [...pathOf(buildSvg(URL_, style())).matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    expect(area).toBe(dark);
  });
});

describe("centre logo", () => {
  it("embeds the logo in the middle of the SVG", () => {
    const svg = buildSvg(URL_, style({ logo: PNG }));
    expect(svg).toContain(`<image href="${PNG}"`);
    const x = Number(/<image[^>]* x="([\d.]+)"/.exec(svg)![1]);
    const w = Number(/<image[^>]* width="([\d.]+)"/.exec(svg)![1]);
    expect(x + w / 2).toBeCloseTo(viewBox(svg) / 2, 5);
    expect(w).toBeLessThan(viewBox(svg) * 0.25);
  });

  it("forces the highest error correction when there is a logo", () => {
    const withLogo = buildSvg(URL_, style({ logo: PNG }));
    const without = buildSvg(URL_, style());
    const h = encode(URL_, { ecc: "H", border: 0 });
    expect(viewBox(withLogo)).toBe(h.size + 8);
    // The pattern is the level-H one, not the default.
    expect(pathOf(withLogo)).not.toBe(pathOf(without));
  });

  it("accepts PNG, JPEG and WebP up to the size limit only", () => {
    expect(logoFileError({ type: "image/png", size: 1000 })).toBeNull();
    expect(logoFileError({ type: "image/jpeg", size: MAX_LOGO_BYTES })).toBeNull();
    expect(logoFileError({ type: "image/svg+xml", size: 1000 })).toMatch(/PNG, JPEG or WebP/);
    expect(logoFileError({ type: "image/gif", size: 1000 })).not.toBeNull();
    expect(logoFileError({ type: "image/png", size: MAX_LOGO_BYTES + 1 })).toMatch(/too big/);
    expect(logoFileError({ type: "image/png", size: 0 })).toMatch(/empty/);
  });

  it("rejects a logo that isn't a raster image data URL", () => {
    expect(validateStyle(style({ logo: "data:image/svg+xml;base64,AAAA" })).logo).toBeDefined();
    expect(validateStyle(style({ logo: "https://evil.test/x.png" })).logo).toBeDefined();
    expect(validateStyle(style({ logo: PNG })).logo).toBeUndefined();
  });

  it("reads a chosen file locally, without any network request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const file = new File([Uint8Array.from([137, 80, 78, 71])], "logo.png", { type: "image/png" });
    await expect(readLogo(file)).resolves.toMatch(/^data:image\/png;base64,/);
    await expect(readLogo(new File(["<svg/>"], "l.svg", { type: "image/svg+xml" }))).rejects.toThrow(/PNG, JPEG or WebP/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
