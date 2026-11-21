import { Text, View } from "react-native";

import { haptic, Pressy } from "@/components/motion";
import { radius, type, useColors } from "@/theme";

/**
 * 一排可点的圆点：from…to 分，亮几个点就是几分（0 是最左边那个空心圈，永远不亮）。读屏念「健康 6 分」。
 * ends：点下面左右两头写上 from 和 to。
 */
export function Dots({ label, from, to, value, onChange, ends }: {
  label: string; from: number; to: number; value?: number; onChange: (n: number) => void; ends?: boolean;
}) {
  const c = useColors();
  const ns = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <View>
      <View style={{ flexDirection: "row" }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {ns.map((n) => {
          const lit = value !== undefined && n > 0 && n <= value;
          return (
            <Pressy key={n} onPress={() => { haptic.select(); onChange(n); }} accessibilityRole="radio"
              accessibilityState={{ checked: value === n }} accessibilityLabel={`${label} ${n} 分`} scaleTo={0.85}
              style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: value === n ? 20 : 14, height: value === n ? 20 : 14, borderRadius: radius.pill,
                backgroundColor: lit ? c.primaryEdge : "transparent", borderWidth: lit ? 0 : 1.5,
                borderColor: n === 0 && value === 0 ? c.primaryEdge : c.kindEdge.life }} />
            </Pressy>
          );
        })}
      </View>
      {ends && (
        <View style={{ flexDirection: "row" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {ns.map((n) => (
            <Text key={n} style={[type.small, type.num, { flex: 1, textAlign: "center", color: c.muted }]}>
              {n === from || n === to ? n : ""}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
