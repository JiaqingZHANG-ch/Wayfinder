import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { getMe, Me } from "@/api";
import { Skeleton } from "@/components/motion";
import { Body, Card, ErrorState, Header, Screen } from "@/components/ui";
import { radius } from "@/theme";

/** 隐私说明全文（只读）：第一次同意之后，从「我」页随时能再看。文字来自后端，和同意时看的是同一份。 */
export default function PrivacyScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => { getMe().then((m) => { setMe(m); setError(false); }, () => setError(true)); }, []);
  useFocusEffect(load);
  return (
    <Screen safeTop>
      <Header title="隐私说明" sub={me ? `版本 ${me.privacy.version}` : undefined} />
      {error && !me ? <ErrorState onRetry={load} />
        : !me ? <Skeleton height={320} r={radius.lg} />
        : <Card><Body muted>{me.privacy.text}</Body></Card>}
    </Screen>
  );
}
