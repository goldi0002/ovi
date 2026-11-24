import { encode } from "uqr";

// Styled QR codes are made in the browser from the short URL. Nothing here talks to the server, and a centre logo
// is read from the person's own file and only ever embedded in the image they download.

/** Pixel widths offered for the PNG; the SVG scales to any size. */
export const QR_SIZES = [256, 512, 1024, 2048] as const;
export const MIN_SIZE = 128;
export const MAX_SIZE = 4096;
export const DEFAULT_SIZE = 512;

/** Scanners read dark-on-light reliably when the two differ by at least this WCAG contrast ratio. */
export const MIN_CONTRAST = 4.5;

export const MAX_LOGO_BYTES = 256 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** The logo's side, as a share of the code's side, so it hides about 4% of the modules (error correction H repairs 30%). */
const LOGO_SHARE = 0.2;
/** Modules of plain background kept around the logo. */
const LOGO_PAD = 0.5;
const QUIET_ZONE = 4;

export interface QrStyle {
  foreground: string;
  background: string;
  size: number;
  /** A data URL of the logo, or null for none. */
  logo: string | null;
}

export const DEFAULT_STYLE: QrStyle = { foreground: "#000000", background: "#ffffff", size: DEFAULT_SIZE, logo: null };

export type StyleErrors = Partial<Record<"foreground" | "background" | "size" | "logo" | "contrast", string>>;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const LOGO_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** "#abc" or "#aabbcc" as "#aabbcc" in lower case, or null when it isn't a hex colour. */
export function normalizeHex(value: string): string | null {
  const v = value.trim();
  if (!HEX.test(v)) return null;
  const h = v.slice(1).toLowerCase();
  return "#" + (h.length === 3 ? [...h].map((c) => c + c).join("") : h);
}

/** WCAG relative luminance of a "#rrggbb" colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Everything wrong with a style, by field; empty means it can be used. */
export function validateStyle(style: QrStyle): StyleErrors {
  const errors: StyleErrors = {};
  const fg = normalizeHex(style.foreground);
  const bg = normalizeHex(style.background);
  if (!fg) errors.foreground = "Enter a colour like #1a2b3c.";
  if (!bg) errors.background = "Enter a colour like #ffffff.";
  if (fg && bg) {
    const ratio = contrastRatio(fg, bg);
    if (luminance(fg) >= luminance(bg)) errors.contrast = "Use a darker code on a lighter background. Many scanners can't read a light code on a dark one.";
    else if (ratio < MIN_CONTRAST) errors.contrast = `Contrast is ${ratio.toFixed(1)}:1; it needs at least ${MIN_CONTRAST}:1 to stay scannable.`;
  }
  if (!Number.isInteger(style.size) || style.size < MIN_SIZE || style.size > MAX_SIZE) errors.size = `Choose a size from ${MIN_SIZE} to ${MAX_SIZE} pixels.`;
  if (style.logo !== null && !LOGO_URL.test(style.logo)) errors.logo = "The logo must be a PNG, JPEG or WebP image.";
  return errors;
}

/** The contrast ratio to show, or null while a colour isn't valid yet. */
export function currentContrast(style: QrStyle): number | null {
  const fg = normalizeHex(style.foreground);
  const bg = normalizeHex(style.background);
  return fg && bg ? contrastRatio(fg, bg) : null;
}

/** Checks a chosen logo file; returns an error message or null. Only PNG, JPEG and WebP (never SVG, which can carry script). */
export function logoFileError(file: { type: string; size: number }): string | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return "Use a PNG, JPEG or WebP image.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_LOGO_BYTES) return `The logo is too big. Keep it under ${MAX_LOGO_BYTES / 1024} KB.`;
  return null;
}

/** Reads a logo file into a data URL, in the browser. It is never uploaded. Rejects with an Error whose message can be shown. */
export function readLogo(file: File): Promise<string> {
  const problem = logoFileError(file);
  if (problem) return Promise.reject(new Error(problem));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => (typeof reader.result === "string" && LOGO_URL.test(reader.result) ? resolve(reader.result) : reject(new Error("Couldn't read that image.")));
    reader.readAsDataURL(file);
  });
}

/** A file name for the download, such as "docs-qr.svg" or "docs-qr-1024.png". */
export function downloadFilename(code: string, format: "svg" | "png", size: number): string {
  const safe = code.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "link";
  return format === "svg" ? `${safe}-qr.svg` : `${safe}-qr-${size}.png`;
}

/** The QR code as an SVG document. Error correction is raised to the highest level when there is a logo. Throws if the style is invalid. */
export function buildSvg(text: string, style: QrStyle): string {
  const first = Object.values(validateStyle(style))[0];
  if (first) throw new Error(first);
  const fg = normalizeHex(style.foreground)!;
  const bg = normalizeHex(style.background)!;

  const { data, size: n } = encode(text, { ecc: style.logo ? "H" : "M", border: 0, boostEcc: !style.logo });
  const total = n + QUIET_ZONE * 2;

  let path = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; ) {
      if (!data[y][x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < n && data[y][end]) end++;
      path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  }

  let logo = "";
  if (style.logo) {
    const side = Math.max(1, Math.floor(n * LOGO_SHARE));
    const box = side + LOGO_PAD * 2;
    const start = (total - side) / 2;
    logo =
      `<rect x="${start - LOGO_PAD}" y="${start - LOGO_PAD}" width="${box}" height="${box}" fill="${bg}"/>` +
      `<image href="${style.logo}" x="${start}" y="${start}" width="${side}" height="${side}" preserveAspectRatio="xMidYMid meet"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${style.size}" height="${style.size}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${bg}"/><path fill="${fg}" d="${path}"/>${logo}</svg>`
  );
}

export function svgDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** Draws the SVG onto a canvas of `size` pixels and returns it as a PNG. */
export async function svgToPng(svg: string, size: number): Promise<Blob> {
  const img = new Image();
  img.width = size;
  img.height = size;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Couldn't draw the QR code."));
    img.src = svgDataUrl(svg);
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't make a PNG. Download the SVG instead.");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the PNG."))), "image/png"));
}

/** Saves a blob as a file through a temporary link. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
