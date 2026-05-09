import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import type { CameraDevice, Html5QrcodeCameraScanConfig } from "html5-qrcode";

type Props = {
  onDecoded: (text: string) => void;
};

export default function QrScanner({ onDecoded }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [started, setStarted] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [status, setStatus] = useState("Idle");

  function getScanner() {
    if (!scannerRef.current) {
      scannerRef.current = new Html5Qrcode("qr-reader", {
        useBarCodeDetectorIfSupported: true,
        verbose: false
      });
    }

    return scannerRef.current;
  }

  function getErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) return error.message;
    return String(error || "Unable to start camera.");
  }

  function sortPreferredCameras(cameras: CameraDevice[]) {
    return [...cameras].sort((a, b) => {
      const score = (camera: CameraDevice) => (/back|rear|environment/i.test(camera.label) ? 1 : 0);
      return score(b) - score(a);
    });
  }

  async function tryStartScanner(scanner: Html5Qrcode, config: Html5QrcodeCameraScanConfig) {
    const errors: string[] = [];

    try {
      const cameras = sortPreferredCameras(await Html5Qrcode.getCameras());
      for (const camera of cameras) {
        try {
          await scanner.start(camera.id, config, onDecoded, () => {});
          return;
        } catch (error) {
          errors.push(getErrorMessage(error));
        }
      }
    } catch (error) {
      errors.push(getErrorMessage(error));
    }

    const fallbacks: MediaTrackConstraints[] = [
      { facingMode: { ideal: "environment" } },
      { facingMode: "environment" },
      { facingMode: "user" },
      {}
    ];

    for (const constraints of fallbacks) {
      try {
        await scanner.start(constraints, config, onDecoded, () => {});
        return;
      } catch (error) {
        errors.push(getErrorMessage(error));
      }
    }

    throw new Error(errors.find(Boolean) || "Camera unavailable.");
  }

  async function start() {
    if (started) return;
    try {
      setStatus("Requesting access...");
      const scanner = getScanner();

      const config: Html5QrcodeCameraScanConfig = {
        fps: 10,
        qrbox: { width: 220, height: 220 },
        disableFlip: false
      };

      await tryStartScanner(scanner, config);

      setStarted(true);
      setStatus("Live");
    } catch {
      scannerRef.current?.clear();
      scannerRef.current = null;
      setStarted(false);
      setStatus(`Live camera unavailable. Use photo scan.`);
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

  function openPhotoScan() {
    fileInputRef.current?.click();
  }

  async function scanPhoto(file: File) {
    if (fileBusy) return;

    setFileBusy(true);
    try {
      setStatus("Scanning photo...");
      const scanner = getScanner();
      const result = await scanner.scanFileV2(file, false);
      onDecoded(result.decodedText);
      setStatus("Photo scanned");
    } catch {
      setStatus("No QR found in photo");
    } finally {
      setFileBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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

      <input
        ref={fileInputRef}
        className="qr-file-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void scanPhoto(file);
        }}
      />

      <div className="row split scan-actions">
        <button type="button" onClick={start} disabled={started}>
          {started ? "Scanner active" : "Start scanner"}
        </button>
        <button type="button" className="secondary" onClick={stop} disabled={!started}>
          Stop scanner
        </button>
        <button type="button" className="secondary" onClick={openPhotoScan} disabled={started || fileBusy}>
          {fileBusy ? "Scanning..." : "Scan QR photo"}
        </button>
      </div>
    </section>
  );
}
