import { router } from "expo-router";
import { useEffect, useState } from "react";

import { getMe, Me } from "@/api";
import { Consent } from "@/components/consent";
import { Skeleton } from "@/components/motion";
import { ErrorState, Screen } from "@/components/ui";
import { radius } from "@/theme";

/** 隐私说明换了新版本时，老用户先在这一页看完、同意，才回到今天。必须先同意，所以没有返回，也不能滑走。 */
export default function ConsentScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);

  function load() {
    getMe().then(setMe, () => setFailed(true));
  }
  useEffect(load, []);

  if (failed) return <Screen safeTop><ErrorState onRetry={() => { setFailed(false); load(); }} /></Screen>;
  if (!me) {
    return (
      <Screen safeTop scroll={false}>
        <Skeleton height={36} width="80%" />
        <Skeleton height={160} r={radius.lg} />
        <Skeleton height={28} width="60%" />
      </Screen>
    );
  }
  return (
    <Screen safeTop>
      <Consent me={me} onDone={(m) => (m.consented ? router.replace("/") : setMe(m))} />
    </Screen>
  );
}
