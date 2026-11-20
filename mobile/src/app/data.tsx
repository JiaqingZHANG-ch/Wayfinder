import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { Country, deleteMe, exportData, getMe, Me, putMe } from "@/api";

const COUNTRIES: [Country, string][] = [["CN", "中国"], ["FR", "法国"], ["", "别的国家 / 不想说"]];

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
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    getMe().then(setMe, (e: Error) => setMessage(e.message));
  }, []);

  async function run(fn: () => Promise<void>) {
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  const changeCountry = (c: Country) =>
    run(async () => setMe(await putMe(c, me?.is_adult ?? false, me!.privacy.version)));

  const doExport = () =>
    run(async () => {
      const data = await exportData();
      await saveJson(`wayfinder-${data.exported_at.slice(0, 10)}.json`, JSON.stringify(data, null, 2));
      const rows = Object.values(data.tables).reduce((n, t) => n + t.length, 0);
      setMessage(`导出了 ${rows} 条记录。`);
    });

  const doDelete = () =>
    run(async () => {
      await deleteMe();
      router.replace("/"); // 首页会带你回到同意和建档
    });

  if (!me) return <Text style={styles.page}>{message ?? "……"}</Text>;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.heading}>所在国家</Text>
      <Text style={styles.muted}>遇到危险时，显示这个国家的求助电话。</Text>
      <View style={styles.row}>
        {COUNTRIES.map(([code, name]) => (
          <Pressable key={name} onPress={() => changeCountry(code)} accessibilityRole="radio"
            accessibilityState={{ checked: me.country === code }}
            style={[styles.choice, me.country === code && styles.chosen]}>
            <Text style={me.country === code ? styles.chosenText : undefined}>{name}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.heading}>导出</Text>
      <Text style={styles.muted}>你在 Wayfinder 里的全部数据，存成一个 JSON 文件。</Text>
      <Pressable style={styles.button} onPress={doExport} accessibilityRole="button">
        <Text style={styles.buttonText}>导出我的数据</Text>
      </Pressable>

      <Text style={styles.heading}>删除</Text>
      <Text style={styles.muted}>删掉这里存的全部数据，不能恢复。已经写进你 Google 日历的计划不会删，要在日历里自己删。</Text>
      {confirming ? (
        <View style={styles.row}>
          <Pressable style={[styles.button, styles.danger]} onPress={doDelete} accessibilityRole="button">
            <Text style={styles.buttonText}>确定，全部删除</Text>
          </Pressable>
          <Pressable style={styles.choice} onPress={() => setConfirming(false)} accessibilityRole="button">
            <Text>先不删</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.choice} onPress={() => setConfirming(true)} accessibilityRole="button">
          <Text style={styles.dangerText}>删除我的全部数据</Text>
        </Pressable>
      )}

      {message && <Text style={styles.muted}>{message}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10, maxWidth: 560, width: "100%", alignSelf: "center" },
  heading: { fontSize: 16, fontWeight: "600", marginTop: 12 },
  muted: { color: "#5f6368", lineHeight: 20 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { borderWidth: 1, borderColor: "#dadce0", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
    alignSelf: "flex-start" },
  chosen: { backgroundColor: "#1a73e8", borderColor: "#1a73e8" },
  chosenText: { color: "#fff" },
  button: { backgroundColor: "#1a73e8", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16,
    alignSelf: "flex-start" },
  buttonText: { color: "#fff" },
  danger: { backgroundColor: "#b3261e" },
  dangerText: { color: "#b3261e" },
});
