import { render, screen } from "@testing-library/react";
import { App } from "../App";
import { fakeApi, link } from "../test/fakeApi";

const user = { name: "Ada", email: "ada@example.com", provider: "google" as const, isAdmin: false };

// jsdom has no layout, so this can't measure overflow. It pins the classes that stop a long, unbreakable
// destination URL from widening the grid tracks (an implicit `auto` track sizes to its min-content).
describe("Analytics page layout", () => {
  it("keeps the page and details grids to one shrinkable column on phones", async () => {
    fakeApi({ user, links: [link({ code: "launch", url: `https://example.com/${"a".repeat(200)}` })] });
    window.history.replaceState(null, "", "/links/analytics?code=launch");
    render(<App />);
    const details = await screen.findByRole("region", { name: "Link analytics" });
    await screen.findByRole("heading", { name: /\/launch/ });

    expect(details).toHaveClass("min-w-0");
    expect(details.parentElement).toHaveClass("grid-cols-[minmax(0,1fr)]");
    expect(details.firstElementChild).toHaveClass("grid-cols-[minmax(0,1fr)]");
  });
});
