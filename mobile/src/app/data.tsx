import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Share, Text, View } from "react-native";

import { Country, deleteMe, exportData, getMe, Me, putMe } from "@/api";
import { COUNTRIES } from "@/components/consent";
import { haptic, Pressy, Skeleton } from "@/components/motion";
import { Button, Card, ErrorState, Header, Icon, Label, Notice, Row, Screen } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

/** 导出成文件：网页版直接下载，手机上用系统的分享（存到文件、发给自己都行）。 */
async function saveJson(name: string, text: string) {
  if (Platform.OS === "web") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  } else {
    await Share.share({ title: name, message: text });
  }
}

/** 国家选项：勾的位置一直留着（没选中时透明），选中前后宽度不变，一排不会跳。 */
function CountryChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressy onPress={() => { haptic.select(); onPress(); }} accessibilityRole="radio" accessibilityLabel={label}
      accessibilityState={{ checked: on }} scaleTo={0.94}
      style={{ minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, flexDirection: "row", alignItems: "center",
        gap: space.xs, backgroundColor: on ? c.soft : c.sunken, borderWidth: 1.5, borderColor: on ? c.primary : "transparent" }}>
      <View style={{ opacity: on ? 1 : 0 }}><Icon name="checkmark" size={16} color={c.onSoft} /></View>
      <Text style={[type.label, { color: on ? c.onSoft : c.text }]}>{label}</Text>
    </Pressy>
  );
}

/** 我的数据：换国家（决定危机提示的热线）、导出全部、删除全部。 */
export default function DataScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);

  function load() {
    getMe().then(setMe, () => setFailed(true));
  }
  useEffect(load, []);

  async function run(fn: () => Promise<void>) {
    setMessage(null);
    try {
      await fn();
    } catch {
      setMessage({ text: "没成功，网络好了再试一次。", error: true });
    }
  }

  const changeCountry = (c: Country) =>
    run(async () => setMe(await putMe(c, me?.is_adult ?? false)));

  const doExport = () =>
    run(async () => {
      const data = await exportData();
      await saveJson(`wayfinder-${data.exported_at.slice(0, 10)}.json`, JSON.stringify(data, null, 2));
      const rows = Object.values(data.tables).reduce((n, t) => n + t.length, 0);
      setMessage({ text: `导出了 ${rows} 条记录。`, error: false });
    });

  const doDelete = () =>
    run(async () => {
      await deleteMe();
      router.dismissTo("/"); // 回到今天：首页会带你去建档
    });

  if (failed) return <Screen safeTop><Header title="我的数据" /><ErrorState onRetry={() => { setFailed(false); load(); }} /></Screen>;
  if (!me) {
    return (
      <Screen safeTop>
        <Header title="我的数据" />
        <Skeleton height={140} r={radius.lg} />
        <Skeleton height={120} r={radius.lg} />
        <Skeleton height={140} r={radius.lg} />
      </Screen>
    );
  }

  return (
    <Screen safeTop>
      <Header title="我的数据" />
      <Card i={1}>
        <Label>所在国家</Label>
        <Label muted>遇到危险时，显示这个国家的求助电话。</Label>
        <Row>
          {COUNTRIES.map(([code, name]) => (
            <CountryChip key={name} label={name} on={me.country === code} onPress={() => changeCountry(code)} />
          ))}
        </Row>
      </Card>

      <Card i={2}>
        <Label>导出</Label>
        <Label muted>你在 Wayfinder 里的全部数据，存成一个文件，可以留着备份。</Label>
        <Button label="导出我的数据" variant="secondary" onPress={doExport} />
      </Card>

      <Card i={3}>
        <Label>删除</Label>
        <Label muted>删掉这里存的全部数据，不能恢复。已经写进你 Google 日历的计划不会删，要在日历里自己删。</Label>
        {confirming ? (
          <Row>
            <Button label="确定，全部删除" variant="danger" onPress={doDelete} />
            <Button label="先不删" variant="quiet" onPress={() => setConfirming(false)} />
          </Row>
        ) : (
          <Button label="删除我的全部数据" variant="quietDanger" onPress={() => setConfirming(true)} />
        )}
      </Card>

      {message && <Notice tone={message.error ? "error" : "info"}>{message.text}</Notice>}
    </Screen>
  );
}
