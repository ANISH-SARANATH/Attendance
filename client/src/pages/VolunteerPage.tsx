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

function saveOfflineScan(scanData: { qrText: string, session: string, timestamp: number }) {
  const existing = JSON.parse(localStorage.getItem("offlineScans") || "[]");
  existing.push(scanData);
  localStorage.setItem("offlineScans", JSON.stringify(existing));
}

function getOfflineScans() {
  return JSON.parse(localStorage.getItem("offlineScans") || "[]");
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
  const [confirmationKey, setConfirmationKey] = useState(0);

  const loggedIn = Boolean(token);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy) return;

    setAuthBusy(true);
    try {
      const res = await api.post("/api/auth/volunteer-login", {
        password
      });
      const receivedToken = res.data.token as string;
      setToken(receivedToken);
      setAuthToken(receivedToken);
      setPassword("");
      setMessage("Authenticated. Scanner is starting.");
    } catch {
      setToken(null);
      setAuthToken(null);
      setMessage("Login failed. Check password and try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function syncOfflineScans() {
    const offlineScans = getOfflineScans();
    if (offlineScans.length === 0) return;

    setMessage(`Syncing ${offlineScans.length} offline scans to server...`);
    setBusy(true);

    const failedSyncs = [];
    let successCount = 0;

    for (const scan of offlineScans) {
      try {
        // Send to your backend
        await api.post("/api/attendance/scan", { qrText: scan.qrText, session: scan.session });
        successCount++;
      } catch (error) {
         // If it's a 409 Conflict, it means it already synced previously, count as success
         if (getApiStatus(error) === 409) {
            successCount++;
         } else {
            // Log the error so you can see WHY it's not clearing!
            console.error("Sync failed for scan:", scan, error); 
            failedSyncs.push(scan); // Keep it safe in the failed list
         }
      }
    }

    // EXPLICIT CLEAR LOGIC
    if (failedSyncs.length === 0) {
      // If everything succeeded, completely wipe the offline storage key
      localStorage.removeItem("offlineScans");
    } else {
      // Otherwise, save the ones that failed so we can try again later
      localStorage.setItem("offlineScans", JSON.stringify(failedSyncs));
    }

    setBusy(false);
    setMessage(`Sync complete: ${successCount} uploaded. ${failedSyncs.length} remaining.`);
  }


  async function onDecoded(qrText: string) {
    if (!loggedIn || busy) return;
    if (qrText === lastQr) return;

    setBusy(true);
    setLastQr(qrText);
    try {
      let res;
      try {
        // 1. Try to send the scan to the Express backend
        res = await api.post("/api/attendance/scan", { qrText, session });
      } catch (error: unknown) {
        // 2. If it's a conflict (already scanned today), patch it instead
        if (getApiStatus(error) === 409) {
          res = await api.patch("/api/attendance/scan", { qrText, session });
        } else {
          // 3. If it's a network error or bad QR, throw it to the outer catch block
          throw error;
        }
      }

      // --- ONLINE SUCCESS LOGIC ---
      const { type, data } = res.data;
      const name = data.name || "Unknown";
      const id = data.USN || data.usn || data.id || data.identifier;
      const time = new Date(data.scannedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });

      // Capitalize the type (Student, Faculty, Professional) for the UI
      const displayType = type ? type.charAt(0).toUpperCase() + type.slice(1) : "Unknown";

      setLastScanName(name);
      setScanCount((count) => count + 1);
      setConfirmationKey((key) => key + 1); // Triggers the green flash & beep

      const sheetSync = res.data?.sheetSync || res.data?.confirmation?.sheetSync;
      const sheetNote = sheetSync?.action === "skipped_already_present" 
        ? "Already on sheet" 
        : sheetSync?.ok 
        ? "Sheet updated" 
        : sheetSync?.queued 
        ? "Sheet queued" 
        : "";

      setMessage(
        `${displayType} - ${name} (${id}) - ${time}${sheetNote ? ` - ${sheetNote}` : ""}`
      );

    } catch (error: unknown) {
      // --- OFFLINE / ERROR LOGIC ---
      
      // If there is no response object, the phone has lost internet connection
      if (isAxiosError(error) && !error.response) {
        // Save to browser memory
        saveOfflineScan({ qrText, session, timestamp: Date.now() });
        
        // Update the UI so the volunteer knows the scan was captured
        setScanCount((count) => count + 1);
        setConfirmationKey((key) => key + 1); // Still trigger the success beep
        setLastScanName("Saved Offline");
        setMessage(`⚡ Offline Mode: Scan securely saved to phone memory.`);
      } else {
        // It's a real error (e.g., completely invalid QR code)
        setMessage(getApiMessage(error) || "Scan failed. Please retry.");
      }
    } finally {
      // Prevent double-scanning the same code for 1.5 seconds
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

                <button 
                  type="button" 
                  onClick={syncOfflineScans} 
                  disabled={busy}
                  style={{ marginTop: '1rem', width: '100%' }}
                >
                  {busy ? "Syncing..." : "Sync Offline Scans"}
                </button>
              </div>
            </div>
          </section>

          <div className="card status-card compact-card">
            <p className="status">{message}</p>
          </div>

          <QrScanner confirmationKey={confirmationKey} onDecoded={onDecoded} />
        </div>
      )}
    </main>
  );
}
