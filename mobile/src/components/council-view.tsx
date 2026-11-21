import { Text, View } from "react-native";

import { CouncilResult } from "@/api";
import { Body, Card, Title } from "@/components/ui";
import { space, type, useColors } from "@/theme";

export const VERSION = ["版本一", "版本二", "版本三"] as const;

/** 智囊团看三个版本：每个视角一张卡，卡里每个版本三句；不排名、不说选哪个。分歧不为空时最后一张卡照实写。 */
export function CouncilView({ result, titles }: { result: CouncilResult; titles: string[] }) {
  const c = useColors();
  const line = (k: string, v: string) => (
    <Text style={[type.body, { color: c.text }]}><Text style={{ color: c.muted }}>{k}　</Text>{v}</Text>
  );
  return (
    <>
      {result.lenses.map((l, i) => (
        <Card key={l.title} i={i}>
          <Title>{l.title}</Title>
          {l.versions.map((v, j) => (
            <View key={j} style={{ gap: space.xs }}>
              <Text style={[type.eyebrow, { color: c.muted }]}>{`${VERSION[j]} · ${titles[j]}`}</Text>
              {line("看到", v.sees)}
              {line("最大的未知", v.unknown)}
              {line("一个月能做的试验", v.test)}
            </View>
          ))}
        </Card>
      ))}
      {!!result.disagreement.trim() && (
        <Card i={result.lenses.length}>
          <Title>看法不一样的地方</Title>
          <Body>{result.disagreement}</Body>
        </Card>
      )}
    </>
  );
}
