import type { SVGProps } from "react";

// INVRT mark from the INVRT Design System (assets/invrt-mark.svg, Momentum Blue accent #405BD8);
// rendered in currentColor so surrounding theme tokens drive it.
export function InvrtMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 823.94 685.18" xmlns="http://www.w3.org/2000/svg">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M465.88,65.81l-35.03,60.68-73.28,126.92-28.19,48.82-41.92,72.61-141.04,244.28-37.74,65.37h714.4L465.88,65.81ZM563.9,356.95l-86.33,262.17-10.76,32.69-10.77-32.69-54.83-166.51-44.07-133.83h219.33l-12.57,38.16h0Z"
      />
    </svg>
  );
}
