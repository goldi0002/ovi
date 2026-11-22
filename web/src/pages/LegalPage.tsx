import type { ReactNode } from "react";
import { AppLink, PAGES } from "../router";
import { container, focusRing } from "../ui";
import { usePageTitle } from "./common";

/** Where people reach whoever runs this copy of Ovi. A self-hosted copy changes this to its own address. */
export const CONTACT_URL = "https://github.com/goldi0002/ovi/issues";
const UPDATED = "22 November 2026";

interface Section {
  title: string;
  body: ReactNode[];
}

const linkClass = `rounded font-medium text-accent-text underline-offset-2 hover:underline ${focusRing}`;

function Contact({ children = "open an issue" }: { children?: string }) {
  return (
    <a className={linkClass} href={CONTACT_URL} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function LegalDocument({ title, intro, sections, other }: { title: string; intro: string; sections: Section[]; other: { href: string; label: string } }) {
  usePageTitle(title);
  return (
    <main className={`${container} flex-1 py-8 sm:py-12`}>
      <article className="mx-auto max-w-2xl">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] sm:text-[2rem]">{title}</h1>
        <p className="mt-1 text-sm text-muted">Last updated {UPDATED}</p>
        <p className="mt-5 text-base leading-relaxed">{intro}</p>
        {sections.map((section) => (
          <section key={section.title} className="mt-8">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">{section.title}</h2>
            {section.body.map((paragraph, i) => (
              <p key={i} className="mt-2 text-[0.9375rem] leading-relaxed text-muted [&_strong]:font-semibold [&_strong]:text-ink">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
        <p className="mt-10 border-t border-line pt-5 text-sm text-muted">
          Also read our{" "}
          <AppLink className={linkClass} href={other.href}>
            {other.label}
          </AppLink>
          .
        </p>
      </article>
    </main>
  );
}

const PRIVACY: Section[] = [
  {
    title: "Who we are",
    body: [
      <>
        Ovi is a free, open-source link shortener. This policy covers this website and the short links it serves. If you use a copy of Ovi run by someone else, that
        person decides how it handles your data. For questions about this copy, <Contact />.
      </>,
    ],
  },
  {
    title: "What we store",
    body: [
      <>
        <strong>Links.</strong> The web address you shorten, its short code, when it was made, when it expires and, if you were signed in, which account made it.
      </>,
      <>
        <strong>Your account.</strong> When you sign in with Google or GitHub we receive your name and, if you allow it, your email address, and we keep them to
        show who you are. We never see your Google or GitHub password.
      </>,
      <>
        <strong>Clicks.</strong> Each time someone opens a short link we record the time, the website they came from, their device type and their browser. We do
        not store IP addresses or full user agent strings with clicks.
      </>,
      <>
        <strong>Reports.</strong> If you report a link we keep the reason and any details you write, and the time. We store nothing that identifies the reporter.
      </>,
      <>
        <strong>IP addresses.</strong> We use your IP address briefly, in memory, to enforce rate limits and to avoid counting the same visitor's repeat clicks. It
        is not saved with your links, clicks or account. Our hosting provider may keep ordinary server logs.
      </>,
    ],
  },
  {
    title: "Cookies and your device",
    body: [
      <>
        Ovi sets one cookie, which keeps you signed in. It is needed for the site to work, so there is no cookie banner. We use no advertising or tracking cookies and
        no third-party analytics.
      </>,
      <>Your browser also keeps your theme choice, and whether you closed the install banner, on your device only.</>,
    ],
  },
  {
    title: "How long we keep it",
    body: [
      <>
        Click records are deleted after 400 days. Links made without an account stop working after 30 days. Links and accounts that belong to you stay until you
        delete them or ask us to.
      </>,
    ],
  },
  {
    title: "Who else sees it",
    body: [
      <>
        We don't sell your data and we don't show ads. Google or GitHub handle your sign-in. Our hosting and database providers (currently Render and Neon) store and
        process the data above for us. We may share information if the law requires it.
      </>,
    ],
  },
  {
    title: "Your choices",
    body: [
      <>
        You can delete any of your links yourself from My Links. To see, correct or delete your account and the data tied to it, <Contact />. You can also remove
        Ovi's access from your Google or GitHub account settings at any time.
      </>,
      <>Ovi is not meant for children under 13.</>,
    ],
  },
  {
    title: "Changes",
    body: [<>If we change this policy, the date at the top changes. For anything that matters to you, we'll say so on the home page.</>],
  },
];

const TERMS: Section[] = [
  {
    title: "Using Ovi",
    body: [
      <>
        Ovi shortens links and makes QR codes. You can use it for free, with or without an account. By using it you agree to these terms. If you don't agree, please
        don't use it.
      </>,
    ],
  },
  {
    title: "What you can't do",
    body: [
      <>
        Don't use Ovi to link to phishing, scams, malware, spam or anything illegal, or to harass anyone. Don't hide where a link really goes in order to mislead
        people. Don't get around the rate limits, or attack or overload the service.
      </>,
    ],
  },
  {
    title: "Your links",
    body: [
      <>
        You're responsible for the links you make and where they lead. We may disable or delete any link, and block any account, at any time and without notice,
        for example after a{" "}
        <AppLink className={linkClass} href={PAGES.report}>
          report
        </AppLink>
        .
      </>,
      <>Links made without an account stop working after 30 days. We may delete them after that.</>,
    ],
  },
  {
    title: "No guarantees",
    body: [
      <>
        Ovi is provided as it is. We try to keep it running, but we don't promise it will always be available, error-free, or that a link will work forever. To the
        extent the law allows, we aren't liable for losses from using Ovi or from a link not working.
      </>,
    ],
  },
  {
    title: "The code",
    body: [
      <>
        Ovi's source code is free software under the AGPL-3.0 licence. That licence covers the code. These terms cover your use of this website.
      </>,
    ],
  },
  {
    title: "Changes and contact",
    body: [
      <>
        We may update these terms; the date at the top shows when. If you keep using Ovi after a change, you accept it. To reach us, <Contact />.
      </>,
    ],
  },
];

export function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy policy"
      intro="We collect as little as we can to run Ovi. This page says what we store, why, and how to get it removed."
      sections={PRIVACY}
      other={{ href: PAGES.terms, label: "terms of use" }}
    />
  );
}

export function TermsPage() {
  return (
    <LegalDocument
      title="Terms of use"
      intro="These are the ground rules for using Ovi. They are short on purpose."
      sections={TERMS}
      other={{ href: PAGES.privacy, label: "privacy policy" }}
    />
  );
}

/**
 * The two links shown where people decide to use Ovi: the home page, the sign-in sheet and Settings. Inside a dialog
 * they open in a new tab, so the dialog (and whatever is behind it) stays as it was.
 */
export function LegalLinks({ className = "", newTab = false }: { className?: string; newTab?: boolean }) {
  const cls = `rounded hover:text-ink hover:underline underline-offset-2 ${focusRing}`;
  const items = [
    { href: PAGES.privacy, label: "Privacy policy" },
    { href: PAGES.terms, label: "Terms of use" },
  ];
  return (
    <nav aria-label="Legal" className={`flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-muted ${className}`}>
      {items.map(({ href, label }) =>
        newTab ? (
          <a key={href} className={cls} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          <AppLink key={href} className={cls} href={href}>
            {label}
          </AppLink>
        ),
      )}
    </nav>
  );
}
