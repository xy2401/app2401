import { SoftwarePage } from "./software-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SoftwarePage id={decodeURIComponent(id)} />;
}
