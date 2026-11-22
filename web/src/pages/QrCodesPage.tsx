import { Download, ExternalLink, Plus, QrCode, SearchX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, isExpired, type Link, type OviApi, type Page } from "../api";
import { CopyButton } from "../components/CopyButton";
import { Pager, SEARCH_DELAY_MS } from "../components/LinksTable";
import { Badge, EmptyState, PageHeader, SearchField, Skeleton } from "../components/ui/primitives";
import { displayUrl } from "../format";
import { AppLink, PAGES } from "../router";
import { button, card, container, errorBox, iconButton } from "../ui";
import { SignedOutPanel, usePageTitle } from "./common";

const PAGE_SIZE = 24;

interface Props {
  api: OviApi;
  state: "loading" | "signedIn" | "signedOut";
  onLogIn: () => void;
  onUnauthorized: () => void;
}

/** Every link's QR code, ready to download. */
export function QrCodesPage({ api, state, onLogIn, onUnauthorized }: Props) {
  usePageTitle("QR Codes");
  return (
    <main className={`${container} flex-1 py-8 sm:py-10`}>
      <PageHeader title="QR Codes" description="Each short link has a QR code. Download it as a PNG for print, slides or packaging." />
      {state === "loading" ? null : state === "signedIn" ? (
        <QrGrid api={api} onUnauthorized={onUnauthorized} />
      ) : (
        <SignedOutPanel title="Sign in to see your QR codes" onLogIn={onLogIn} />
      )}
    </main>
  );
}

function QrGrid({ api, onUnauthorized }: { api: OviApi; onUnauthorized: () => void }) {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Link> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const term = typed.trim();
    if (term === q) return;
    const timer = setTimeout(() => {
      setQ(term);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed, q]);

  useEffect(() => {
    const id = ++latest.current;
    api
      .list(page, PAGE_SIZE, { q })
      .then((result) => {
        if (id !== latest.current) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (id !== latest.current) return;
        if (err instanceof ApiError && err.status === 401) return onUnauthorized();
        setError(err instanceof ApiError ? err.message : "Couldn't load your links.");
      });
  }, [api, page, q, onUnauthorized]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  if (data && data.total === 0 && !q) {
    return (
      <EmptyState
        icon={<QrCode />}
        title="No QR codes yet"
        description="Every link you shorten gets a QR code. Make one and it appears here."
        action={
          <AppLink href={`${PAGES.home}#shorten`} className={button("primary", "md")}>
            <Plus />
            Create a link
          </AppLink>
        }
      />
    );
  }

  return (
    <div className="grid gap-5">
      <SearchField value={typed} onChange={setTyped} label="Search QR codes" placeholder="Search by code or destination" className="sm:max-w-sm" />

      {error && (
        <p className={errorBox} role="alert">
          {error}
        </p>
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={<SearchX />}
          title={`No links match “${q}”.`}
          action={
            <button type="button" className={button("default", "md")} onClick={() => setTyped("")}>
              Show all QR codes
            </button>
          }
        />
      )}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4" aria-label="QR codes">
        {!data &&
          Array.from({ length: 8 }, (_, i) => (
            <li key={i} className={`${card} grid gap-3 p-4`}>
              <Skeleton className="aspect-square w-full rounded-lg" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
            </li>
          ))}
        {data?.items.map((link) => (
          <li key={link.code} className={`${card} group grid content-start gap-3 p-4 transition-shadow hover:shadow-card-hover`}>
            {isExpired(link) ? (
              // The server stops serving a link's QR code once the link expires.
              <div className="relative grid aspect-square place-items-center rounded-lg bg-subtle text-center">
                <span className="grid justify-items-center gap-2 px-4 text-xs text-muted">
                  <QrCode className="size-8 opacity-40" aria-hidden="true" />
                  The link has expired, so its QR code no longer works.
                </span>
                <span className="absolute top-2 right-2">
                  <Badge dot>Expired</Badge>
                </span>
              </div>
            ) : (
              // Always on white, in both themes: scanners need dark modules on a light ground.
              <a
                href={link.qrCodeUrl}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg bg-white p-3 shadow-control"
                aria-label={`Open the QR code for /${link.code}`}
              >
                <img src={link.qrCodeUrl} alt="" loading="lazy" width={200} height={200} className="aspect-square w-full" />
              </a>
            )}
            <div className="min-w-0">
              <p className="truncate font-mono text-[0.8125rem] font-semibold" title={link.shortUrl}>
                {displayUrl(link.shortUrl)}
              </p>
              <p className="truncate text-xs text-muted" title={link.url}>
                {link.url}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {isExpired(link) ? (
                <button type="button" className={button("default", "sm", "flex-1")} disabled>
                  <Download />
                  PNG
                </button>
              ) : (
                <a className={button("default", "sm", "flex-1")} href={link.qrCodeUrl} download={`${link.code}-qr.png`} aria-label={`Download the QR code for /${link.code}`}>
                  <Download />
                  PNG
                </a>
              )}
              <CopyButton text={link.shortUrl} iconOnly label="Copy link" ariaLabel={`Copy ${displayUrl(link.shortUrl)}`} />
              <a className={iconButton} href={link.shortUrl} target="_blank" rel="noreferrer" aria-label={`Open /${link.code}`} data-tip="Open link">
                <ExternalLink />
              </a>
            </div>
          </li>
        ))}
      </ul>

      {data && totalPages > 1 && (
        <Pager
          page={page}
          totalPages={totalPages}
          onPage={(p) => {
            setPage(p);
            window.scrollTo(0, 0);
          }}
        />
      )}
    </div>
  );
}
