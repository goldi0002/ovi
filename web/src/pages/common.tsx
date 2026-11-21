import { LockKeyhole } from "lucide-react";
import { useEffect } from "react";
import { EmptyState } from "../components/ui/primitives";
import { button } from "../ui";

export const DEFAULT_TITLE = "Ovi — Short links with QR codes and click stats";

/** Sets the tab title while a page is shown: "My Links · Ovi". */
export function usePageTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · Ovi` : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}

/** What a page that needs an account shows to a visitor. */
export function SignedOutPanel({ title, description, onLogIn }: { title: string; description?: string; onLogIn: () => void }) {
  return (
    <EmptyState
      icon={<LockKeyhole />}
      heading
      title={title}
      description={description ?? "Sign in with Google or GitHub to keep your links, use custom codes and see click stats."}
      action={
        <button type="button" className={button("primary", "md")} onClick={onLogIn}>
          Log in
        </button>
      }
    />
  );
}
