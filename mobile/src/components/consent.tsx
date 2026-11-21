import { useState } from "react";
import { Text, View } from "react-native";

import { Country, Me, putMe } from "@/api";
import { haptic, Pressy } from "@/components/motion";
import { Body, Button, Card, Chip, Display, Icon, IconName, Label, Notice, Row, Small } from "@/components/ui";
import { space, type, useColors } from "@/theme";

export const COUNTRIES: [Country, string][] = [["CN", "中国"], ["FR", "法国"], ["", "别的国家 / 不想说"]];

const POINTS: [IconName, string][] = [
  ["lock-closed-outline", "数据只存在你自己的电脑上，不上传到我们的服务器"],
  ["cloud-outline", "用云端模型（DeepSeek）时，你写的话会发给它"],
  ["download-outline", "随时可以导出、删除"],
];

/** 隐私说明 + 国家 + 是否成年 + 同意。新用户建档前看一次；说明改了版本，老用户打开首页时再看一次。 */
export function Consent({ me, onDone }: { me: Me; onDone: (me: Me) => void }) {
  const c = useColors();
  const filledBefore = me.is_adult !== null; // 同意过旧版本的老用户：沿用他填过的
  const [country, setCountry] = useState<Country | null>(filledBefore ? me.country : null);
  const [adult, setAdult] = useState(me.is_adult ?? false);
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function agree() {
    if (country === null) return setError("先选一下你在哪个国家");
    setBusy(true);
    try {
      onDone(await putMe(country, adult, me.privacy.version));
    } catch {
      setError("没连上，网络好了再试一次。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <View style={{ gap: space.xs }}>
        <Display>{filledBefore ? "隐私说明更新了" : "开始之前"}</Display>
        <Small muted>{filledBefore ? "和上次不一样的地方，请再看一遍。" : "先看一下数据怎么用。"}</Small>
      </View>
      <Card>
        {POINTS.map(([icon, text]) => (
          <View key={icon} style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
            <Icon name={icon} size={20} color={c.muted} />
            <Text style={[type.label, { flex: 1, color: c.text }]}>{text}</Text>
          </View>
        ))}
        <Button label={full ? "收起完整说明" : "看完整说明"} variant="quiet" onPress={() => setFull(!full)} />
        {full && <Body muted>{me.privacy.text}</Body>}
      </Card>
      <Label>你现在在哪个国家？遇到危险时会显示当地的求助电话。</Label>
      <Row>
        {COUNTRIES.map(([code, name]) => (
          <Chip key={name} label={name} on={country === code} onPress={() => setCountry(code)} />
        ))}
      </Row>
      <Pressy onPress={() => { haptic.select(); setAdult(!adult); }} accessibilityRole="checkbox" accessibilityLabel="我已经年满 18 岁"
        accessibilityState={{ checked: adult }} scaleTo={0.98}
        style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 44 }}>
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center",
          borderColor: adult ? c.primary : c.muted, backgroundColor: adult ? c.primary : "transparent" }}>
          {adult && <Icon name="checkmark" size={16} color={c.onPrimary} />}
        </View>
        <Text style={[type.body, { color: c.text }]}>我已经年满 18 岁</Text>
      </Pressy>
      {error && <Notice tone="error">{error}</Notice>}
      <Button label="同意，开始" busyLabel={busy ? "……" : undefined} onPress={agree} />
    </>
  );
}
