import { useCallback, useMemo, useState } from "react";
import { OviApi, type Link } from "./api";
import { ApiKeyGate } from "./components/ApiKeyGate";
import { CreateLinkForm } from "./components/CreateLinkForm";
import { LinkResult } from "./components/LinkResult";
import { LinksTable } from "./components/LinksTable";
import { clearApiKey, loadApiKey, saveApiKey } from "./storage";

export function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => loadApiKey());
  const [created, setCreated] = useState<Link | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const api = useMemo(() => (apiKey ? new OviApi(apiKey) : null), [apiKey]);

  const signOut = useCallback(() => {
    clearApiKey();
    setApiKey(null);
    setCreated(null);
  }, []);

  if (!api) {
    return (
      <ApiKeyGate
        onSignedIn={(key, remember) => {
          saveApiKey(key, remember);
          setApiKey(key);
        }}
      />
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>Ovi</span>
        </div>
        <button type="button" className="btn btn-small btn-ghost" onClick={signOut}>
          Sign out
        </button>
      </header>
      <main className="container">
        <CreateLinkForm
          api={api}
          onCreated={(link) => {
            setCreated(link);
            setRefreshKey((k) => k + 1);
          }}
        />
        {created && <LinkResult link={created} onDismiss={() => setCreated(null)} />}
        <LinksTable api={api} refreshKey={refreshKey} onUnauthorized={signOut} />
      </main>
    </>
  );
}
