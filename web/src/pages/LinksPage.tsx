import { Plus } from "lucide-react";
import type { OviApi } from "../api";
import { LinksTable } from "../components/LinksTable";
import { AppLink, PAGES } from "../router";
import { button, container } from "../ui";
import { PageHeader } from "../components/ui/primitives";
import { SignedOutPanel, usePageTitle } from "./common";

interface Props {
  api: OviApi;
  state: "loading" | "signedIn" | "signedOut";
  onLogIn: () => void;
  onUnauthorized: () => void;
}

/** Every short link, with clicks, status and stats. */
export function LinksPage({ api, state, onLogIn, onUnauthorized }: Props) {
  usePageTitle("My Links");

  return (
    <main className={`${container} flex-1 py-8 sm:py-10`}>
      <PageHeader
        title="My Links"
        description="Search, edit and follow every link you've made."
        actions={
          <AppLink href={`${PAGES.home}#shorten`} className={button("primary", "md")}>
            <Plus />
            New link
          </AppLink>
        }
      />

      {state === "loading" ? null : state === "signedIn" ? (
        <LinksTable api={api} onUnauthorized={onUnauthorized} />
      ) : (
        <SignedOutPanel title="Log in to see your links" onLogIn={onLogIn} />
      )}
    </main>
  );
}
