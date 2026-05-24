import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QrScannerLib from "qr-scanner";
import { BarcodeFormat, BrowserCodeReader, BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { DecodeHintType, FormatException, NotFoundException, ChecksumException } from "@zxing/library";

type Props = {
  confirmationKey: number;
  onDecoded: (text: string) => void;
};

type WindowWithWebkitAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type TrackCapabilitiesWithFocus = MediaTrackCapabilities & {
  exposureMode?: string[];
  focusMode?: string[];
  whiteBalanceMode?: string[];
};

const ZXING_OPTIONS = {
  delayBetweenScanAttempts: 20,
  delayBetweenScanSuccess: 180,
  tryPlayVideoTimeout: 6000
} as const;

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "Unable to start camera.");
}

function isExpectedScanMiss(error: unknown) {
  return error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException;
}

async function tuneRunningCamera(video: HTMLVideoElement) {
  const stream = video.srcObject;
  if (!(stream instanceof MediaStream)) return;

  const [track] = stream.getVideoTracks();
  if (!track?.applyConstraints) return;

  const capabilities =
    typeof track.getCapabilities === "function" ? (track.getCapabilities() as TrackCapabilitiesWithFocus) : undefined;
  const advanced: Record<string, unknown>[] = [];

  const addMode = (key: "focusMode" | "exposureMode" | "whiteBalanceMode") => {
    const values = capabilities?.[key];
    if (!Array.isArray(values) || values.length === 0) return;
    if (values.includes("continuous")) {
      advanced.push({ [key]: "continuous" });
      return;
    }
    if (values.includes("single-shot")) {
      advanced.push({ [key]: "single-shot" });
    }
  };

  addMode("focusMode");
  addMode("exposureMode");
  addMode("whiteBalanceMode");

  const constraints: MediaTrackConstraints & { advanced?: Record<string, unknown>[] } = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 60 }
  };

  if (advanced.length > 0) {
    constraints.advanced = advanced;
  }

  await track.applyConstraints(constraints).catch(() => null);
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

function stopScanner(controls: IScannerControls | null, video: HTMLVideoElement | null) {
  controls?.stop();
  if (video) {
    BrowserCodeReader.cleanVideoSource(video);
  }
}

export default function QrScannerView({ confirmationKey, onDecoded }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const decodedRef = useRef(onDecoded);
  const mountedRef = useRef(false);
  const startingRef = useRef(false);
  const [started, setStarted] = useState(false);
  const [fallbackAvailable, setFallbackAvailable] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("Starting camera");

  const reader = useMemo(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    return new BrowserQRCodeReader(hints, ZXING_OPTIONS);
  }, []);

  useEffect(() => {
    decodedRef.current = onDecoded;
  }, [onDecoded]);

  const start = useCallback(async () => {
    if (startingRef.current || controlsRef.current) return;

    const video = videoRef.current;
    if (!video) return;

    startingRef.current = true;
    try {
      setFallbackAvailable(false);
      setStatus("Requesting access...");

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 60 }
        }
      };

      const controls = await reader.decodeFromConstraints(constraints, video, (result, error) => {
        if (result) {
          if (mountedRef.current) {
            setStatus("Live");
          }
          decodedRef.current(result.getText());
          return;
        }

        if (!mountedRef.current) return;
        if (!error || isExpectedScanMiss(error)) return;
        setStatus("Trying to focus QR...");
      });

      controlsRef.current = controls;
      await tuneRunningCamera(video);

      if (!mountedRef.current) return;
      setStarted(true);
      setStatus("Live");
    } catch (error) {
      stopScanner(controlsRef.current, video);
      controlsRef.current = null;

      if (!mountedRef.current) return;
      setStarted(false);
      setFallbackAvailable(true);
      setStatus(getErrorMessage(error).includes("Permission") ? "Camera blocked. Use QR photo." : "Camera unavailable. Use QR photo.");
    } finally {
      startingRef.current = false;
    }
  }, [reader]);

  const openPhotoScan = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const scanPhoto = useCallback(async (file: File) => {
    if (fileBusy) return;

    setFileBusy(true);
    try {
      setStatus("Scanning photo...");
      const result = await QrScannerLib.scanImage(file, {
        alsoTryWithoutScanRegion: true,
        returnDetailedScanResult: true
      });
      decodedRef.current(result.data);
      setStatus(started ? "Live" : "Photo scanned");
    } catch {
      setStatus(started ? "Live" : "No QR found in photo");
    } finally {
      setFileBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [fileBusy, started]);

  useEffect(() => {
    mountedRef.current = true;
    const startTimer = window.setTimeout(() => {
      void start();
    }, 0);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(startTimer);
      stopScanner(controlsRef.current, videoRef.current);
      controlsRef.current = null;
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
        <div className="scanner-box">
          <video ref={videoRef} className="scanner-video" muted playsInline />
          <div className="scanner-guide" aria-hidden="true" />
        </div>
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
