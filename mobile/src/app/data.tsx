import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Share } from "react-native";

import { Country, deleteMe, exportData, getMe, Me, putMe } from "@/api";
import { COUNTRIES } from "@/components/consent";
import { Body, Button, Card, Chip, Label, Loading, Notice, Row, Screen } from "@/components/ui";

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

/** 我的数据：换国家（决定危机提示的热线）、导出全部、删除全部。 */
export default function DataScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    getMe().then(setMe, (e: Error) => setMessage({ text: e.message, error: true }));
  }, []);

  async function run(fn: () => Promise<void>) {
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
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
      router.replace("/"); // 首页会带你回到同意和建档
    });

  if (!me) return message ? <Screen><Notice tone="error">{message.text}</Notice></Screen> : <Loading text="……" />;

  return (
    <Screen>
      <Card>
        <Label>所在国家</Label>
        <Body muted>遇到危险时，显示这个国家的求助电话。</Body>
        <Row>
          {COUNTRIES.map(([code, name]) => (
            <Chip key={name} label={name} on={me.country === code} onPress={() => changeCountry(code)} />
          ))}
        </Row>
      </Card>

      <Card>
        <Label>导出</Label>
        <Body muted>你在 Wayfinder 里的全部数据，存成一个 JSON 文件。</Body>
        <Button label="导出我的数据" variant="secondary" onPress={doExport} />
      </Card>

      <Card>
        <Label>删除</Label>
        <Body muted>删掉这里存的全部数据，不能恢复。已经写进你 Google 日历的计划不会删，要在日历里自己删。</Body>
        {confirming ? (
          <Row>
            <Button label="确定，全部删除" variant="danger" onPress={doDelete} />
            <Button label="先不删" variant="quiet" onPress={() => setConfirming(false)} />
          </Row>
        ) : (
          <Button label="删除我的全部数据" variant="quiet" onPress={() => setConfirming(true)} />
        )}
      </Card>

      {message && <Notice tone={message.error ? "error" : "info"}>{message.text}</Notice>}
    </Screen>
  );
}
