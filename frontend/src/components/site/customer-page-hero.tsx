import Image from "next/image";
import type { ReactNode } from "react";

export function CustomerPageHero({
  image,
  eyebrow,
  title,
  description,
  className = "",
  children,
}: {
  image: string;
  eyebrow: string;
  title: string;
  description: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`tf-page-hero ${className}`}>
      <Image className="tf-page-hero__image" src={image} alt="" fill priority sizes="100vw" />
      <div className="tf-page-hero__shade" />
      <div className={`tf-page-hero__inner${children ? " tf-page-hero__inner--split" : ""}`}>
        <div className="tf-page-hero__copy">
          <p className="section-mark">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="tf-page-hero__description">{description}</p>
        </div>
        {children && <div className="tf-page-hero__content">{children}</div>}
      </div>
    </section>
  );
}
