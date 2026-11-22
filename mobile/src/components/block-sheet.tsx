import { useState } from "react";
import { Modal, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { Block } from "@/api";
import { Pressy } from "@/components/motion";
import { fromMin, kindName, toMin } from "@/components/plan-view";
import { Sheet } from "@/components/sheet";
import { Button, Field, Icon, IconButton, Notice, Small, Title } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

const MIN_MINUTES = 10;

/**
 * 点一块弹出的底部面板：改时长（±5 分钟）、删除；当天说的事还能改名字（习惯、项目的名字在设置里改）。
 * 放在 Modal 里：Sheet 本来是整页路由，这里用 onClose 关掉就行；Modal 里要自己包一层手势根。
 * onSave / onDelete 返回错误说明（成功是 null）：成功就关面板，失败留着、把话说在面板里。
 */
export function BlockSheet({ b, onClose, onSave, onDelete }: {
  b: Block; onClose: () => void; onSave: (end: number, title?: string) => Promise<string | null>; onDelete: () => Promise<string | null>;
}) {
  const c = useColors();
  const start = toMin(b.start);
  const was = toMin(b.end) - start;
  const [minutes, setMinutes] = useState(was);
  const [title, setTitle] = useState(b.title);
  const renamed = title.trim() !== b.title;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(job: () => Promise<string | null>, close: () => void) {
    setBusy(true);
    setError(null);
    const err = await job();
    setBusy(false);
    if (err) setError(err);
    else close();
  }
  const step = (n: number) => (
    <Pressy onPress={() => setMinutes((m) => Math.max(MIN_MINUTES, m + n))} accessibilityRole="button" disabled={busy}
      accessibilityLabel={n > 0 ? "加 5 分钟" : "减 5 分钟"} scaleTo={0.9}
      style={{ width: 52, height: 52, borderRadius: radius.pill, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
      <Icon name={n > 0 ? "add" : "remove"} size={24} color={c.text} />
    </Pressy>
  );

  return (
    <Modal transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Sheet onClose={onClose} header={(close) => (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
            <View style={{ flex: 1, gap: space.xs }}>
              <Title>{b.title}</Title>
              <Small muted>{[`${b.start} 开始`, kindName(b)].filter(Boolean).join("  ")}</Small>
            </View>
            <IconButton name="close" label="关闭" onPress={close} />
          </View>
        )}>
          {(close) => (
            <View style={{ gap: space.lg }}>
              <View accessible accessibilityRole="adjustable" accessibilityLabel="时长"
                accessibilityValue={{ text: `${minutes} 分钟，到 ${fromMin(start + minutes)}` }}
                accessibilityActions={[{ name: "increment", label: "加 5 分钟" }, { name: "decrement", label: "减 5 分钟" }]}
                onAccessibilityAction={(e) => setMinutes((m) => Math.max(MIN_MINUTES, m + (e.nativeEvent.actionName === "increment" ? 5 : -5)))}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                {step(-5)}
                <View style={{ alignItems: "center" }}>
                  <Text style={[type.stat, { color: c.text }]}>{minutes}<Text style={type.label}> 分钟</Text></Text>
                  <Text style={[type.small, type.num, { color: c.muted }]}>{b.start}–{fromMin(start + minutes)}</Text>
                </View>
                {step(5)}
              </View>
              {b.item_id && <Field label="名字" value={title} onChangeText={setTitle} maxLength={30} editable={!busy} />}
              {error && <Notice tone="error">{error}</Notice>}
              <Button label="保存" disabled={(minutes === was && !renamed) || !title.trim()} busyLabel={busy ? "正在保存……" : undefined}
                onPress={() => run(() => onSave(start + minutes, renamed ? title.trim() : undefined), close)} />
              <Button label="删除这一块" variant="quietDanger" disabled={busy} onPress={() => run(onDelete, close)} />
            </View>
          )}
        </Sheet>
      </GestureHandlerRootView>
    </Modal>
  );
}
