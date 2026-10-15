import type { SVGProps } from "react";

/**
 * The filled triangle: the collapse toggle's icon in both states (pointing
 * right while collapsed, down while expanded — rotated at the use site). The
 * outline twin is `Triangle`.
 */
function TriangleFilled(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      {...props}
    >
      <path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    </svg>
  );
}

export { TriangleFilled };
