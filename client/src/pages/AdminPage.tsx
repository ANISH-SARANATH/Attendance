import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, setAuthToken } from "../lib/api";

type AttendanceRow = {
  _id: string;
  identifier: string;
  USN?: string;
  usn?: string;
  name: string;
  email: string;
  session: string;
  dateKey: string;
  scannedAt: string;
  scannedBy: string;
};

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [students, setStudents] = useState<AttendanceRow[]>([]);
  const [faculty, setFaculty] = useState<AttendanceRow[]>([]);
  const [message, setMessage] = useState("Enter super admin password to continue.");
  const [authBusy, setAuthBusy] = useState(false);

  const loggedIn = Boolean(token);
  const totalRows = students.length + faculty.length;
  const latestScan = [...students, ...faculty].sort(
    (a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime()
  )[0];

  async function loadData() {
    const [studentRes, facultyRes] = await Promise.all([
      api.get("/api/attendance/students"),
      api.get("/api/attendance/faculty")
    ]);
    setStudents(studentRes.data);
    setFaculty(facultyRes.data);
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy) return;

    setAuthBusy(true);
    try {
      const res = await api.post("/api/auth/admin-login", { password });
      const receivedToken = res.data.token as string;
      setToken(receivedToken);
      setAuthToken(receivedToken);
      setPassword("");
      setMessage("Admin login successful.");
    } catch {
      setToken(null);
      setAuthToken(null);
      setMessage("Invalid admin password.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function downloadCsv(type: "students" | "faculty" | "all") {
    try {
      const res = await api.get(`/api/attendance/export/${type}`, {
        responseType: "blob"
      });
      const blob = new Blob([res.data], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}-attendance.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setMessage("CSV download failed.");
    }
  }

  useEffect(() => {
    if (!loggedIn) return;
    loadData().catch(() => setMessage("Failed to load attendance data."));
  }, [loggedIn]);

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <div className="brand-lockup">
          <p className="brand-title">Attendance System</p>
        </div>
        <a className="topbar-link" href="/volunteer">
          Scanner
        </a>
      </header>

      <section className="hero-band">
        <div>
          <p className="eyebrow">Protected access</p>
          <h1>Super Admin</h1>
        </div>
        <span className={`hero-pill ${loggedIn ? "is-ready" : ""}`}>
          {loggedIn ? (
            <>
              <span className="live-dot" />
              {totalRows} records
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
            <h2>Admin Password</h2>
          </div>
          <div>
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              placeholder="Enter password"
            />
          </div>
          <button type="submit" disabled={authBusy || !password.trim()}>
            {authBusy ? "Verifying..." : "Unlock Dashboard"}
          </button>
          <p className="status">{message}</p>
        </form>
      ) : (
        <>
          <div className="metric-grid">
            <div className="metric-card">
              <p>Students</p>
              <strong>{students.length}</strong>
            </div>
            <div className="metric-card">
              <p>Faculty</p>
              <strong>{faculty.length}</strong>
            </div>
            <div className="metric-card">
              <p>Latest scan</p>
              <strong className="metric-time">
                {latestScan ? new Date(latestScan.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}
              </strong>
            </div>
          </div>

          <div className="admin-actions card">
            <button type="button" onClick={loadData}>
              Refresh
            </button>
            <button type="button" className="secondary" onClick={() => downloadCsv("students")}>
              Students CSV
            </button>
            <button type="button" className="secondary" onClick={() => downloadCsv("faculty")}>
              Faculty CSV
            </button>
            <button type="button" className="secondary" onClick={() => downloadCsv("all")}>
              All CSV
            </button>
          </div>

          <AttendanceTable title="Student Attendance" rows={students} />
          <AttendanceTable title="Faculty Attendance" rows={faculty} />

          <div className="card status-card status-footer">
            <p className="status">{message}</p>
          </div>
        </>
      )}
    </main>
  );
}

function AttendanceTable({ title, rows }: { title: string; rows: AttendanceRow[] }) {
  return (
    <section className="card table-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Records</p>
          <h2>{title}</h2>
        </div>
        <span className="table-count">{rows.length}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>USN</th>
              <th>Identifier</th>
              <th>Email</th>
              <th>Session</th>
              <th>Date</th>
              <th>Scanned At</th>
              <th>Scanned By</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="empty-cell" colSpan={8}>
                  No records found
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row._id}>
                  <td>{row.name}</td>
                  <td>{row.USN || row.usn || row.identifier}</td>
                  <td>{row.identifier}</td>
                  <td>{row.email}</td>
                  <td>
                    <span className="session-badge">{row.session}</span>
                  </td>
                  <td>{row.dateKey}</td>
                  <td>{new Date(row.scannedAt).toLocaleString()}</td>
                  <td>{row.scannedBy}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
