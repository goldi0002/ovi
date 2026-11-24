import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { link } from "../test/fakeApi";
import { LinkResult } from "./LinkResult";

const created = link({ code: "docs" });

function open() {
  render(<LinkResult link={created} signedIn={false} onDismiss={() => undefined} />);
  return userEvent.setup();
}

afterEach(() => vi.restoreAllMocks());

describe("QR style dialog", () => {
  it("opens from the result card with a preview and closes on Escape", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: "Style QR" }));
    const dialog = screen.getByRole("dialog", { name: "Style the QR code for /docs" });
    expect(within(dialog).getByRole("img", { name: /Styled QR code/ })).toHaveAttribute("src", expect.stringMatching(/^data:image\/svg\+xml/));
    expect(screen.getByRole("link", { name: "QR code" })).toHaveAttribute("href", created.qrCodeUrl);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains low contrast next to the field and blocks the downloads", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: "Style QR" }));
    const code = screen.getByLabelText("Code colour");
    await user.clear(code);
    await user.type(code, "#bbbbbb");
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 4.5:1/);
    expect(screen.getByRole("button", { name: "SVG" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "PNG" })).toBeDisabled();

    await user.clear(code);
    await user.type(code, "nope");
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a colour like #1a2b3c.")).toBeInTheDocument();

    await user.clear(code);
    await user.type(code, "#102030");
    expect(screen.getByRole("button", { name: "SVG" })).toBeEnabled();
  });

  it("downloads the SVG with the right filename", async () => {
    let saved: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => ((saved = b as Blob), "blob:x"));
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const user = open();
    await user.click(screen.getByRole("button", { name: "Style QR" }));
    await user.click(screen.getByRole("button", { name: "SVG" }));
    await waitFor(() => expect(names).toEqual(["docs-qr.svg"]));
    expect(await saved!.text()).toMatch(/^<svg /);
  });

  it("adds and removes a local logo and rejects the wrong type or size", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = open();
    await user.click(screen.getByRole("button", { name: "Style QR" }));
    const chooser = screen.getByLabelText("Choose a centre logo") as HTMLInputElement;
    const lax = userEvent.setup({ applyAccept: false });

    await lax.upload(chooser, new File(["x"], "a.gif", { type: "image/gif" }));
    expect(await screen.findByText("Use a PNG, JPEG or WebP image.")).toBeInTheDocument();

    await lax.upload(chooser, new File([new Uint8Array(300 * 1024)], "big.png", { type: "image/png" }));
    expect(await screen.findByText(/too big/)).toBeInTheDocument();

    await user.upload(chooser, new File([Uint8Array.from([137, 80, 78, 71])], "logo.png", { type: "image/png" }));
    await user.click(await screen.findByRole("button", { name: "Remove logo" }));
    expect(screen.getByRole("button", { name: "Add a logo" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
