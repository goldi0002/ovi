import { Download, ImagePlus, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { Link } from "../api";
import {
  DEFAULT_STYLE,
  MIN_CONTRAST,
  QR_SIZES,
  buildSvg,
  currentContrast,
  downloadFilename,
  normalizeHex,
  readLogo,
  saveBlob,
  svgDataUrl,
  svgToPng,
  validateStyle,
  type QrStyle,
} from "../qrStyle";
import { button, errorBox, field, fieldError, hint, input } from "../ui";
import { Dialog } from "./ui/Dialog";
import { SegmentedControl } from "./ui/primitives";

/** Styles a link's QR code in the browser (colours, size, centre logo) and downloads it as SVG or PNG. The server's PNG is untouched. */
export function QrStyleDialog({ link, onClose }: { link: Link; onClose: () => void }) {
  const [style, setStyle] = useState<QrStyle>(DEFAULT_STYLE);
  const [fgText, setFgText] = useState(DEFAULT_STYLE.foreground);
  const [bgText, setBgText] = useState(DEFAULT_STYLE.background);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  const typed = { ...style, foreground: fgText, background: bgText };
  const errors = validateStyle(typed);
  const valid = Object.keys(errors).length === 0;
  const ratio = currentContrast(typed);

  const svg = useMemo(() => {
    if (!valid) return null;
    try {
      return buildSvg(link.shortUrl, { ...style, foreground: normalizeHex(fgText)!, background: normalizeHex(bgText)! });
    } catch {
      return null;
    }
  }, [link.shortUrl, style, fgText, bgText, valid]);

  function colour(which: "foreground" | "background", value: string) {
    (which === "foreground" ? setFgText : setBgText)(value);
  }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    try {
      const logo = await readLogo(file);
      setStyle((s) => ({ ...s, logo }));
      setLogoError(null);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Couldn't read that image.");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function download(format: "svg" | "png") {
    if (!svg) return;
    setDownloadError(null);
    setBusy(true);
    try {
      const blob = format === "svg" ? new Blob([svg], { type: "image/svg+xml" }) : await svgToPng(svg, style.size);
      saveBlob(blob, downloadFilename(link.code, format, style.size));
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Couldn't download the QR code.");
    } finally {
      setBusy(false);
    }
  }

  const contrastText = errors.contrast ?? (ratio !== null ? `Contrast ${ratio.toFixed(1)}:1. It needs at least ${MIN_CONTRAST}:1.` : null);

  return (
    <Dialog title={`Style the QR code for /${link.code}`} description="Made here in your browser. Nothing is uploaded." onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid place-items-center rounded-xl bg-subtle p-3">
          {svg ? (
            <img className="size-52 max-w-full" src={svgDataUrl(svg)} alt={`Styled QR code for ${link.shortUrl}`} width={208} height={208} />
          ) : (
            <p className="grid size-52 max-w-full place-items-center px-4 text-center text-xs text-muted">Fix the highlighted fields to see the preview.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          {(["foreground", "background"] as const).map((which) => {
            const text = which === "foreground" ? fgText : bgText;
            const err = errors[which];
            const label = which === "foreground" ? "Code colour" : "Background colour";
            return (
              <div key={which} className={field}>
                <label htmlFor={`${ids}-${which}`}>{label}</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    aria-label={`${label} picker`}
                    value={normalizeHex(text) ?? "#000000"}
                    onChange={(e) => colour(which, e.target.value)}
                    className="h-9 w-10 shrink-0 cursor-pointer rounded-lg bg-field p-1 shadow-field"
                  />
                  <input
                    id={`${ids}-${which}`}
                    value={text}
                    onChange={(e) => colour(which, e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    maxLength={7}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={err ? `${ids}-${which}-error` : undefined}
                    className={`${input} font-mono font-normal`}
                  />
                </div>
                {err && (
                  <span id={`${ids}-${which}-error`} className={fieldError}>
                    {err}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {contrastText && (
          <p className={errors.contrast ? fieldError : hint} role={errors.contrast ? "alert" : "status"}>
            {contrastText}
          </p>
        )}

        <div className={field}>
          <span>Size</span>
          <SegmentedControl
            label="Size in pixels"
            options={QR_SIZES.map((s) => ({ value: s, label: `${s}` }))}
            value={style.size}
            onChange={(size) => setStyle((s) => ({ ...s, size }))}
          />
          <span className={hint}>For PNG, in pixels. The SVG scales to any size.</span>
        </div>

        <div className={field}>
          <span>
            Centre logo <span className="font-normal text-muted">(optional)</span>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              id={`${ids}-logo`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Choose a centre logo"
              aria-describedby={`${ids}-logo-note`}
              onChange={(e) => pickLogo(e.target.files?.[0])}
              className="sr-only"
              tabIndex={-1}
            />
            <button type="button" className={button("default", "md")} onClick={() => fileRef.current?.click()}>
              <ImagePlus />
              {style.logo ? "Change logo" : "Add a logo"}
            </button>
            {style.logo && (
              <button type="button" className={button("ghost", "md")} onClick={() => setStyle((s) => ({ ...s, logo: null }))}>
                <X />
                Remove logo
              </button>
            )}
          </div>
          <span id={`${ids}-logo-note`} className={hint}>
            PNG, JPEG or WebP, up to 256 KB. It stays on your device. A logo switches on the highest error correction so the code still scans.
          </span>
          {logoError && (
            <span className={fieldError} role="alert">
              {logoError}
            </span>
          )}
        </div>

        {downloadError && (
          <p className={errorBox} role="alert">
            {downloadError}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 max-sm:grid max-sm:grid-cols-3">
          <button type="button" className={button("default", "md")} onClick={onClose}>
            Close
          </button>
          <button type="button" className={button("default", "md")} disabled={!svg || busy} onClick={() => download("svg")}>
            <Download />
            SVG
          </button>
          <button type="button" className={button("primary", "md")} disabled={!svg || busy} onClick={() => download("png")}>
            <Download />
            PNG
          </button>
        </div>
      </div>
    </Dialog>
  );
}
