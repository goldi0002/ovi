import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OviApi, type Link } from "./api";
import { Header } from "./components/Header";
import { LinkResult } from "./components/LinkResult";
import { ShortenCard } from "./components/ShortenCard";
import { SignInDialog } from "./components/SignInDialog";
import { LinksPage } from "./pages/LinksPage";
import { scrollAfterNavigation, usePath } from "./router";
import { clearApiKey, loadApiKey, saveApiKey } from "./storage";
import { card, container } from "./ui";

export function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => loadApiKey());
  const [signInOpen, setSignInOpen] = useState(false);
  const [created, setCreated] = useState<Link | null>(null);
  const path = usePath();
  const firstRender = useRef(true);
  const api = useMemo(() => (apiKey ? new OviApi(apiKey) : null), [apiKey]);
  // Resolves a pending "shorten" once the user signs in (or cancels) in the dialog.
  const pendingSignIn = useRef<((api: OviApi | null) => void) | null>(null);

  // The browser handles the anchor on first load; after that, every page change scrolls here.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    scrollAfterNavigation();
  }, [path]);

  const signOut = useCallback(() => {
    clearApiKey();
    setApiKey(null);
    setCreated(null);
  }, []);

  const closeSignIn = useCallback((result: OviApi | null) => {
    setSignInOpen(false);
    pendingSignIn.current?.(result);
    pendingSignIn.current = null;
  }, []);

  const cancelSignIn = useCallback(() => closeSignIn(null), [closeSignIn]);

  const getApi = useCallback(
    () =>
      api
        ? Promise.resolve(api)
        : new Promise<OviApi | null>((resolve) => {
            pendingSignIn.current = resolve;
            setSignInOpen(true);
          }),
    [api],
  );

  return (
    <>
      <div className="flex min-h-dvh flex-col">
        <Header path={path} signedIn={api !== null} onSignIn={() => setSignInOpen(true)} onSignOut={signOut} />

        {path === "/links" ? (
          <LinksPage api={api} onSignIn={() => setSignInOpen(true)} onUnauthorized={signOut} />
        ) : (
          <main className={`${container} max-w-2xl flex-1 py-12 sm:py-20`}>
            <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-[2.5rem]">Shorten a long link</h1>
            <p className="mt-2 mb-8 text-center text-muted">
              Paste a URL to get a short link, a QR code and click stats.
            </p>
            <div className="grid gap-6">
              <div className={`${card} p-4 sm:p-5`}>
                <ShortenCard getApi={getApi} onUnauthorized={signOut} onCreated={setCreated} />
              </div>
              {created && <LinkResult link={created} onDismiss={() => setCreated(null)} />}
            </div>
          </main>
        )}

        <footer>
          <div className={`${container} flex flex-wrap items-center justify-between gap-2 py-6 text-xs text-muted`}>
            <span>© {new Date().getFullYear()} Ovi</span>
            <span>Self-hosted URL shortener</span>
          </div>
        </footer>
      </div>

      {signInOpen && (
        <SignInDialog
          onCancel={cancelSignIn}
          onSignedIn={(key, remember) => {
            saveApiKey(key, remember);
            setApiKey(key);
            closeSignIn(new OviApi(key));
          }}
        />
      )}
    </>
  );
}
