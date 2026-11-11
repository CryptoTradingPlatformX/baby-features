import { useEffect, useState } from "react";

export function useBlobUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export function CropImage({ blob, alt }: { blob: Blob | null | undefined; alt: string }) {
  const url = useBlobUrl(blob);
  if (!url) return <div className="crop-fallback" aria-hidden="true" />;
  return <img src={url} alt={alt} />;
}
