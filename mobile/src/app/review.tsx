import { useEffect, useState } from "react";
import { View } from "react-native";

import { Adjustment, answerAdjustment, confirmProfile, getReview, isCrisis, Review } from "@/api";
import { Body, Button, Card, CrisisCard, Field, Label, Loading, Notice, Row, Screen, Small, Title } from "@/components/ui";
import { space } from "@/theme";

/** 调整写成人话：数字是后端给的，这里只拼字。 */
function describe(a: Adjustment): string {
  if (a.kind === "add_habit") return `加一个新习惯「${a.title}」，每次 ${a.value} 分钟`;
  return `「${a.title}」的${a.kind === "minutes" ? "标准版" : "保底版"}改成 ${a.value} 分钟`;
}

/** 每周复盘：数字由后端程序算好，这一页只显示；调整点「好」才写进设置。 */
export default function ReviewScreen() {
  const [review, setReview] = useState<Review | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [stillRight, setStillRight] = useState<"asking" | "editing" | "done">("asking");
  const [edited, setEdited] = useState("");
  const [busy, setBusy] = useState(false); // 一次只答一条：连点也只发一个请求

  useEffect(() => {
    getReview().then(
      (r) => (isCrisis(r) ? setCrisis(r.message) : setReview(r)),
      (e: Error) => setMessage(e.message),
    );
  }, []);

  async function answer(index: number, accept: boolean) {
    if (!review || busy) return;
    setBusy(true);
    setMessage(null);
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
      if (isCrisis(res)) setCrisis(res.message);
      else setStillRight("done");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  if (crisis) return <Screen><CrisisCard message={crisis} /></Screen>;
  if (!review) return message ? <Screen><Notice tone="error">{message}</Notice></Screen> : <Loading text="正在看这 7 天的记录……" />;

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <Title>这一周</Title>
        {review.last_question && <Small muted>上周带进来的问题：{review.last_question}</Small>}
      </View>
      <Card>
        <Body>{review.summary}</Body>
      </Card>

      {review.adjustments.length > 0 && <Label>可以试试的调整</Label>}
      {review.adjustments.map((a, i) => (
        <Card key={i}>
          <Label>{describe(a)}</Label>
          <Small muted>{a.why}</Small>
          {a.answer ? (
            <Small muted>{a.answer === "好" ? "✓ 已改，从今天的计划开始" : "先不改"}</Small>
          ) : (
            <Row>
              <Button label="好" onPress={() => answer(i, true)} disabled={busy} />
              <Button label="先不改" variant="quiet" onPress={() => answer(i, false)} disabled={busy} />
            </Row>
          )}
        </Card>
      ))}

      {review.still_right && stillRight !== "done" && (
        <Card>
          <Label>{review.still_right.question}</Label>
          {stillRight === "asking" ? (
            <Row>
              <Button label="还对" onPress={() => reconfirm()} />
              <Button label="要改" variant="quiet"
                onPress={() => (setEdited(review.still_right!.content), setStillRight("editing"))} />
            </Row>
          ) : (
            <>
              <Field value={edited} onChangeText={setEdited} multiline accessibilityLabel="改成" />
              <Button label="改好了" onPress={() => reconfirm(edited)} />
            </>
          )}
        </Card>
      )}

      <Card>
        <Small muted>带进下周的问题</Small>
        <Title>{review.question}</Title>
      </Card>
      {message && <Notice tone="error">{message}</Notice>}
    </Screen>
  );
}
