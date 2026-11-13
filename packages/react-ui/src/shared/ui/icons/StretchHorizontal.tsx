import type { SVGProps } from "react";

function StretchHorizontal(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M5 4v16" />
      <path d="M19 4v16" />
      <path d="M9 12h6" />
      <path d="m12 9-3 3 3 3" />
      <path d="m12 9 3 3-3 3" />
    </svg>
  );
}

export { StretchHorizontal };
