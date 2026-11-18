import { Plus } from "lucide-react";
import { useEffect } from "react";
import type { OviApi } from "../api";
import { LinksTable } from "../components/LinksTable";
import { AppLink } from "../router";
import { button, card, container } from "../ui";

interface Props {
  api: OviApi;
  state: "loading" | "signedIn" | "signedOut";
  onLogIn: () => void;
  onUnauthorized: () => void;
}

/** Every short link, with clicks, status and stats. */
export function LinksPage({ api, state, onLogIn, onUnauthorized }: Props) {
  useEffect(() => {
    document.title = "Your links · Ovi";
    return () => {
      document.title = "Ovi — Short links with QR codes and click stats";
    };
  }, []);

  return (
    <main className={`${container} flex-1 py-8 sm:py-12`}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your links</h1>
        <AppLink href="/" className={button("primary", "sm")}>
          <Plus />
          New link
        </AppLink>
      </div>

      {state === "loading" ? (
        <p className="text-[0.8125rem] text-muted">Loading…</p>
      ) : state === "signedIn" ? (
        <LinksTable api={api} onUnauthorized={onUnauthorized} />
      ) : (
        <section className={`${card} grid justify-items-center gap-2 px-6 py-12 text-center`}>
          <h2 className="text-[0.9375rem] font-semibold">Log in to see your links</h2>
          <p className="max-w-sm text-[0.8125rem] text-muted">
            Sign in with Google or GitHub to keep your links, use custom codes and see click stats.
          </p>
          <button type="button" className={button("primary", "md", "mt-3")} onClick={onLogIn}>
            Log in
          </button>
        </section>
      )}
    </main>
  );
}
