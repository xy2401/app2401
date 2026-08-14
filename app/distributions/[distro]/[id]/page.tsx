import { DistributionPackagePage } from "./package-page";

export default async function Page({ params }: { params: Promise<{ distro: string; id: string }> }) {
  const { distro, id } = await params;
  return <DistributionPackagePage distro={decodeURIComponent(distro)} id={decodeURIComponent(id)} />;
}
