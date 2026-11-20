import { Pressable, StyleSheet, Text, View } from "react-native";

import { Energy } from "@/api";
import { ENERGY_LABELS } from "@/labels";

/** 一个可点的小方块，选中变蓝。 */
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
      style={[styles.chip, on && styles.chosen]}>
      <Text style={on ? styles.chosenText : undefined}>{label}</Text>
    </Pressable>
  );
}

/** 能量地图三选一：热爱／累但回血／擅长但耗能。再点一次取消。 */
export function EnergyPick({ value, onChange }: { value: Energy | null; onChange: (v: Energy | null) => void }) {
  return (
    <View style={styles.row}>
      {(Object.keys(ENERGY_LABELS) as Energy[]).map((k) => (
        <Chip key={k} label={ENERGY_LABELS[k]} on={value === k} onPress={() => onChange(value === k ? null : k)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#dadce0", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10,
    alignSelf: "flex-start" },
  chosen: { backgroundColor: "#1a73e8", borderColor: "#1a73e8" },
  chosenText: { color: "#fff" },
});
