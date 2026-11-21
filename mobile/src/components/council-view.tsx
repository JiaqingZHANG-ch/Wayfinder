import { useState } from "react";
import { Text, View } from "react-native";

import { CouncilResult } from "@/api";
import { Body, Card, Chip, Title } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

export const VERSION = ["版本一", "版本二", "版本三"] as const;

/**
 * 智囊团看三个版本：顶上三颗药丸选看哪个版本（没有先后好坏，不是排名），下面是他自己写的原文，
 * 每个视角一张卡只画这个版本的三句；不说选哪个。分歧不为空时最后一张卡照实写。
 */
export function CouncilView({ result, titles, versions }: { result: CouncilResult; titles: string[]; versions: string[] }) {
  const c = useColors();
  const [j, setJ] = useState(0);
  const line = (k: string, v: string, soft?: boolean) => (
    // 「一个月能做的试验」是唯一能动手的一句：垫柔和底
    <View style={soft && { backgroundColor: c.soft, borderRadius: radius.md, padding: space.md }}>
      <Text style={[type.label, { color: soft ? c.onSoft : c.muted }]}>{k}</Text>
      <Text style={[type.body, { color: soft ? c.onSoft : c.text }]}>{v}</Text>
    </View>
  );
  return (
    <>
      <View accessibilityRole="radiogroup" accessibilityLabel="看哪个版本" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {VERSION.map((name, i) => <Chip key={name} label={name} on={j === i} onPress={() => setJ(i)} />)}
      </View>
      <View style={{ gap: space.xs }}>
        <Text style={[type.eyebrow, { color: c.muted }]}>{titles[j]}</Text>
        <Body muted>{`「${versions[j]}」`}</Body>
      </View>
      {result.lenses.map((l, i) => {
        const v = l.versions[j];
        return (
          <Card key={l.title} i={i}>
            {/* 出处只进文档，界面上不把模型的话挂在真人名下 */}
            <Title>{l.title.replace(/（源自.*?）/, "")}</Title>
            {v && (
              <View style={{ gap: space.sm }}>
                {line("看到", v.sees)}
                {line("最大的未知", v.unknown)}
                {line("一个月能做的试验", v.test, true)}
              </View>
            )}
          </Card>
        );
      })}
      {!!result.disagreement.trim() && (
        <Card i={result.lenses.length}>
          <Title>看法不一样的地方</Title>
          <Body>{result.disagreement}</Body>
        </Card>
      )}
    </>
  );
}
