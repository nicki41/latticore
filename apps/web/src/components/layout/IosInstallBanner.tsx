import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISSED_KEY = "latticore:ios-install-banner-dismissed";
/** Where a dismissal was stored before the rename — still honored. */
const LEGACY_DISMISSED_KEY = "minecontroller:ios-install-banner-dismissed";

/** True only for iOS/iPadOS Safari — the only browser exposing `navigator.standalone`. */
function isIosSafariNotStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (typeof nav.standalone !== "boolean") return false; // not iOS Safari at all
  if (nav.standalone) return false; // already installed/running standalone
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return isIos;
}

/**
 * Nudges iOS Safari visitors toward "Add to Home Screen" — iOS has no
 * install prompt API (unlike Chrome's beforeinstallprompt), so this is the
 * only way to surface it. Dismissible, remembered via localStorage.
 */
export function IosInstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY) || localStorage.getItem(LEGACY_DISMISSED_KEY)) return;
    setVisible(isIosSafariNotStandalone());
  }, []);

  if (!visible) return null;

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  return (
    <div className="flex items-center gap-3 border-b border-border bg-primary/10 px-4 py-2 text-sm">
      <Share className="h-4 w-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-foreground">
        Add Latticore to your Home Screen for the full app experience and push notifications: tap{" "}
        <Share className="inline h-3.5 w-3.5 -translate-y-px" aria-hidden="true" /> Share, then{" "}
        <span className="font-medium">Add to Home Screen</span>.
      </p>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={dismiss} aria-label="Dismiss">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
