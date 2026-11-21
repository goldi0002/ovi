import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import type { AdminReport } from "../api";
import { fakeApi, link } from "../test/fakeApi";

const boss = { name: "Grace Hopper", email: "boss@example.com", provider: "google" as const, isAdmin: true };

function report(overrides: Partial<AdminReport> = {}): AdminReport {
  return {
    code: "scam1",
    shortUrl: "https://ovi.test/scam1",
    url: "https://evil.example/login",
    owner: { id: 1, email: "ada@example.com" },
    anonymous: false,
    openReports: 3,
    reasons: { phishing: 2, malware: 0, spam: 1, other: 0 },
    latestAt: "2026-11-16T10:00:00Z",
    details: ["Looks like a bank login"],
    ...overrides,
  };
}

async function openReport(path = "/report") {
  window.history.replaceState(null, "", path);
  render(<App />);
  await within(screen.getByRole("banner")).findByRole("button", { name: /^(Log in|Account)$/ });
  return userEvent.setup();
}

describe("Report a link", () => {
  it("is reachable from the toolbar when signed out", async () => {
    fakeApi();
    const user = await openReport("/");
    await user.click(within(screen.getByRole("banner")).getByRole("link", { name: "Report a link" }));
    expect(await screen.findByRole("heading", { name: "Report a link" })).toBeInTheDocument();
  });

  it("sends a report without signing in, with the CSRF header", async () => {
    const { fetchMock, submitted } = fakeApi();
    const user = await openReport("/report?link=https://ovi.test/scam1");
    expect(screen.getByLabelText("Short link or code")).toHaveValue("https://ovi.test/scam1");

    await user.click(screen.getByRole("radio", { name: "Phishing or scam" }));
    await user.type(screen.getByLabelText(/Details/), "  fake bank  ");
    await user.click(screen.getByRole("button", { name: "Send report" }));

    expect(await screen.findByText("Thanks. We'll take a look.")).toBeInTheDocument();
    expect(submitted).toEqual([{ link: "https://ovi.test/scam1", reason: "phishing", details: "fake bank" }]);
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u) === "/api/reports")!;
    expect(new Headers(init?.headers).get("X-Ovi-Request")).toBe("1");
  });

  it("keeps newlines in the details it sends", async () => {
    const { submitted } = fakeApi();
    const user = await openReport("/report?link=scam1");
    await user.click(screen.getByRole("radio", { name: "Spam" }));
    await user.type(screen.getByLabelText(/Details/), "line one{Enter}line two");
    await user.click(screen.getByRole("button", { name: "Send report" }));
    await screen.findByText("Thanks. We'll take a look.");
    expect(submitted[0].details).toBe("line one\nline two");
  });

  it("asks for the link and a reason before sending anything", async () => {
    const { fetchMock } = fakeApi();
    const user = await openReport();
    await user.click(screen.getByRole("button", { name: "Send report" }));

    const input = screen.getByLabelText("Short link or code");
    expect(input).toHaveAccessibleDescription("Enter an Ovi short link or its code.");
    expect(input).toHaveFocus();
    expect(screen.getByText("Choose a reason.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/reports")).toBe(false);
  });

  it("counts the details and warns past 500 characters", async () => {
    fakeApi();
    const user = await openReport("/report?link=scam1");
    await user.click(screen.getByRole("radio", { name: "Spam" }));
    const details = screen.getByLabelText(/Details/);
    await user.click(details);
    await user.paste("x".repeat(501));
    expect(screen.getByText("501/500")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send report" }));
    expect(details).toHaveAccessibleDescription(/Keep the details under 500 characters\./);
  });

  it("shows the server's message next to the link field", async () => {
    fakeApi();
    const user = await openReport("/report?link=nope");
    await user.click(screen.getByRole("radio", { name: "Spam" }));
    await user.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText("We couldn't find that Ovi link.")).toBeInTheDocument();
    expect(screen.getByLabelText("Short link or code")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("Admin reports", () => {
  async function openReports(opts: Parameters<typeof fakeApi>[0]) {
    const handles = fakeApi({ user: boss, ...opts });
    window.history.replaceState(null, "", "/admin");
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Reports" }));
    return { user, ...handles };
  }

  it("lists reported links with counts, reasons and details; the destination is text, not a link", async () => {
    await openReports({ reports: [report()] });
    const list = await screen.findByRole("list", { name: "Reported links" });
    expect(within(list).getByText("3 open reports")).toBeInTheDocument();
    expect(within(list).getByText("Phishing 2")).toBeInTheDocument();
    expect(within(list).queryByText("Malware 0")).not.toBeInTheDocument();
    expect(within(list).getByText("Looks like a bank login")).toBeInTheDocument();
    expect(within(list).getByText("https://evil.example/login")).toBeInTheDocument();
    expect(within(list).queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the open count on the Reports tab and hides it at zero", async () => {
    const { user } = await openReports({ reports: [report()] });
    expect(screen.getByRole("tab", { name: "Reports, 3 open" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Dismiss reports of /scam1" }));
    expect(await screen.findByRole("tab", { name: "Reports" })).toBeInTheDocument();
  });

  it("dismisses a link's reports and shows the empty state", async () => {
    const { user, openReports: queue } = await openReports({ reports: [report()] });
    await user.click(await screen.findByRole("button", { name: "Dismiss reports of /scam1" }));
    expect(await screen.findByText("No open reports.")).toBeInTheDocument();
    expect(queue).toHaveLength(0);
  });

  it("marks reports actioned and deletes the link after confirming", async () => {
    const { user, fetchMock } = await openReports({ reports: [report()], links: [link({ code: "scam1" })] });
    await user.click(await screen.findByRole("button", { name: "Delete /scam1" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete /scam1?" })).getByRole("button", { name: "Delete link" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/links/scam1", expect.objectContaining({ method: "DELETE" }));

    await user.click(await screen.findByRole("button", { name: "Mark /scam1 as actioned" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/reports/scam1/resolve",
      expect.objectContaining({ body: JSON.stringify({ resolution: "actioned" }) }),
    );
  });

  it("offers no owner suspension for anonymous links", async () => {
    await openReports({ reports: [report({ owner: null, anonymous: true })] });
    await screen.findByRole("list", { name: "Reported links" });
    expect(screen.queryByRole("button", { name: /Suspend owner/ })).not.toBeInTheDocument();
  });
});
