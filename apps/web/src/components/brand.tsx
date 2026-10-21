import Image from "next/image";

const LOGO_RATIO = 300 / 96;

export function BrandLogo({ height = 22 }: { height?: number }) {
  return <Image src="/brand/logo-text.png" alt="Luora" width={Math.round(height * LOGO_RATIO)} height={height} priority unoptimized />;
}
