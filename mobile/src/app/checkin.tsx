import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { CheckinItem, checkinItems, getToday } from "@/api";

export default function Checkin() {
  const [items, setItems] = useState<CheckinItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // 循环 ③：加一个 state，记下每一项点了哪个按钮（键是 item.id，值是 done / floor / skip）

  useEffect(() => {
    getToday().then((plan) => setItems(checkinItems(plan)), (e: Error) => setError(e.message));
  }, []);

  if (error) return <Text style={styles.message}>没拿到今天的计划：{error}</Text>;
  if (!items) return <Text style={styles.message}>正在读今天的计划……</Text>;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {items.map((item) => (
        <View key={item.id} style={styles.item}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          {/* 循环 ③：这里放三个按钮，字用 src/labels.ts 的 STATUS_LABELS，点了会变色 */}
          {/* 项目（item.project 为 true）另有三个：VS_PLAN_LABELS */}
        </View>
      ))}
      <TextInput
        style={styles.note}
        placeholder="想说一句也可以，不写也行"
        value={note}
        onChangeText={setNote}
        multiline
      />
      {/* 循环 ③：这里显示「记录了几天」，数字来自 getWeek() 的 logged_days */}
      {/* 循环 ④：加「记好了」按钮 → postCheckin → 把返回的 closing（只引用你自己的话）显示在下面 */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 560, width: "100%", alignSelf: "center" },
  item: { gap: 6 },
  itemTitle: { fontSize: 16, fontWeight: "500" },
  note: { borderWidth: 1, borderColor: "#dadce0", borderRadius: 8, padding: 10, minHeight: 64 },
  message: { padding: 16 },
});
