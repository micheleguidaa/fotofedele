import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PhotoPage } from "@/components/foto/PhotoPage";
import { getImage, getResults } from "@/lib/data";
import { photoTitle } from "@/lib/photo-view";

export const dynamicParams = false;

export function generateStaticParams() {
  return getResults().images.map((im) => ({ id: im.id }));
}

export async function generateMetadata({ params }: PageProps<"/foto/[id]">): Promise<Metadata> {
  const { id } = await params;
  const image = getImage(getResults(), id);
  return { title: image ? `${image.id} · ${photoTitle(image)}` : "Foto" };
}

export default async function FotoPage({ params }: PageProps<"/foto/[id]">) {
  const { id } = await params;
  const image = getImage(getResults(), id);
  if (!image) notFound();
  return <PhotoPage image={image} />;
}
