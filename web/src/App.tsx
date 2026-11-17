import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OviApi, type Link } from "./api";
import { Check, ChartColumn, Link as LinkIcon, ShieldCheck, Zap } from "lucide-react";
import { Brand, Header } from "./components/Header";
import { LinkResult } from "./components/LinkResult";
import { ShortenCard } from "./components/ShortenCard";
import { SignInDialog } from "./components/SignInDialog";
import { LinksPage } from "./pages/LinksPage";
import { scrollAfterNavigation, usePath } from "./router";
import { clearApiKey, loadApiKey, saveApiKey } from "./storage";
import { initialTheme, saveTheme, type Theme } from "./theme";
import { card, iconBubble } from "./ui";

const FEATURES = [
  { icon: Zap, title: "Fast & Reliable", text: "Create short links in seconds." },
  { icon: ChartColumn, title: "Track Performance", text: "See clicks per day, referrers and devices for each link." },
  { icon: ShieldCheck, title: "Secure & Private", text: "Protected by your API key, with optional expiry." },
];

const INCLUDED = [
  "Unlimited links and clicks",
  "A QR code for every link",
  "Custom codes and expiry dates",
  "Click stats by day, referrer, device and browser",
  "Runs on your own server and Postgres database",
];

export function App() {
  const [theme, setTheme] = useState<Theme>(() => initialTheme());
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

  const sectionTitle = "text-[clamp(1.6rem,4vw,2.25rem)] font-extrabold tracking-[-0.03em] text-balance";
  const sectionLead = "mx-auto mt-2 max-w-[38rem] text-[0.98rem] text-muted text-pretty sm:text-lg";

  return (
    <>
      <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip" id="home">
        {/* Soft accent glow behind the hero, clipped to the top of the page. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] overflow-hidden mask-b-from-75%"
          aria-hidden="true"
        >
          <div className="absolute top-[-300px] left-1/2 h-[540px] w-[min(1100px,140vw)] -translate-x-1/2 rounded-full bg-accent-soft blur-[100px]" />
          <div className="absolute top-[60px] right-[-8%] h-[280px] w-[360px] rounded-full bg-accent-soft/70 blur-[90px]" />
        </div>

        <Header
          path={path}
          theme={theme}
          onToggleTheme={toggleTheme}
          signedIn={api !== null}
          onGetStarted={() => setSignInOpen(true)}
          onSignOut={signOut}
        />

        {path === "/links" ? (
          <LinksPage api={api} onSignIn={() => setSignInOpen(true)} onUnauthorized={signOut} />
        ) : (
          <main className="flex-1">
            <section className="mx-auto w-full max-w-[860px] px-4 pt-10 pb-8 text-center sm:px-6 sm:pt-16 sm:pb-10 lg:pt-20">
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-4 py-1.5 text-[0.82rem] font-semibold text-muted shadow-xs backdrop-blur sm:text-sm">
                <LinkIcon className="size-4 text-accent" />
                URL shortener by Ovi
              </p>
              <h1 className="mt-5 text-[clamp(2.5rem,9vw,4.75rem)] leading-[1.04] font-extrabold tracking-[-0.045em] text-balance">
                URL{" "}
                <span className="bg-linear-to-br from-accent to-accent-ink bg-clip-text text-transparent">
                  Shortener
                </span>
              </h1>
              <p className="mx-auto mt-4 max-w-[34rem] text-[clamp(1rem,2.4vw,1.3rem)] text-muted text-pretty">
                Turn long, messy URLs into short, clean, and shareable links in seconds.
              </p>
            </section>

            <div className="mx-auto grid w-full max-w-[1120px] gap-6 px-4 pb-16 sm:gap-8 sm:px-6 sm:pb-20">
              <ShortenCard getApi={getApi} onUnauthorized={signOut} onCreated={setCreated} />

              {created && <LinkResult link={created} onDismiss={() => setCreated(null)} />}

              <section id="features" className="pt-6 sm:pt-10" aria-labelledby="features-title">
                <div className="mb-6 text-center sm:mb-8">
                  <h2 id="features-title" className={sectionTitle}>
                    Features
                  </h2>
                  <p className={sectionLead}>Everything you need to share a link and see how it does.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  {FEATURES.map(({ icon: FeatureIcon, title, text }) => (
                    <article
                      key={title}
                      className={`${card} flex flex-col gap-4 p-5 transition-colors hover:border-line-strong sm:p-6`}
                    >
                      <span className={`${iconBubble} size-12`}>
                        <FeatureIcon className="size-6" />
                      </span>
                      <div>
                        <h3 className="text-[1.1rem] font-bold tracking-tight">{title}</h3>
                        <p className="mt-1 text-[0.95rem] text-muted text-pretty">{text}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section id="pricing" className="pt-8 sm:pt-12" aria-labelledby="pricing-title">
                <div className="mb-6 text-center sm:mb-8">
                  <h2 id="pricing-title" className={sectionTitle}>
                    Pricing
                  </h2>
                  <p className={sectionLead}>One plan, with everything in it.</p>
                </div>
                <div
                  className={`${card} mx-auto grid max-w-[860px] gap-6 rounded-3xl p-6 text-left sm:p-8 md:grid-cols-2 md:items-center md:gap-10`}
                >
                  <div>
                    <p className="font-bold text-accent-ink">Self-hosted</p>
                    <p className="mt-1 text-[clamp(2.25rem,6vw,3rem)] leading-[1.15] font-extrabold tracking-[-0.03em]">
                      $0 <span className="text-sm font-medium tracking-normal text-muted">forever</span>
                    </p>
                    <p className="mt-2 text-[0.95rem] text-muted text-pretty">
                      You only pay for the server and database you run it on.
                    </p>
                  </div>
                  <ul className="grid gap-2.5 text-[0.95rem]">
                    {INCLUDED.map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <Check
                          className="mt-0.5 size-5 shrink-0 rounded-full bg-accent-soft p-1 text-accent"
                          strokeWidth={3}
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>

              <section id="about" className="pt-8 sm:pt-12" aria-labelledby="about-title">
                <div className={`${card} mx-auto max-w-[860px] rounded-3xl px-6 py-8 text-center sm:px-10 sm:py-10`}>
                  <h2 id="about-title" className={sectionTitle}>
                    About Ovi
                  </h2>
                  <p className={`${sectionLead} max-w-[44rem]`}>
                    Ovi is a small URL shortener: an ASP.NET Core API with a PostgreSQL database, and this React app as
                    its interface. Short links redirect instantly, count their clicks, come with a QR code and can
                    expire on a date you choose.
                  </p>
                </div>
              </section>
            </div>
          </main>
        )}

        <footer className="mx-auto flex w-full max-w-[1120px] flex-col items-center justify-between gap-2 border-t border-line px-4 pt-6 pb-8 text-[0.85rem] text-muted sm:flex-row sm:px-6">
          <Brand small />
          <span>© {new Date().getFullYear()} Ovi</span>
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
