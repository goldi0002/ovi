import { CircleAlert, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, OviApi, type Session } from "./api";
import { Header, type Account } from "./components/Header";
import { LoginDialog } from "./components/LoginDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ConfirmProvider } from "./components/ui/Confirm";
import { Spinner } from "./components/ui/primitives";
import { ToastProvider } from "./components/ui/Toast";
import { AdminPage } from "./pages/AdminPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { HomePage } from "./pages/HomePage";
import { LinksPage } from "./pages/LinksPage";
import { QrCodesPage } from "./pages/QrCodesPage";
import { PrivacyPage, TermsPage } from "./pages/LegalPage";
import { ReportPage } from "./pages/ReportPage";
import { useOnline } from "./pwa";
import { PAGES, scrollAfterNavigation, usePath } from "./router";
import { clearApiKey, loadApiKey, saveApiKey } from "./storage";
import { container, errorBox } from "./ui";

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
  return (
    <ToastProvider>
      <ConfirmProvider>
        <OviApp />
      </ConfirmProvider>
    </ToastProvider>
  );
}

function OviApp() {
  const [apiKey, setApiKey] = useState<string | null>(() => loadApiKey());
  const api = useMemo(() => new OviApi(apiKey), [apiKey]);
  // null while loading; "offline" when the server couldn't be reached.
  const [session, setSession] = useState<Session | "offline" | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(() =>
    ({ failed: "Sign-in didn't finish. Try again.", blocked: "This account is suspended." } as Record<string, string>)[
      takeLoginFlag() ?? ""
    ] ?? null,
  );
  const path = usePath();
  const online = useOnline();
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

  const ready = session !== null;
  const current = session === "offline" ? null : session;
  const signedIn = current !== null && (current.admin || current.user !== null);
  const account: Account | null = !signedIn
    ? null
    : current.user
      ? { name: current.user.name, email: current.user.email, provider: current.user.provider }
      : { name: "Admin", email: null, provider: null };

  const signOut = useCallback(async () => {
    setSettingsOpen(false);
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
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const accountState = !ready ? "loading" : signedIn ? "signedIn" : "signedOut";

  let page;
  if (!ready) {
    page = (
      <main className="grid flex-1 place-items-center py-24 text-muted" aria-busy="true">
        <Spinner className="size-5" />
        <span className="sr-only">Loading…</span>
      </main>
    );
  } else if (path === PAGES.admin) {
    page = (
      <AdminPage
        api={api}
        state={current?.admin ? "admin" : signedIn ? "notAdmin" : "signedOut"}
        onLogIn={openLogin}
        onUnauthorized={onUnauthorized}
      />
    );
  } else if (path === PAGES.privacy) {
    page = <PrivacyPage />;
  } else if (path === PAGES.terms) {
    page = <TermsPage />;
  } else if (path === PAGES.report) {
    page = <ReportPage api={api} />;
  } else if (path === PAGES.links) {
    page = <LinksPage api={api} state={accountState} onLogIn={openLogin} onUnauthorized={onUnauthorized} />;
  } else if (path === PAGES.analytics) {
    page = <AnalyticsPage api={api} state={accountState} onLogIn={openLogin} onUnauthorized={onUnauthorized} />;
  } else if (path === PAGES.qrCodes) {
    page = <QrCodesPage api={api} state={accountState} onLogIn={openLogin} onUnauthorized={onUnauthorized} />;
  } else {
    page = (
      <HomePage
        api={api}
        signedIn={signedIn}
        greetingName={account ? (account.provider ? account.name.split(/\s+/)[0] : null) : null}
        anonymousLinkDays={current?.anonymousLinkDays ?? 30}
        onLogIn={openLogin}
        onUnauthorized={onUnauthorized}
      />
    );
  }

  return (
    <>
      <div className="min-h-dvh">
        <Header
          path={path}
          ready={ready}
          isAdmin={current?.admin ?? false}
          account={account}
          onLogIn={openLogin}
          onSignOut={() => void signOut()}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* The same element whether or not someone is signed in, so the page inside keeps its state. */}
        <div className={`flex flex-col ${account ? "min-h-dvh max-lg:min-h-[calc(100dvh-3.5rem)] max-lg:pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pl-60" : "min-h-[calc(100dvh-3.5rem)]"}`}>
          {!online && (
            <div className={`${container} pt-4`}>
              <p className="flex items-center gap-3 rounded-xl border border-line bg-subtle px-3.5 py-2.5 text-[0.8125rem] text-muted" role="status">
                <WifiOff className="size-4 shrink-0" aria-hidden="true" />
                You're offline. Links can't be created or loaded until you're back online.
              </p>
            </div>
          )}

          {notice && (
            <div className={`${container} pt-4`}>
              <p className={`${errorBox} flex items-center gap-3`} role="alert">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{notice}</span>
                <button type="button" className="cursor-pointer font-medium underline underline-offset-2" onClick={() => setNotice(null)}>
                  Dismiss
                </button>
              </p>
            </div>
          )}

          <div key={path} className="flex flex-1 animate-page-in flex-col">
            {page}
          </div>
        </div>
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

      {settingsOpen && account && <SettingsDialog account={account} onClose={closeSettings} onSignOut={() => void signOut()} />}
    </>
  );
}
