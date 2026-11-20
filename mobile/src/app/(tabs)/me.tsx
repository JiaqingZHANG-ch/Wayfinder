import Constants from "expo-constants";
import { router } from "expo-router";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { enter } from "@/components/motion";
import { Card, Display, Eyebrow, Icon, ListRow, Screen, Small } from "@/components/ui";
import { radius, space, TAB_SPACE, useColors } from "@/theme";

/** 「我」：计划设置和隐私数据的入口，像系统设置那样分组。 */
export default function MeScreen() {
  const c = useColors();
  return (
    <Screen safeTop bottom={TAB_SPACE}>
      <Animated.View entering={enter(0)} style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
        <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: c.soft,
          alignItems: "center", justifyContent: "center" }}>
          <Icon name="compass" size={32} color={c.onSoft} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Display>我</Display>
          <Small muted>Wayfinder 记得你的作息、习惯和课表。</Small>
        </View>
      </Animated.View>

      <Eyebrow>计划</Eyebrow>
      <Card i={1} style={{ paddingVertical: space.xs }}>
        <ListRow icon="alarm-outline" title="作息和习惯" sub="几点起、几点睡，每天想坚持的事" onPress={() => router.push("/settings")} />
        <ListRow icon="school-outline" title="课表和项目" sub="每周的课，手上在做的项目" onPress={() => router.push("/settings")} />
        <ListRow icon="notifications-outline" title="提醒" sub="下课提醒、晚间对账提醒" onPress={() => router.push("/settings")} last />
      </Card>

      <Eyebrow>隐私和数据</Eyebrow>
      <Card i={2} style={{ paddingVertical: space.xs }}>
        <ListRow icon="shield-checkmark-outline" title="我的数据" sub="所在国家、导出、删除" onPress={() => router.push("/data")} last />
      </Card>

      <Animated.View entering={enter(3)} style={{ alignItems: "center", gap: space.xs, paddingTop: space.lg }}>
        <Small muted>Wayfinder {Constants.expoConfig?.version ?? ""}</Small>
      </Animated.View>
    </Screen>
  );
}
