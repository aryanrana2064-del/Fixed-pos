import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { X, Camera } from "lucide-react";

/* Camera barcode scanner using the browser BarcodeDetector API (Android Chrome / Edge). */
export const CameraScanner = ({ onDetected, onClose }) => {
  const videoRef = useRef(null);
  const [status, setStatus] = useState("Starting camera…");
  const stopRef = useRef(() => {});

  useEffect(() => {
    let stream;
    let raf;
    let cancelled = false;

    const start = async () => {
      if (!("BarcodeDetector" in window)) {
        setStatus("unsupported");
        return;
      }
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        const detector = new window.BarcodeDetector({
          formats: formats.filter((f) => ["code_128", "ean_13", "ean_8", "code_39", "upc_a", "upc_e", "qr_code", "itf"].includes(f)),
        });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus("Point the camera at a barcode");

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length) {
              onDetected(codes[0].rawValue);
              return;
            }
          } catch { /* frame not ready */ }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setStatus("Camera permission is needed to scan. You can still type or use a USB scanner.");
      }
    };

    start();
    stopRef.current = () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    return () => stopRef.current();
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4" data-testid="camera-scanner">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between text-white mb-3">
          <span className="text-sm font-medium flex items-center gap-2"><Camera size={16} /> Camera Scanner</span>
          <button data-testid="close-scanner" onClick={onClose} className="p-2"><X size={18} /></button>
        </div>
        {status === "unsupported" ? (
          <div className="bg-white rounded-xl p-5 text-sm" data-testid="scanner-unsupported">
            Camera scanning is not supported by this browser. Use Chrome on Android, or keep using a USB/Bluetooth
            scanner — it types straight into the barcode box.
          </div>
        ) : (
          <>
            <div className="relative rounded-xl overflow-hidden bg-black aspect-[3/4]">
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-24 border-2 border-[#16a34a] rounded-lg" />
            </div>
            <p className="text-center text-xs text-white/80 mt-3">{status}</p>
          </>
        )}
      </div>
    </div>
  );
};

export const cameraSupported = () => "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;

export const notifyIfUnsupported = () => {
  if (!cameraSupported()) toast.info("Camera scanning needs Chrome on Android. USB/Bluetooth scanners work everywhere.");
};

export default CameraScanner;
