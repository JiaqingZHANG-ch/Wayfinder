import { useState } from "react";

import { Country, Me, putMe } from "@/api";
import { Body, Button, Card, Chip, Label, Notice, Row, Title } from "@/components/ui";

export const COUNTRIES: [Country, string][] = [["CN", "中国"], ["FR", "法国"], ["", "别的国家 / 不想说"]];

/** 隐私说明 + 国家 + 是否成年 + 同意。新用户建档前看一次；说明改了版本，老用户打开首页时再看一次。 */
export function Consent({ me, onDone }: { me: Me; onDone: (me: Me) => void }) {
  const filledBefore = me.is_adult !== null; // 同意过旧版本的老用户：沿用他填过的
  const [country, setCountry] = useState<Country | null>(filledBefore ? me.country : null);
  const [adult, setAdult] = useState(me.is_adult ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function agree() {
    if (country === null) return setError("先选一下你在哪个国家");
    setBusy(true);
    try {
      onDone(await putMe(country, adult, me.privacy.version));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Title>{filledBefore ? "隐私说明更新了，请再看一遍" : "开始之前，看一下数据怎么用"}</Title>
      <Card>
        <Body muted>{me.privacy.text}</Body>
      </Card>
      <Label>你现在在哪个国家？</Label>
      <Body muted>遇到危险时，会显示当地的求助电话。</Body>
      <Row>
        {COUNTRIES.map(([code, name]) => (
          <Chip key={name} label={name} on={country === code} onPress={() => setCountry(code)} />
        ))}
      </Row>
      <Row>
        <Chip role="checkbox" label={`${adult ? "✓ " : ""}我已经年满 18 岁`} on={adult} onPress={() => setAdult(!adult)} />
      </Row>
      {error && <Notice tone="error">{error}</Notice>}
      <Button label="同意，开始" busyLabel={busy ? "……" : undefined} onPress={agree} />
    </>
  );
}
