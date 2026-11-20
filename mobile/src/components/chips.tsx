import { Energy } from "@/api";
import { Chip, Row } from "@/components/ui";
import { ENERGY_LABELS } from "@/labels";

export { Chip };

/** 能量地图三选一：热爱／累但回血／擅长但耗能。再点一次取消。 */
export function EnergyPick({ value, onChange }: { value: Energy | null; onChange: (v: Energy | null) => void }) {
  return (
    <Row>
      {(Object.keys(ENERGY_LABELS) as Energy[]).map((k) => (
        <Chip key={k} label={ENERGY_LABELS[k]} on={value === k} onPress={() => onChange(value === k ? null : k)} />
      ))}
    </Row>
  );
}
