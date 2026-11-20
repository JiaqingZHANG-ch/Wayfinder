import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Country, Me, putMe } from "@/api";

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
    <View style={styles.card}>
      <Text style={styles.title}>{filledBefore ? "隐私说明更新了，请再看一遍" : "开始之前，看一下数据怎么用"}</Text>
      <Text style={styles.privacy}>{me.privacy.text}</Text>
      <Text style={styles.label}>你现在在哪个国家？（遇到危险时显示当地的求助电话）</Text>
      <View style={styles.choices}>
        {COUNTRIES.map(([code, name]) => (
          <Pressable key={name} onPress={() => setCountry(code)} accessibilityRole="radio"
            accessibilityState={{ checked: country === code }}
            style={[styles.choice, country === code && styles.chosen]}>
            <Text style={country === code ? styles.chosenText : undefined}>{name}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => setAdult(!adult)} accessibilityRole="checkbox" accessibilityState={{ checked: adult }}
        style={[styles.choice, adult && styles.chosen]}>
        <Text style={adult ? styles.chosenText : undefined}>{adult ? "✓ " : ""}我已经年满 18 岁</Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable onPress={agree} disabled={busy} accessibilityRole="button"
        style={[styles.button, busy && { opacity: 0.5 }]}>
        <Text style={styles.buttonText}>同意，开始</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  title: { fontSize: 18, fontWeight: "500" },
  privacy: { lineHeight: 22, color: "#3c4043" },
  label: { color: "#3c4043" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { borderWidth: 1, borderColor: "#dadce0", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
    alignSelf: "flex-start" },
  chosen: { backgroundColor: "#1a73e8", borderColor: "#1a73e8" },
  chosenText: { color: "#fff" },
  error: { color: "#b3261e" },
  button: { backgroundColor: "#1a73e8", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 16 },
});
