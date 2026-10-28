import { SiteHeader } from "@/components/site/header";

export default function FlowLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
    </>
  );
}
