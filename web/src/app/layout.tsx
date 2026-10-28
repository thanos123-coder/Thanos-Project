import type { Metadata, Viewport } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import { Toaster } from "sonner";
import { DataSwitch } from "@/components/dev/data-switch";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import "@/lib/generation/ui-generation.css";
import "@/lib/generation/text-image-generation.css";
import "./globals.css";

// ui-ux-pro-max pick: a rounded geometric sans that also carries Greek (ΔΟΑΤΑΠ, Μηχανογραφικό).
const rounded = M_PLUS_Rounded_1c({
  weight: ["400", "500", "700", "800"],
  subsets: ["latin", "latin-ext", "greek"],
  variable: "--font-rounded",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Upchance, your AI university counsellor",
    template: "%s | Upchance",
  },
  description:
    "See where you stand at the universities you want, as an honest range, then raise your chances with essays, interviews and activities.",
};

export const viewport: Viewport = {
  themeColor: "#eef0f3",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The site is light only; data-theme keeps the generation overlay's dots light too
    <html lang="en" data-theme="light" className={rounded.variable}>
      <body className="min-h-dvh">
        <SmoothScroll />
        {process.env.NODE_ENV === "development" ? <DataSwitch>{children}</DataSwitch> : children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            className: "upchance-toast",
          }}
        />
      </body>
    </html>
  );
}
