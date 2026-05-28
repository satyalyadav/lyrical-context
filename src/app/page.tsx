import { ReferenceExplorer } from "@/components/reference-explorer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lyrical Context",
  description: "Search Genius references and album annotations.",
};

export const dynamic = "force-dynamic";

export default function Home() {
  return <ReferenceExplorer />;
}
