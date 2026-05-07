import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import type { Html5QrcodeCameraScanConfig } from "html5-qrcode";

type Props = {
  onDecoded: (text: string) => void;
};

export default function QrScanner({ onDecoded }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState("Idle");

  async function start() {
    if (started) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Camera unsupported");
      return;
    }

    try {
      setStatus("Requesting access...");
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false
      });
      permissionStream.getTracks().forEach((track) => track.stop());

      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      const config: Html5QrcodeCameraScanConfig = {
        fps: 10,
        qrbox: { width: 220, height: 220 }
      };

      const cameras = await Html5Qrcode.getCameras();
      if (cameras.length > 0) {
        const preferred = cameras.find((cam) => /back|rear|environment/i.test(cam.label)) || cameras[0];
        await scanner.start(preferred.id, config, onDecoded, () => {});
      } else {
        await scanner.start({ facingMode: "environment" }, config, onDecoded, () => {});
      }

      setStarted(true);
      setStatus("Live");
    } catch (error) {
      setStatus(`Error: ${(error as Error).message}`);
    }
  }

  async function stop() {
    if (!scannerRef.current || !started) return;
    try {
      await scannerRef.current.stop();
      await scannerRef.current.clear();
      scannerRef.current = null;
      setStarted(false);
      setStatus("Stopped");
    } catch (error) {
      setStatus(`Stop failed: ${(error as Error).message}`);
    }
  }

  useEffect(() => {
    return () => {
      if (scannerRef.current && started) {
        scannerRef.current.stop().catch(() => null);
      }
    };
  }, [started]);

  return (
    <section className="card scanner-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Camera feed</p>
          <h2>QR Scanner</h2>
        </div>
        <span className={`scanner-state ${started ? "is-live" : ""}`}>
          {started && <span className="live-dot" />}
          {status}
        </span>
      </div>

      <div className={`scanner-frame${started ? " is-active" : ""}`}>
        <div id="qr-reader" className="scanner-box" />
        {!started && (
          <div className="scanner-placeholder">
            <div className="qr-placeholder-icon" />
            <p>Awaiting camera</p>
          </div>
        )}
      </div>

      <div className="row split scan-actions">
        <button type="button" onClick={start} disabled={started}>
          {started ? "Scanner active" : "Start scanner"}
        </button>
        <button type="button" className="secondary" onClick={stop} disabled={!started}>
          Stop scanner
        </button>
      </div>
    </section>
  );
}
