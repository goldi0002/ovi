import { Plus } from "lucide-react";
import { useEffect } from "react";
import type { OviApi } from "../api";
import { LinksTable } from "../components/LinksTable";
import { AppLink } from "../router";
import { button, card, container } from "../ui";

interface Props {
  api: OviApi | null;
  onSignIn: () => void;
  onUnauthorized: () => void;
}

/** Every short link, with clicks, status and stats. */
export function LinksPage({ api, onSignIn, onUnauthorized }: Props) {
  useEffect(() => {
    document.title = "Your links · Ovi";
    return () => {
      document.title = "Ovi · URL shortener";
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

      {api ? (
        <LinksTable api={api} onUnauthorized={onUnauthorized} />
      ) : (
        <section className={`${card} grid justify-items-center gap-2 px-6 py-12 text-center`}>
          <h2 className="text-[0.9375rem] font-semibold">Sign in to see your links</h2>
          <p className="max-w-sm text-[0.8125rem] text-muted">Your links are protected by your API key.</p>
          <button type="button" className={button("primary", "md", "mt-3")} onClick={onSignIn}>
            Enter API key
          </button>
        </section>
      )}
    </main>
  );
}
