/** 时间 / 日期选择：显示成一个大数字块，点开系统选择器，不手打。网页版见 time-field.web.tsx（两个文件的属性要一致）。 */
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Text, View, ViewStyle, StyleProp } from "react-native";

import { haptic, Pressy } from "@/components/motion";
import { radius, space, type, useColors, useDark } from "@/theme";

export type PickFieldProps = {
  label: string;
  /** 时间 "HH:MM"，日期 "YYYY-MM-DD"；空串 = 没填 */
  value: string;
  mode: "time" | "date";
  onChange: (v: string) => void;
  /** 给了就在有值时显示「清除」，点了回调 */
  onClear?: () => void;
  /** 没填时选择器从哪开始（同 value 的格式） */
  initial?: string;
  style?: StyleProp<ViewStyle>;
};

const pad = (n: number) => String(n).padStart(2, "0");

function toDate(v: string, mode: "time" | "date"): Date {
  const d = new Date();
  if (!v) return d;
  const [a, b, c] = v.split("-").length === 3 ? v.split("-").map(Number) : v.split(":").map(Number);
  if (mode === "date") return new Date(a, b - 1, c);
  d.setHours(a, b, 0, 0);
  return d;
}

const fromDate = (d: Date, mode: "time" | "date") =>
  mode === "time" ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function PickField({ label, value, mode, onChange, onClear, initial, style }: PickFieldProps) {
  const c = useColors();
  const dark = useDark();
  const [open, setOpen] = useState(false); // 只有 iOS 用：选择器直接摊在块下面
  const current = toDate(value || initial || (mode === "time" ? "09:00" : ""), mode);

  function press() {
    haptic.select();
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({ value: current, mode, is24Hour: true,
        onChange: (e, d) => { if (e.type === "set" && d) onChange(fromDate(d, mode)); } });
    } else setOpen((o) => !o);
  }

  return (
    <View style={[{ gap: space.xs }, style]}>
      <Text style={[type.small, { color: c.muted }]}>{label}</Text>
      <Pressy onPress={press} accessibilityRole="button" accessibilityLabel={`${label} ${value || "没填"}`} scaleTo={0.98}
        style={{ minHeight: 52, backgroundColor: c.sunken, borderRadius: radius.md, paddingHorizontal: space.lg,
          flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm,
          borderWidth: 1.5, borderColor: open ? c.primary : "transparent" }}>
        <Text style={[type.stat, { color: value ? c.text : c.muted }]}>{value || (mode === "time" ? "--:--" : "不填")}</Text>
        {onClear && !!value && (
          <Pressy onPress={() => { setOpen(false); onClear(); }} accessibilityRole="button" accessibilityLabel={`清除${label}`} hitSlop={8}>
            <Text style={[type.label, { color: c.primary }]}>清除</Text>
          </Pressy>
        )}
      </Pressy>
      {open && Platform.OS === "ios" && (
        <DateTimePicker value={current} mode={mode} display="spinner" is24Hour themeVariant={dark ? "dark" : "light"}
          onChange={(_, d) => { if (d) onChange(fromDate(d, mode)); }} />
      )}
    </View>
  );
}
