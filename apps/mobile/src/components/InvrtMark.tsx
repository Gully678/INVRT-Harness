import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

// INVRT mark and wordmark from the INVRT Design System (assets/invrt-mark.svg and
// assets/invrt-wordmark.svg); rendered in currentColor so theme tokens drive them.
export function InvrtMark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 823.94 / 685.18;
  return (
    <Svg
      accessible={false}
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="0 0 823.94 685.18"
    >
      <ThemedPath
        fillRule="evenodd"
        clipRule="evenodd"
        d="M465.88,65.81l-35.03,60.68-73.28,126.92-28.19,48.82-41.92,72.61-141.04,244.28-37.74,65.37h714.4L465.88,65.81ZM563.9,356.95l-86.33,262.17-10.76,32.69-10.77-32.69-54.83-166.51-44.07-133.83h219.33l-12.57,38.16h0Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}

export function InvrtWordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 329.61 / 84.39;
  return (
    <Svg
      accessible={false}
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="34.99 24.15 329.61 84.39"
    >
      <ThemedPath
        fillRule="evenodd"
        clipRule="evenodd"
        d="M53,107L35,107.02L34.99,26L53,26Z M133.58,108.54L84.6,64.64L84.54,107L67.6,107.03L67.6,24.15L116.6,68.86L116.61,26L133.6,25.99Z M200.62,25L220.03,25L182.87,108.49L145.73,26L165.12,26L182.88,66.87Z M271.38,107.01l-11.1-18.01-11.69-.05v18.05s-18,0-18,0V26s30.6.05,30.6.05c12.67.98,23.42,8.78,27.36,20.78,4.23,13.63-.11,28.17-11.7,36.59l14.27,23.58h-19.75ZM258.29,70.9c7.55-.07,13.4-5.6,14.08-12.66.68-7.09-3.96-13.95-11.35-15.01-4.08-.59-8.15-.27-12.42-.32v28.09s9.69-.1,9.69-.1Z M342.61,106L324.6,106.06L324.61,44L302.6,43.99L302.58,26L364.6,26L364.58,43L342.6,43Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
