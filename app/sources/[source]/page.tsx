import { SourcePage } from "./source-page";

export default async function Page({ params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;
  return <SourcePage sourceId={decodeURIComponent(source)} />;
}
