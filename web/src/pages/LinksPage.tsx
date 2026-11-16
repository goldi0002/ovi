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
    <main className="mx-auto grid max-w-[1200px] gap-6 px-4 pt-6 pb-16 max-sm:pt-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[clamp(2rem,5vw,3rem)] leading-tight font-extrabold tracking-[-0.03em]">Your links</h1>
          <p className="text-lg text-muted">Every short link, with its clicks, status and stats.</p>
        </div>
        <AppLink href="/#shorten" className={button("primary")}>
          <Plus />
          New link
        </AppLink>
      </div>

      {api ? (
        <LinksTable api={api} onUnauthorized={onUnauthorized} />
      ) : (
        <section className={`${card} grid justify-items-center gap-3 px-6 py-14 text-center`}>
          <span className={`${iconBubble} size-16`}>
            <KeyRound className="size-8" />
          </span>
          <h2 className="text-xl font-bold tracking-tight">Sign in to see your links</h2>
          <p className="max-w-md text-muted">Your links are protected by your API key.</p>
          <button type="button" className={button("primary", "md", "mt-2")} onClick={onSignIn}>
            Sign in
          </button>
        </section>
      )}
    </main>
  );
}
