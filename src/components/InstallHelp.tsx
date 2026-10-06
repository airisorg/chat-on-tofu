"use client";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  Info,
  MessageCircle,
  Smartphone,
} from "lucide-react";
import { installPlatform, isInstalled, type InstallPlatform } from "./platform";
export default function InstallHelp({
  canInstall,
  onInstall,
}: {
  canInstall: boolean;
  onInstall: () => Promise<void>;
}) {
  const [platform, setPlatform] = useState<InstallPlatform>("desktop");
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setPlatform(installPlatform());
    const update = () => setInstalled(isInstalled());
    update();
    const mode = window.matchMedia("(display-mode: standalone)");
    mode.addEventListener("change", update);
    window.addEventListener("appinstalled", update);
    return () => {
      mode.removeEventListener("change", update);
      window.removeEventListener("appinstalled", update);
    };
  }, []);
  const ios = platform === "ios-safari" || platform === "ios-other";
  return (
    <div className="install-content">
      <span className="install-illustration">
        {installed ? <Check size={43} /> : <Smartphone size={43} />}
        <MessageCircle size={25} />
      </span>
      <h3>
        {installed
          ? "You’re using the installed app"
          : "Your conversations. One tap away."}
      </h3>
      <p>
        {installed
          ? "Chat is already running from your Home Screen or app launcher. You’re all set."
          : ios
            ? "Add Chat to your Home Screen for an app experience without the browser bars."
            : platform === "android"
              ? "Install Chat on your Android Home Screen for quick access to your conversations."
              : "Install Chat for quick access from your computer’s app launcher, or keep using it in this browser."}
      </p>
      {!installed && (
        <>
          {ios ? (
            <>
              <ol>
                <li>
                  <span>1</span>
                  <div>
                    {platform === "ios-other"
                      ? "Open this page in "
                      : "Keep this page open in "}
                    <strong>Safari</strong>.
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    Tap <strong>Share</strong> in the Safari toolbar.
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    Choose <strong>Add to Home Screen</strong>, then tap{" "}
                    <strong>Add</strong>.
                  </div>
                </li>
              </ol>
            </>
          ) : platform === "android" ? (
            <ol>
              <li>
                <span>1</span>
                <div>
                  Open this page in <strong>Chrome</strong>.
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  Open the browser menu and choose <strong>Install app</strong>{" "}
                  or <strong>Add to Home screen</strong> when offered.
                </div>
              </li>
            </ol>
          ) : platform === "mac-safari" ? (
            <ol>
              <li>
                <span>1</span>
                <div>
                  Open Safari’s <strong>File</strong> menu.
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  Choose <strong>Add to Dock</strong> if available, then
                  confirm.
                </div>
              </li>
            </ol>
          ) : (
            <ol>
              <li>
                <span>1</span>
                <div>
                  Open this page in <strong>Chrome</strong> or{" "}
                  <strong>Edge</strong>.
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  Use the install icon in the address bar or choose{" "}
                  <strong>Install app</strong> from the browser menu when
                  offered.
                </div>
              </li>
            </ol>
          )}
          {canInstall && !ios && (
            <button
              className="primary-button full-width"
              onClick={() => void onInstall()}
            >
              Install Chat
              <ArrowDownToLine size={18} />
            </button>
          )}
        </>
      )}
      <div className="install-note">
        <Info size={18} />
        <span>
          {installed
            ? "Sign in with Google to keep your conversations available across devices."
            : "Installation is optional. Sign in with Google to keep your conversations available across devices."}
        </span>
      </div>
    </div>
  );
}
