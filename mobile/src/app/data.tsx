import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Share, Text } from "react-native";

import { Country, deleteMe, exportData, getMe, Me, putMe } from "@/api";
import { COUNTRIES } from "@/components/consent";
import { Skeleton } from "@/components/motion";
import { Button, Card, Chip, ErrorState, Header, Notice, Row, Screen, Small } from "@/components/ui";
import { radius, type, useColors } from "@/theme";

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

/** 卡片顶上的小标题。 */
function CardTitle({ children }: { children: string }) {
  const c = useColors();
  return <Text accessibilityRole="header" style={[type.eyebrow, { color: c.muted }]}>{children}</Text>;
}

/** 我的数据：换国家（决定危机提示的热线）、导出全部、删除全部。 */
export default function DataScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  // where：提示画在哪张卡里（按钮上方），不放到页面最底下
  const [message, setMessage] = useState<{ text: string; error: boolean; where: "country" | "export" | "delete" } | null>(null);
  const [confirming, setConfirming] = useState(false);

  function load() {
    getMe().then(setMe, () => setFailed(true));
  }
  useEffect(load, []);

  async function run(where: "country" | "export" | "delete", fn: () => Promise<void>) {
    setMessage(null);
    try {
      await fn();
    } catch {
      setMessage({ text: "没成功，网络好了再试一次。", error: true, where });
    }
  }
  const note = (where: "country" | "export" | "delete") =>
    message?.where === where ? <Notice tone={message.error ? "error" : "info"}>{message.text}</Notice> : null;

  const changeCountry = (c: Country) =>
    run("country", async () => setMe(await putMe(c, me?.is_adult ?? false)));

  const doExport = () =>
    run("export", async () => {
      const data = await exportData();
      await saveJson(`wayfinder-${data.exported_at.slice(0, 10)}.json`, JSON.stringify(data, null, 2));
      const rows = Object.values(data.tables).reduce((n, t) => n + t.length, 0);
      setMessage({ text: `导出了 ${rows} 条记录。`, error: false, where: "export" });
    });

  const doDelete = () =>
    run("delete", async () => {
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
        <CardTitle>所在国家</CardTitle>
        <Small muted>遇到危险时，显示这个国家的求助电话。</Small>
        <Row>
          {COUNTRIES.map(([code, name]) => (
            <Chip key={name} label={name} on={me.country === code} onPress={() => changeCountry(code)} />
          ))}
        </Row>
        {note("country")}
      </Card>

      <Card i={2}>
        <CardTitle>导出</CardTitle>
        <Small muted>你在 Wayfinder 里的全部数据，存成一个文件，可以留着备份。</Small>
        {note("export")}
        <Button label="导出我的数据" variant="secondary" onPress={doExport} />
      </Card>

      <Card i={3}>
        <CardTitle>删除</CardTitle>
        <Small muted>删掉这里存的全部数据，不能恢复。已经写进你 Google 日历的计划不会删，要在日历里自己删。</Small>
        {note("delete")}
        {confirming ? (
          <Row>
            <Button label="确定，全部删除" variant="danger" onPress={doDelete} />
            <Button label="先不删" variant="neutral" onPress={() => setConfirming(false)} />
          </Row>
        ) : (
          <Button label="删除我的全部数据" variant="quietDanger" onPress={() => setConfirming(true)} />
        )}
      </Card>
    </Screen>
  );
}
