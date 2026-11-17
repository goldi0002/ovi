import { KeyRound, Plus } from "lucide-react";
import { useEffect } from "react";
import type { OviApi } from "../api";
import { LinksTable } from "../components/LinksTable";
import { AppLink } from "../router";
import { button, card, iconBubble } from "../ui";

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
    <main className="mx-auto grid w-full min-w-0 max-w-[1120px] flex-1 content-start gap-6 px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[clamp(1.9rem,6vw,2.75rem)] leading-tight font-extrabold tracking-[-0.035em]">
            Your links
          </h1>
          <p className="mt-1 text-[0.98rem] text-muted sm:text-lg">Every short link, with its clicks, status and stats.</p>
        </div>
        <AppLink href="/#shorten" className={button("primary", "md", "max-sm:w-full")}>
          <Plus />
          New link
        </AppLink>
      </div>

      {api ? (
        <LinksTable api={api} onUnauthorized={onUnauthorized} />
      ) : (
        <section className={`${card} grid justify-items-center gap-3 px-6 py-12 text-center sm:py-16`}>
          <span className={`${iconBubble} size-14`}>
            <KeyRound className="size-7" />
          </span>
          <h2 className="text-lg font-bold tracking-tight sm:text-xl">Sign in to see your links</h2>
          <p className="max-w-md text-[0.95rem] text-muted">Your links are protected by your API key.</p>
          <button type="button" className={button("primary", "md", "mt-2 max-sm:w-full")} onClick={onSignIn}>
            Sign in
          </button>
        </section>
      )}
    </main>
  );
}
