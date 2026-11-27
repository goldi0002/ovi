import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { link } from "../test/fakeApi";
import { MAX_SHEET_CODES, QrSheet } from "./QrSheet";

describe("QrSheet", () => {
  it("holds at most one sheet's worth of codes", () => {
    const links = Array.from({ length: MAX_SHEET_CODES + 5 }, (_, i) => link({ code: `c${i}` }));
    render(<QrSheet links={links} onClose={() => {}} />);
    expect(screen.getAllByRole("img")).toHaveLength(MAX_SHEET_CODES);
    expect(screen.getByText(`${MAX_SHEET_CODES} QR codes on this sheet`)).toBeInTheDocument();
  });

  it("keeps each cell whole across print pages", () => {
    render(<QrSheet links={[link({ code: "docs" })]} onClose={() => {}} />);
    expect(screen.getByRole("img", { name: "QR code for /docs" }).closest("li")).toHaveClass("qr-cell");
  });
});
