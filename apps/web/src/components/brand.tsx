const LOGO_RATIO = 300 / 96;

export function BrandLogo({ height = 22 }: { height?: number }) {
  return (
    <span
      role="img"
      aria-label="Luora"
      className="block bg-fg [mask:url(/brand/logo-text.png)_center/contain_no-repeat]"
      style={{ width: Math.round(height * LOGO_RATIO), height }}
    />
  );
}
