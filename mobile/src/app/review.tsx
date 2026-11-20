import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Adjustment, answerAdjustment, confirmProfile, getReview, isCrisis, Review } from "@/api";

/** 调整写成人话：数字是后端给的，这里只拼字。 */
function describe(a: Adjustment): string {
  if (a.kind === "add_habit") return `加一个新习惯「${a.title}」，每次 ${a.value} 分钟`;
  return `「${a.title}」的${a.kind === "minutes" ? "标准版" : "保底版"}改成 ${a.value} 分钟`;
}

/** 每周复盘：数字由后端程序算好，这一页只显示；调整点「好」才写进设置。 */
export default function ReviewScreen() {
  const [review, setReview] = useState<Review | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stillRight, setStillRight] = useState<"asking" | "editing" | "done">("asking");
  const [edited, setEdited] = useState("");
  const [busy, setBusy] = useState(false); // 一次只答一条：连点也只发一个请求

  useEffect(() => {
    getReview().then(
      (r) => (isCrisis(r) ? setMessage(r.message) : setReview(r)),
      (e: Error) => setMessage(e.message),
    );
  }, []);

  async function answer(index: number, accept: boolean) {
    if (!review || busy) return;
    setBusy(true);
    try {
      setReview(await answerAdjustment(review.id, index, accept));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reconfirm(content?: string) {
    if (!review?.still_right) return;
    try {
      const res = await confirmProfile(review.still_right.id, content);
      if (isCrisis(res)) setMessage(res.message);
      else setStillRight("done");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  if (!review) return <Text style={styles.page}>{message ?? "正在看这 7 天的记录……"}</Text>;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {review.last_question && <Text style={styles.muted}>上周带进来的问题：{review.last_question}</Text>}
      <Text style={styles.summary}>{review.summary}</Text>

      {review.adjustments.length > 0 && <Text style={styles.heading}>可以试试的调整</Text>}
      {review.adjustments.map((a, i) => (
        <View key={i} style={styles.card}>
          <Text style={styles.body}>{describe(a)}</Text>
          <Text style={styles.muted}>{a.why}</Text>
          {a.answer ? (
            <Text style={styles.muted}>{a.answer === "好" ? "已改，从今天的计划开始" : "先不改"}</Text>
          ) : (
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => answer(i, true)} disabled={busy} accessibilityRole="button">
                <Text style={styles.buttonText}>好</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={() => answer(i, false)} disabled={busy} accessibilityRole="button">
                <Text style={styles.buttonText}>先不改</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}

      {review.still_right && stillRight !== "done" && (
        <View style={styles.card}>
          <Text style={styles.body}>{review.still_right.question}</Text>
          {stillRight === "asking" ? (
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => reconfirm()} accessibilityRole="button">
                <Text style={styles.buttonText}>还对</Text>
              </Pressable>
              <Pressable
                style={styles.button}
                onPress={() => (setEdited(review.still_right!.content), setStillRight("editing"))}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>要改</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.row}>
              <TextInput style={styles.input} value={edited} onChangeText={setEdited} />
              <Pressable style={styles.button} onPress={() => reconfirm(edited)} accessibilityRole="button">
                <Text style={styles.buttonText}>改好了</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      <Text style={styles.heading}>带进下周的问题</Text>
      <Text style={styles.body}>{review.question}</Text>
      {message && <Text style={styles.muted}>{message}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 560, width: "100%", alignSelf: "center" },
  summary: { fontSize: 16, lineHeight: 26 },
  heading: { fontSize: 15, fontWeight: "600", marginTop: 8 },
  card: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12, gap: 8 },
  body: { fontSize: 15 },
  muted: { fontSize: 14, color: "#666" },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  button: { borderWidth: 1, borderColor: "#1a73e8", borderRadius: 6, paddingVertical: 6, paddingHorizontal: 14 },
  buttonText: { color: "#1a73e8", fontSize: 15 },
  input: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 6, fontSize: 15 },
});
