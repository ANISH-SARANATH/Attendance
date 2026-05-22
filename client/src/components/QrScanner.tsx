import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import type { CameraDevice, Html5QrcodeCameraScanConfig } from "html5-qrcode";

type Props = {
  confirmationKey: number;
  onDecoded: (text: string) => void;
};

type WindowWithWebkitAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

const SCAN_CONFIG: Html5QrcodeCameraScanConfig = {
  fps: 10,
  qrbox: { width: 220, height: 220 },
  disableFlip: false
};

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

async function tryStartScanner(
  scanner: Html5Qrcode,
  onDecoded: (text: string) => void,
  config: Html5QrcodeCameraScanConfig
) {
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

function playConfirmationSound() {
  const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
  if (!AudioContextCtor) return;

  try {
    const audio = new AudioContextCtor();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1320, audio.currentTime + 0.12);
    gain.gain.setValueAtTime(0.001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.16);

    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.18);
  } catch {
    // Some mobile browsers block audio until they have a clear gesture.
  }
}

export default function QrScanner({ confirmationKey, onDecoded }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const decodedRef = useRef(onDecoded);
  const mountedRef = useRef(false);
  const startingRef = useRef(false);
  const [started, setStarted] = useState(false);
  const [fallbackAvailable, setFallbackAvailable] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("Starting camera");

  useEffect(() => {
    decodedRef.current = onDecoded;
  }, [onDecoded]);

  const getScanner = useCallback(() => {
    if (!scannerRef.current) {
      scannerRef.current = new Html5Qrcode("qr-reader", {
        useBarCodeDetectorIfSupported: true,
        verbose: false
      });
    }

    return scannerRef.current;
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current || scannerRef.current?.isScanning) return;

    startingRef.current = true;
    try {
      setFallbackAvailable(false);
      setStatus("Requesting access...");
      const scanner = getScanner();
      await tryStartScanner(scanner, (text) => decodedRef.current(text), SCAN_CONFIG);
      if (!mountedRef.current) return;
      setStarted(true);
      setStatus("Live");
    } catch {
      try {
        scannerRef.current?.clear();
      } catch {
        // Clear can fail when the library never finished mounting.
      }
      scannerRef.current = null;
      if (!mountedRef.current) return;
      setStarted(false);
      setFallbackAvailable(true);
      setStatus("Camera blocked. Use QR photo.");
    } finally {
      startingRef.current = false;
    }
  }, [getScanner]);

  const openPhotoScan = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const scanPhoto = useCallback(
    async (file: File) => {
      if (fileBusy) return;

      setFileBusy(true);
      try {
        setStatus("Scanning photo...");
        const scanner = getScanner();
        const result = await scanner.scanFileV2(file, false);
        decodedRef.current(result.decodedText);
        setStatus(started ? "Live" : "Photo scanned");
      } catch {
        setStatus(started ? "Live" : "No QR found in photo");
      } finally {
        setFileBusy(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [fileBusy, getScanner, started]
  );

  useEffect(() => {
    mountedRef.current = true;
    const startTimer = window.setTimeout(() => {
      void start();
    }, 0);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(startTimer);
      const scanner = scannerRef.current;
      if (!scanner) return;

      if (scanner.isScanning) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => null);
      } else {
        scanner.clear();
      }
      scannerRef.current = null;
    };
  }, [start]);

  useEffect(() => {
    if (!confirmationKey) return;

    const startTimer = window.setTimeout(() => {
      setConfirmed(true);
      playConfirmationSound();
    }, 0);
    const stopTimer = window.setTimeout(() => setConfirmed(false), 1200);
    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(stopTimer);
    };
  }, [confirmationKey]);

  return (
    <section className={`card scanner-card${confirmed ? " is-confirmed" : ""}`}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Camera feed</p>
          <h2>QR Scanner</h2>
        </div>
        <span className={`scanner-state ${started ? "is-live" : ""}${confirmed ? " is-confirmed" : ""}`}>
          {(started || confirmed) && <span className="live-dot" />}
          {confirmed ? "Saved to DB" : status}
        </span>
      </div>

      <div className={`scanner-frame${started ? " is-active" : ""}${confirmed ? " is-confirmed" : ""}`}>
        <div id="qr-reader" className="scanner-box" />
        {!started && (
          <div className="scanner-placeholder">
            <div className="qr-placeholder-icon" />
            <p>{fallbackAvailable ? "Fallback ready" : "Opening camera"}</p>
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

      {(fallbackAvailable || !started) && (
        <div className="row scanner-fallback">
          <button type="button" className="secondary" onClick={openPhotoScan} disabled={fileBusy}>
            {fileBusy ? "Scanning..." : "Scan QR photo"}
          </button>
        </div>
      )}
    </section>
  );
}
