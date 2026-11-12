"use client";

import {
  FormEvent,
  ReactNode,
  useEffect,
  useState,
  useTransition,
} from "react";

type Props = {
  children: ReactNode;
  title?: string;
  /** Shown while locked so pages can stay readable without a password. */
  lockedFallback?: ReactNode;
};

type AuthState = {
  unlocked: boolean;
  configured: boolean;
};

export function EditUnlock({
  children,
  title = "Enter the family password to edit",
  lockedFallback,
}: Props) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth", { credentials: "same-origin" });
        const data = (await res.json()) as AuthState;
        if (!cancelled) setAuth(data);
      } catch {
        if (!cancelled) setAuth({ unlocked: false, configured: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function unlock(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      setError("");
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = (await res.json()) as AuthState & { error?: string };
        if (!res.ok || !data.unlocked) {
          throw new Error(data.error || "Wrong family password. Try again.");
        }
        setAuth({ unlocked: true, configured: true });
        setPassword("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not unlock");
      }
    });
  }

  function lock() {
    startTransition(async () => {
      setError("");
      try {
        const res = await fetch("/api/auth", {
          method: "DELETE",
          credentials: "same-origin",
        });
        const data = (await res.json()) as AuthState;
        setAuth({ unlocked: false, configured: data.configured });
      } catch {
        setError("Could not lock edits");
      }
    });
  }

  if (!auth) {
    return <p className="meta">Checking edit access…</p>;
  }

  if (!auth.unlocked) {
    return (
      <div>
        {lockedFallback}
        <div className="pin-gate">
          <h2 className="pin-title">{title}</h2>
          <p className="lede">
            Viewing stays open. Edits need the shared family password — no
            email or account.
          </p>
          {!auth.configured ? (
            <p className="waiting">
              Editing is not set up yet. In Cursor Secrets, set EDIT_PIN to a
              12+ character password with letters plus a number or symbol, then
              reopen the app.
            </p>
          ) : (
            <form className="pin-form" onSubmit={unlock}>
              <label htmlFor="family-password">Family password</label>
              <input
                id="family-password"
                className="pts-input"
                type="password"
                autoComplete="current-password"
                minLength={12}
                maxLength={64}
                value={password}
                disabled={pending}
                onChange={(event) => setPassword(event.target.value.slice(0, 64))}
                placeholder="At least 12 characters"
              />
              <button
                className="btn"
                type="submit"
                disabled={pending || password.trim().length < 12}
              >
                {pending ? "Checking…" : "Unlock edits"}
              </button>
            </form>
          )}
          <div className={`status${error ? " error" : ""}`} aria-live="polite">
            {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="pin-bar">
        <span className="meta">Edits unlocked</span>
        <button
          className="btn secondary"
          type="button"
          disabled={pending}
          onClick={lock}
        >
          Lock
        </button>
      </div>
      {children}
    </div>
  );
}
