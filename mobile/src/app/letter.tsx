import { useEffect, useState } from "react";

import { dayText, getLetters, Letter } from "@/api";
import { Skeleton } from "@/components/motion";
import { Body, Card, ErrorState, Header, Screen, Small, Title } from "@/components/ui";
import { radius } from "@/theme";

/** 给自己的信：没到期的只说哪天可以打开；到期的给他自己写的原话，和这段时间的两个数字。 */
export default function LetterScreen() {
  const [letters, setLetters] = useState<Letter[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => { getLetters().then((r) => setLetters(r.letters), () => setFailed(true)); };
  useEffect(load, []);

  if (failed) return <Screen safeTop><Header title="给自己的信" /><ErrorState onRetry={() => { setFailed(false); load(); }} /></Screen>;
  return (
    <Screen safeTop>
      <Header title="给自己的信" />
      {!letters ? <Skeleton height={120} r={radius.lg} /> : letters.map((l, i) => (
        <Card key={l.id} i={i + 1}>
          {l.status === "sealed" ? <Body>{`${dayText(l.due)} 可以打开`}</Body> : (
            <>
              <Small muted>{`${dayText(l.written_on)} 写的`}</Small>
              <Title>{`「${l.text}」`}</Title>
              {!!l.prototype && l.done_days == null && <Body>{l.prototype}</Body>}
              <Body muted>
                {`这 ${l.span_days} 天里，你记录了 ${l.logged_days} 天`
                  + (l.done_days == null ? "" : `，『${l.prototype}』做了 ${l.done_days} 天`)}
              </Body>
            </>
          )}
        </Card>
      ))}
    </Screen>
  );
}
