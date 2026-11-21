import { Text } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import type { Change } from "@/diff";
import { EASE } from "@/components/motion";
import { Card, Small } from "@/components/ui";
import { space, type, useColors } from "@/theme";

/**
 * 改了的几处，一行一句话：「看书　45 分 → 10 分（保底）」。新加的用绿色，不排了的用灰色；一行接一行进场。
 * when 是「今晚」（报电量）或「明天」（长谈标完累不累）；max 给了就只列前几处。
 */
export function Changes({ changes, when = "今晚", max }: { changes: Change[]; when?: "今晚" | "明天"; max?: number }) {
  const c = useColors();
  if (!changes.length) return <Text style={[type.label, { color: c.text }]}>{when}不用动，照原来的来。</Text>;
  const floors = changes.some((x) => x.title.endsWith("（保底）"));
  const shown = max ? changes.slice(0, max) : changes;
  return (
    <Card style={{ gap: space.sm }}>
      <Text style={[type.label, { color: c.text }]}>{when === "今晚" ? "帮你改了" : "明天改了"} {changes.length} 处</Text>
      {shown.map((x, i) => {
        const floor = x.title.endsWith("（保底）");
        const name = floor ? x.title.slice(0, -4) : x.title;
        const dropped = x.now === `${when}不排了`;
        const said = x.was ? `从 ${x.was} 改成 ${x.now}${floor ? "，保底" : ""}` : x.now;
        return (
          <Animated.View key={`${x.time}${x.title}`} entering={FadeInDown.delay(120 + i * 60).duration(240).easing(EASE)}
            accessible accessibilityLabel={`${x.time} ${name}，${said}`}
            style={{ flexDirection: "row", gap: space.sm, alignItems: "baseline", minHeight: 28 }}>
            <Text style={[type.small, type.num, { width: 44, color: c.muted }]}>{x.time}</Text>
            <Text style={[type.label, { flex: 1, color: dropped ? c.muted : c.text }]} numberOfLines={1}>{name}</Text>
            {x.was && <Text style={[type.small, type.num, { color: c.muted, textDecorationLine: "line-through" }]}>{x.was}</Text>}
            {x.was && <Small muted>→</Small>}
            <Text style={[type.small, type.num, { fontWeight: dropped ? "400" : "600",
              color: dropped ? c.muted : x.was ? c.text : c.ok }]}>{x.now}{floor ? "（保底）" : ""}</Text>
          </Animated.View>
        );
      })}
      {shown.length < changes.length && <Small muted>还有 {changes.length - shown.length} 处，明天首页看得到。</Small>}
      {floors && <Small muted>累的时候，习惯只排保底的那几分钟。</Small>}
    </Card>
  );
}
