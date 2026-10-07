import logo from "../assets/logo.png";

/** The app's logo (src/assets/logo.png, a 128 px copy of src-tauri/icons/app-icon.png). */
export function Logo({ size, className = "" }: { size: number; className?: string }) {
  return <img src={logo} width={size} height={size} alt="" aria-hidden draggable={false} className={`shrink-0 ${className}`} />;
}
