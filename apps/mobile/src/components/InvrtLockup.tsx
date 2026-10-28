import { View } from "react-native";
import { InvrtMark, InvrtWordmark } from "./InvrtMark";
import { AppText as Text } from "./ui/AppText";

// Keep the native composition on the same cap-height contract as Lockup.jsx.
export function InvrtLockup({ cap = 14 }: { readonly cap?: number }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="INVRT Code"
      className="flex-row items-center"
      style={{ gap: cap * 0.42, padding: cap * 0.5, flexShrink: 0 }}
    >
      <View accessible={false} style={{ width: cap * 5.924044, height: cap * 1.21 }}>
        <View style={{ position: "absolute", left: 0, top: 0 }}>
          <InvrtMark height={cap * 1.21} colorClassName="text-foreground" />
        </View>
        <View style={{ position: "absolute", left: cap * 1.855044, top: cap * 0.082164 }}>
          <InvrtWordmark height={cap * 1.0418519} colorClassName="text-foreground" />
        </View>
      </View>
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: "Inter18pt-SemiBold",
          fontSize: cap * 0.86,
          letterSpacing: cap * 0.86 * -0.005,
          lineHeight: cap * 1.21,
          includeFontPadding: false,
        }}
      >
        Code
      </Text>
    </View>
  );
}
