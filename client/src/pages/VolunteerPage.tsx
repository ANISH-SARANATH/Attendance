import { useState } from "react";
import type { FormEvent } from "react";
import { isAxiosError } from "axios";
import QrScanner from "../components/QrScanner";
import { api, setAuthToken } from "../lib/api";

type Session = "morning" | "afternoon" | "evening";

const SESSION_LABELS: Record<Session, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening"
};

type ApiErrorBody = {
  message?: string;
};

function getApiStatus(error: unknown) {
  return isAxiosError(error) ? error.response?.status : undefined;
}

function getApiMessage(error: unknown) {
  return isAxiosError<ApiErrorBody>(error) ? error.response?.data?.message : undefined;
}

export default function VolunteerPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<Session>("morning");
  const [message, setMessage] = useState("Awaiting first scan.");
  const [authBusy, setAuthBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastQr, setLastQr] = useState("");
  const [scanCount, setScanCount] = useState(0);
  const [lastScanName, setLastScanName] = useState<string | null>(null);

  const loggedIn = Boolean(token);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy) return;

    setAuthBusy(true);
    try {
      const res = await api.post("/api/auth/volunteer-login", {
        username: "volunteer",
        password
      });
      const receivedToken = res.data.token as string;
      setToken(receivedToken);
      setAuthToken(receivedToken);
      setPassword("");
      setMessage("Authenticated. Start the scanner to begin.");
    } catch {
      setToken(null);
      setAuthToken(null);
      setMessage("Login failed. Check password and try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function onDecoded(qrText: string) {
    if (!loggedIn || busy) return;
    if (qrText === lastQr) return;

    setBusy(true);
    setLastQr(qrText);
    try {
      let res;
      try {
        res = await api.post("/api/attendance/scan", { qrText, session });
      } catch (error: unknown) {
        if (getApiStatus(error) === 409) {
          res = await api.patch("/api/attendance/scan", { qrText, session });
        } else {
          throw error;
        }
      }

      const { type, data } = res.data;
      const name = data.name || "Unknown";
      const id = data.USN || data.usn || data.id || data.identifier;
      const time = new Date(data.scannedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });

      setLastScanName(name);
      setScanCount((count) => count + 1);
      setMessage(`${type === "student" ? "Student" : "Faculty"} - ${name} (${id}) - ${session} - ${time}`);

      const backendMsg = res.data?.confirmation?.message || `Saved ${type}: ${name} for ${session}.`;
      window.alert(backendMsg);
    } catch (error: unknown) {
      setMessage(getApiMessage(error) || "Scan failed. Please retry.");
    } finally {
      setTimeout(() => setLastQr(""), 1500);
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <div className="brand-lockup">
          <p className="brand-title">Attendance System</p>
        </div>
      </header>

      <section className="hero-band">
        <div>
          <p className="eyebrow">Volunteer mode</p>
          <h1>Attendance Scanner</h1>
        </div>
        <span className={`hero-pill ${loggedIn ? "is-ready" : ""}`}>
          {loggedIn ? (
            <>
              <span className="live-dot" />
              Session active
            </>
          ) : (
            "Locked"
          )}
        </span>
      </section>

      {!loggedIn ? (
        <form className="card auth-card" onSubmit={handleLogin}>
          <div>
            <p className="eyebrow">Authentication required</p>
            <h2>Volunteer Password</h2>
          </div>
          <div>
            <label htmlFor="volunteer-password">Password</label>
            <input
              id="volunteer-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              placeholder="Enter password"
            />
          </div>
          <button type="submit" disabled={authBusy || !password.trim()}>
            {authBusy ? "Verifying..." : "Unlock Scanner"}
          </button>
          <p className="status">{message}</p>
        </form>
      ) : (
        <div className="volunteer-workflow">
          <section className="card volunteer-toolbar-card">
            <div className="volunteer-toolbar">
              <div className="toolbar-copy">
                <p className="eyebrow">Session control</p>
                <h2>
                  {SESSION_LABELS[session]} <span className="session-name-muted">session</span>
                </h2>
                {scanCount > 0 && (
                  <p className="scan-meta">
                    <span>{scanCount}</span> scans this session
                    {lastScanName && <> - last: {lastScanName}</>}
                  </p>
                )}
              </div>
              <div className="session-control">
                <label htmlFor="session">Mark as session</label>
                <select id="session" value={session} onChange={(event) => setSession(event.target.value as Session)}>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                </select>
              </div>
            </div>
          </section>

          <div className="card status-card compact-card">
            <p className="status">{message}</p>
          </div>

          <QrScanner onDecoded={onDecoded} />
        </div>
      )}
    </main>
  );
}
