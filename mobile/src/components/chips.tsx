import { Text, View } from "react-native";

import { Energy } from "@/api";
import { Chip, Row } from "@/components/ui";
import { ENERGY_LABELS } from "@/labels";
import { space, type, useColors } from "@/theme";

export { Chip };

// 每个选项下面一行小说明，第一次见也看得懂
const ENERGY_HINTS = { love: "做完更有劲", recharge: "累，但值得", drain: "做得好，但很耗" } as const;

/** 能量地图三选一：热爱／累但回血／擅长但耗能。再点一次取消。 */
export function EnergyPick({ value, onChange }: { value: Energy | null; onChange: (v: Energy | null) => void }) {
  const c = useColors();
  return (
    <Row>
      {(Object.keys(ENERGY_LABELS) as Energy[]).map((k) => (
        <View key={k} style={{ gap: space.xs, alignItems: "center" }}>
          <Chip label={ENERGY_LABELS[k]} on={value === k} onPress={() => onChange(value === k ? null : k)} />
          <Text style={[type.small, { color: c.muted }]}>{ENERGY_HINTS[k]}</Text>
        </View>
      ))}
    </Row>
  );
}
