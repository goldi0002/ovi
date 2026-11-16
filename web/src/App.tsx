import { useCallback, useMemo, useRef, useState } from "react";
import { OviApi, type Link } from "./api";
import { Check, ChartColumn, Link as LinkIcon, ShieldCheck, Zap } from "lucide-react";
import { Brand, Header } from "./components/Header";
import { LinkResult } from "./components/LinkResult";
import { LinksTable } from "./components/LinksTable";
import { ShortenCard } from "./components/ShortenCard";
import { SignInDialog } from "./components/SignInDialog";
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

  const sectionTitle = "text-[clamp(1.75rem,4vw,2.5rem)] font-extrabold tracking-tight";
  const sectionLead = "mx-auto mt-2 max-w-[40rem] text-lg text-muted";

  return (
    <>
      <div className="relative isolate min-h-screen overflow-x-clip" id="home">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] mask-b-from-55%"
          aria-hidden="true"
        >
          <svg viewBox="0 0 1440 520" preserveAspectRatio="none" className="block size-full">
            <path className="fill-wave-a" d="M0 190C170 175 280 300 360 520H0Z" />
            <path className="fill-wave-b" d="M0 250C150 250 250 360 300 520H0Z" />
            <path className="fill-wave-a" d="M1440 90C1340 150 1290 330 1170 520H1440Z" />
            <path className="fill-wave-b" d="M1440 200C1370 260 1330 400 1260 520H1440Z" />
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
          <section className="mx-auto max-w-[820px] px-4 pt-8 pb-14 text-center max-sm:pt-6 max-sm:pb-8">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-accent-soft px-[1.1rem] py-[0.45rem] font-semibold max-sm:text-[0.9rem]">
              <LinkIcon className="size-5 text-accent" />
              URL Shortener by Ovi
            </p>
            <h1 className="mt-5 mb-3 text-[clamp(2.75rem,8vw,5.25rem)] leading-[1.05] font-extrabold tracking-[-0.04em]">
              URL <span className="text-accent-ink">Shortener</span>
            </h1>
            <p className="mx-auto max-w-xl text-[clamp(1.1rem,2.4vw,1.5rem)] text-muted">
              Turn long, messy URLs into short, clean, and shareable links in seconds.
            </p>
          </section>

          <div className="mx-auto grid max-w-[1200px] gap-8 px-4 pb-16">
            <ShortenCard
              getApi={getApi}
              onUnauthorized={signOut}
              onCreated={(link) => {
                setCreated(link);
                setRefreshKey((k) => k + 1);
              }}
            />

            {created && <LinkResult link={created} onDismiss={() => setCreated(null)} />}

            <section
              id="features"
              className="grid grid-cols-3 gap-8 max-lg:grid-cols-1 max-lg:gap-4"
              aria-labelledby="features-title"
            >
              <h2 id="features-title" className="sr-only">
                Features
              </h2>
              {FEATURES.map(({ icon: FeatureIcon, title, text }) => (
                <article key={title} className={`${card} flex items-center gap-6 p-7 max-sm:gap-4 max-sm:p-5`}>
                  <span className={`${iconBubble} size-20 max-sm:size-15`}>
                    <FeatureIcon className="size-10 max-sm:size-7" />
                  </span>
                  <div>
                    <h3 className="mb-1 text-[1.3rem] font-bold tracking-tight">{title}</h3>
                    <p className="text-muted">{text}</p>
                  </div>
                </article>
              ))}
            </section>

            {api && (
              <div id="links">
                <LinksTable api={api} refreshKey={refreshKey} onUnauthorized={signOut} />
              </div>
            )}

            <section id="pricing" className="pt-8 text-center" aria-labelledby="pricing-title">
              <h2 id="pricing-title" className={sectionTitle}>
                Pricing
              </h2>
              <p className={`${sectionLead} mb-7`}>One plan, with everything in it.</p>
              <div
                className={`${card} mx-auto grid max-w-[820px] grid-cols-2 items-center gap-8 rounded-3xl px-9 py-8 text-left max-sm:grid-cols-1 max-sm:gap-5 max-sm:p-6`}
              >
                <div>
                  <p className="font-bold text-accent-ink">Self-hosted</p>
                  <p className="text-5xl leading-[1.2] font-extrabold tracking-[-0.03em]">
                    $0 <span className="text-base font-medium tracking-normal text-muted">forever</span>
                  </p>
                  <p className="text-muted">You only pay for the server and database you run it on.</p>
                </div>
                <ul className="grid gap-3">
                  {INCLUDED.map((item) => (
                    <li key={item} className="flex items-center gap-2.5">
                      <Check className="size-6 shrink-0 rounded-full bg-accent-soft p-1 text-accent" strokeWidth={3} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section id="about" className="pt-8 text-center" aria-labelledby="about-title">
              <h2 id="about-title" className={sectionTitle}>
                About Ovi
              </h2>
              <p className={sectionLead}>
                Ovi is a small URL shortener: an ASP.NET Core API with a PostgreSQL database, and this React app as
                its interface. Short links redirect instantly, count their clicks, come with a QR code and can expire
                on a date you choose.
              </p>
            </section>
          </div>
        </main>

        <footer className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 border-t border-line px-4 pt-6 pb-8 text-[0.9rem]">
          <Brand small />
          <span className="text-muted">© {new Date().getFullYear()} Ovi</span>
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
