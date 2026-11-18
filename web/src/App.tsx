import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, OviApi, type Link, type Session } from "./api";
import { Header } from "./components/Header";
import { Faq } from "./components/Faq";
import { LinkResult } from "./components/LinkResult";
import { LoginDialog } from "./components/LoginDialog";
import { ShortenCard } from "./components/ShortenCard";
import { AdminPage } from "./pages/AdminPage";
import { LinksPage } from "./pages/LinksPage";
import { scrollAfterNavigation, usePath } from "./router";
import { clearApiKey, loadApiKey, saveApiKey } from "./storage";
import { card, container, errorBox } from "./ui";

/** A sign-in that didn't work lands on /?login=failed (or =blocked); read and drop the flag. */
function takeLoginFlag(): string | null {
  const url = new URL(window.location.href);
  const flag = url.searchParams.get("login");
  if (flag === null) return null;
  url.searchParams.delete("login");
  window.history.replaceState(null, "", url);
  return flag;
}

export function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => loadApiKey());
  const api = useMemo(() => new OviApi(apiKey), [apiKey]);
  // null while loading; "offline" when the server couldn't be reached.
  const [session, setSession] = useState<Session | "offline" | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(() =>
    ({ failed: "Sign-in didn't finish. Try again.", blocked: "This account is suspended." } as Record<string, string>)[
      takeLoginFlag() ?? ""
    ] ?? null,
  );
  const [created, setCreated] = useState<Link | null>(null);
  const path = usePath();
  const firstRender = useRef(true);

  // The browser handles the anchor on first load; after that, every page change scrolls here.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    scrollAfterNavigation();
  }, [path]);

  const refreshSession = useCallback(async () => {
    try {
      setSession(await api.session());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && api.isAdmin) {
        // The saved API key stopped working: forget it and carry on without it.
        clearApiKey();
        setApiKey(null);
      } else if (err instanceof ApiError && err.status === 403) {
        // The account was suspended; the server has ended the session, so this reload comes back signed out.
        setNotice("This account is suspended.");
        setSession(await api.session().catch(() => "offline" as const));
      } else {
        setSession("offline");
      }
    }
  }, [api]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const current = session === "offline" ? null : session;
  const signedIn = current !== null && (current.admin || current.user !== null);
  const accountName = current?.user?.name ?? (current?.admin ? "Admin" : null);

  const signOut = useCallback(async () => {
    setCreated(null);
    if (api.isAdmin) {
      clearApiKey();
      setApiKey(null);
      return;
    }
    try {
      await api.logout();
    } finally {
      await refreshSession();
    }
  }, [api, refreshSession]);

  // A list or stats call came back 401: the session ended (expired, or signed out in another tab).
  const onUnauthorized = useCallback(() => void refreshSession(), [refreshSession]);
  const openLogin = useCallback(() => setLoginOpen(true), []);

  return (
    <>
      <div className="flex min-h-dvh flex-col">
        <Header
          path={path}
          ready={session !== null}
          isAdmin={current?.admin ?? false}
          accountName={accountName}
          onLogIn={openLogin}
          onSignOut={() => void signOut()}
        />

        {notice && (
          <div className={`${container} pt-4`}>
            <p className={`${errorBox} flex items-center justify-between gap-3`} role="alert">
              {notice}
              <button type="button" className="font-medium underline" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </p>
          </div>
        )}

        {path === "/admin" ? (
          <AdminPage
            api={api}
            state={session === null ? "loading" : current?.admin ? "admin" : signedIn ? "notAdmin" : "signedOut"}
            onLogIn={openLogin}
            onUnauthorized={onUnauthorized}
          />
        ) : path === "/links" ? (
          <LinksPage
            api={api}
            state={session === null ? "loading" : signedIn ? "signedIn" : "signedOut"}
            onLogIn={openLogin}
            onUnauthorized={onUnauthorized}
          />
        ) : (
          <main className={`${container} max-w-2xl flex-1 py-12 sm:py-20`}>
            <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-[2.5rem]">Shorten a long link</h1>
            <p className="mt-2 mb-8 text-center text-muted">Paste a URL to get a short link and a QR code. No account needed.</p>
            <div className="grid gap-6">
              <div className={`${card} p-4 sm:p-5`}>
                <ShortenCard
                  api={api}
                  signedIn={signedIn}
                  anonymousLinkDays={current?.anonymousLinkDays ?? 30}
                  onLogIn={openLogin}
                  onCreated={setCreated}
                  onUnauthorized={onUnauthorized}
                />
              </div>
              {created && <LinkResult link={created} signedIn={signedIn} onDismiss={() => setCreated(null)} />}
            </div>

            <Faq />
          </main>
        )}

        <footer>
          <div className={`${container} flex flex-wrap items-center justify-between gap-2 py-6 text-xs text-muted`}>
            <span>© {new Date().getFullYear()} Ovi</span>
            <span>Self-hosted URL shortener</span>
          </div>
        </footer>
      </div>

      {loginOpen && (
        <LoginDialog
          providers={current?.providers ?? []}
          returnTo={window.location.pathname}
          onCancel={() => setLoginOpen(false)}
          onApiKey={(key, remember) => {
            saveApiKey(key, remember);
            setApiKey(key);
            setLoginOpen(false);
          }}
        />
      )}
    </>
  );
}
