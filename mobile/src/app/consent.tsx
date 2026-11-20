import { router } from "expo-router";
import { useEffect, useState } from "react";

import { getMe, Me } from "@/api";
import { Consent } from "@/components/consent";
import { Loading, Notice, Screen } from "@/components/ui";

/** 隐私说明换了新版本时，老用户先在这一页看完、同意，才回到今天。没有标签栏，也不能滑走。 */
export default function ConsentScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMe().then(setMe, (e: Error) => setError(e.message));
  }, []);

  if (!me) return error ? <Screen safeTop><Notice tone="error">{error}</Notice></Screen> : <Loading text="……" safeTop />;
  return (
    <Screen safeTop>
      <Consent me={me} onDone={(m) => (m.consented ? router.replace("/") : setMe(m))} />
    </Screen>
  );
}
