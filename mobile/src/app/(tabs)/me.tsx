import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text } from "react-native";
import Animated from "react-native-reanimated";

import { getSettings, Settings } from "@/api";
import { enter } from "@/components/motion";
import { Card, Display, Eyebrow, ListRow, Screen, Small } from "@/components/ui";
import { space, TAB_SPACE, type, useColors } from "@/theme";

/** 「我」：一行真的小结（几点起、几门课、几个习惯），下面是计划设置和隐私数据的入口，像系统设置那样分组。 */
export default function MeScreen() {
  const c = useColors();
  const [s, setS] = useState<Settings | null>(null);
  useFocusEffect(useCallback(() => { getSettings().then(setS, () => {}); }, [])); // 拿不到就不写小结

  const classes = new Set((s?.timetable ?? []).map((x) => x.title)).size;
  const summary = s && [`${s.wake} 起`, classes ? `${classes} 门课` : "", s.habits.length ? `${s.habits.length} 个习惯` : ""]
    .filter(Boolean).join(" · ");
  const evening = s?.reminders?.evening;

  return (
    <Screen safeTop bottom={TAB_SPACE}>
      <Animated.View entering={enter(0)} style={{ gap: 2 }}>
        <Display>我</Display>
        <Text style={[type.small, type.num, { color: c.muted, minHeight: 19 }]}>{summary || " "}</Text>
      </Animated.View>

      <Eyebrow>计划</Eyebrow>
      <Card i={1} style={{ paddingVertical: space.xs }}>
        <ListRow icon="alarm-outline" title="作息和习惯" sub={s ? `${s.wake} 起 · ${s.sleep} 睡` : "几点起、几点睡，每天想坚持的事"}
          onPress={() => router.push("/settings?part=routine")} />
        <ListRow icon="school-outline" title="课表和项目" sub="每周的课，手上在做的项目" onPress={() => router.push("/settings?part=classes")} />
        <ListRow icon="notifications-outline" title="提醒" sub={evening ? `晚上 ${evening} 提醒对账` : "下课提醒、晚间对账提醒"}
          onPress={() => router.push("/settings?part=reminders")} last />
      </Card>

      <Eyebrow>隐私和数据</Eyebrow>
      <Card i={2} style={{ paddingVertical: space.xs }}>
        <ListRow icon="shield-checkmark-outline" title="我的数据" sub="所在国家、导出、删除" onPress={() => router.push("/data")} last />
      </Card>

      <Animated.View entering={enter(3)} style={{ alignItems: "center", paddingTop: space.lg }}>
        <Small muted>Wayfinder {Constants.expoConfig?.version ?? ""}</Small>
      </Animated.View>
    </Screen>
  );
}
