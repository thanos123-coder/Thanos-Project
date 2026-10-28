import { SiteHeader } from "@/components/site/header";

/** App screens: the header scrolls away with nothing under it, the screen owns the viewport. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader app />
      <main id="main">{children}</main>
    </>
  );
}
