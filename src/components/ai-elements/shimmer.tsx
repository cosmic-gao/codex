"use client";

import { TextShimmer } from "ui/text-shimmer";

export type ShimmerProps = {
  children: string;
  className?: string;
};

export function Shimmer({ children, className }: ShimmerProps) {
  return (
    <TextShimmer as="span" className={className}>
      {children}
    </TextShimmer>
  );
}

