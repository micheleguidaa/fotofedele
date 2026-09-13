import { PhotoPage } from "@/components/foto/PhotoPage";
import { getResults } from "@/lib/data";
import { orderedImages } from "@/lib/photo-view";

export default function HomePage() {
  const image = orderedImages(getResults())[0];
  if (!image) return <p className="p-8 text-muted">Nessuna foto disponibile.</p>;
  return <PhotoPage image={image} />;
}
