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
  /** Shown while locked so pages can stay readable without a PIN. */
  lockedFallback?: ReactNode;
};

type AuthState = {
  unlocked: boolean;
  configured: boolean;
};

export function EditUnlock({
  children,
  title = "Enter the family PIN to edit",
  lockedFallback,
}: Props) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [pin, setPin] = useState("");
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
          headers: {
            "content-type": "application/json",
            "x-family-league": "1",
          },
          body: JSON.stringify({ pin }),
        });
        const data = (await res.json()) as AuthState & { error?: string };
        if (!res.ok || !data.unlocked) {
          throw new Error(data.error || "Wrong PIN. Try again.");
        }
        setAuth({ unlocked: true, configured: true });
        setPin("");
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
          headers: { "x-family-league": "1" },
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
            Viewing stays open. Edits need the shared family PIN — no email or
            account.
          </p>
          {!auth.configured ? (
            <p className="waiting">
              Editing is not set up yet. Add a 6–8 digit EDIT_PIN in Cursor
              Secrets, then reopen the app.
            </p>
          ) : (
            <form className="pin-form" onSubmit={unlock}>
              <label htmlFor="family-pin">Family PIN</label>
              <input
                id="family-pin"
                className="pts-input pin-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,8}"
                maxLength={8}
                value={pin}
                disabled={pending}
                onChange={(event) =>
                  setPin(event.target.value.replace(/\D/g, "").slice(0, 8))
                }
                placeholder="6–8 digits"
              />
              <button
                className="btn"
                type="submit"
                disabled={pending || pin.length < 6}
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
