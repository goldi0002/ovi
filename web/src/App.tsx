import { useCallback, useMemo, useRef, useState } from "react";
import { OviApi, type Link } from "./api";
import { Header } from "./components/Header";
import { BoltIcon, ChartIcon, CheckIcon, LinkIcon, ShieldIcon } from "./components/Icons";
import { LinkResult } from "./components/LinkResult";
import { LinksTable } from "./components/LinksTable";
import { ShortenCard } from "./components/ShortenCard";
import { SignInDialog } from "./components/SignInDialog";
import { clearApiKey, loadApiKey, saveApiKey } from "./storage";
import { initialTheme, saveTheme, type Theme } from "./theme";

const FEATURES = [
  { icon: BoltIcon, title: "Fast & Reliable", text: "Create short links in seconds." },
  { icon: ChartIcon, title: "Track Performance", text: "See how many clicks each link gets." },
  { icon: ShieldIcon, title: "Secure & Private", text: "Protected by your API key, with optional expiry." },
];

const INCLUDED = [
  "Unlimited links and clicks",
  "A QR code for every link",
  "Custom codes and expiry dates",
  "Runs on your own server and Postgres database",
];

export function App() {
  const [theme, setTheme] = useState<Theme>(() => initialTheme());
  const [apiKey, setApiKey] = useState<string | null>(() => loadApiKey());
  const [signInOpen, setSignInOpen] = useState(false);
  const [created, setCreated] = useState<Link | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const api = useMemo(() => (apiKey ? new OviApi(apiKey) : null), [apiKey]);
  // Resolves a pending "shorten" once the user signs in (or cancels) in the dialog.
  const pendingSignIn = useRef<((api: OviApi | null) => void) | null>(null);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      saveTheme(next);
      return next;
    });
  }, []);

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
      <div className="page" id="home">
        <div className="hero-bg" aria-hidden="true">
          <svg viewBox="0 0 1440 520" preserveAspectRatio="none">
            <path className="wave-a" d="M0 190C170 175 280 300 360 520H0Z" />
            <path className="wave-b" d="M0 250C150 250 250 360 300 520H0Z" />
            <path className="wave-a" d="M1440 90C1340 150 1290 330 1170 520H1440Z" />
            <path className="wave-b" d="M1440 200C1370 260 1330 400 1260 520H1440Z" />
          </svg>
        </div>

        <Header
          theme={theme}
          onToggleTheme={toggleTheme}
          signedIn={api !== null}
          onGetStarted={() => setSignInOpen(true)}
          onSignOut={signOut}
        />

        <main>
          <section className="hero">
            <p className="pill">
              <LinkIcon />
              URL Shortener by Ovi
            </p>
            <h1>
              URL <span className="accent">Shortener</span>
            </h1>
            <p className="lead">Turn long, messy URLs into short, clean, and shareable links in seconds.</p>
          </section>

          <div className="container">
            <ShortenCard
              getApi={getApi}
              onUnauthorized={signOut}
              onCreated={(link) => {
                setCreated(link);
                setRefreshKey((k) => k + 1);
              }}
            />

            {created && <LinkResult link={created} onDismiss={() => setCreated(null)} />}

            <section id="features" className="features" aria-labelledby="features-title">
              <h2 id="features-title" className="sr-only">
                Features
              </h2>
              {FEATURES.map(({ icon: FeatureIcon, title, text }) => (
                <article key={title} className="card feature">
                  <span className="icon-bubble">
                    <FeatureIcon />
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </article>
              ))}
            </section>

            {api && (
              <div id="links">
                <LinksTable api={api} refreshKey={refreshKey} onUnauthorized={signOut} />
              </div>
            )}

            <section id="pricing" className="section" aria-labelledby="pricing-title">
              <h2 id="pricing-title" className="section-title">
                Pricing
              </h2>
              <p className="section-lead">One plan, with everything in it.</p>
              <div className="card plan">
                <div>
                  <p className="plan-name">Self-hosted</p>
                  <p className="plan-price">
                    $0 <span className="muted">forever</span>
                  </p>
                  <p className="muted">You only pay for the server and database you run it on.</p>
                </div>
                <ul className="plan-list">
                  {INCLUDED.map((item) => (
                    <li key={item}>
                      <CheckIcon />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section id="about" className="section" aria-labelledby="about-title">
              <h2 id="about-title" className="section-title">
                About Ovi
              </h2>
              <p className="section-lead about-text">
                Ovi is a small URL shortener: an ASP.NET Core API with a PostgreSQL database, and this React app as
                its interface. Short links redirect instantly, count their clicks, come with a QR code and can expire
                on a date you choose.
              </p>
            </section>
          </div>
        </main>

        <footer className="footer">
          <span className="brand brand-small">
            <LinkIcon className="brand-icon" />
            Ovi
          </span>
          <span className="muted">© {new Date().getFullYear()} Ovi</span>
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
