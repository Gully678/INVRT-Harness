import Constants from "expo-constants";
import { View } from "react-native";

import { AppText as Text } from "./ui/AppText";
import { InvrtLockup } from "./InvrtLockup";
import { resolveMobileStageLabel } from "../lib/mobileBranding";

const appVariant = Constants.expoConfig?.extra?.appVariant;
const DEFAULT_STAGE_LABEL = resolveMobileStageLabel(appVariant);

export function BrandMark(props: { readonly compact?: boolean; readonly stageLabel?: string }) {
  const compact = props.compact ?? false;
  const stageLabel = props.stageLabel ?? DEFAULT_STAGE_LABEL;

  return (
    <View className="flex-row items-center gap-3">
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <InvrtLockup cap={compact ? 16 : 18} />
          <View className="rounded-full bg-subtle px-2 py-1">
            <Text className="text-3xs font-t3-bold tracking-[1.1px] uppercase text-foreground-muted">
              {stageLabel}
            </Text>
          </View>
        </View>
        {!compact ? (
          <Text className="text-xs font-medium text-foreground-muted">
            Mobile control surface for your live coding environments
          </Text>
        ) : null}
      </View>
    </View>
  );
}
