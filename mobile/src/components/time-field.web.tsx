/** 网页版：用浏览器自带的 <input type="time|date">，样式贴合令牌。属性和 time-field.tsx 一致。 */
import { createElement, useState } from "react";
import { StyleProp, Text, View, ViewStyle } from "react-native";

import { Pressy } from "@/components/motion";
import { radius, space, type, useColors, useDark } from "@/theme";

export type PickFieldProps = {
  label: string;
  value: string;
  mode: "time" | "date";
  onChange: (v: string) => void;
  onClear?: () => void;
  initial?: string;
  style?: StyleProp<ViewStyle>;
};

export function PickField({ label, value, mode, onChange, onClear, style }: PickFieldProps) {
  const c = useColors();
  const dark = useDark();
  const [focus, setFocus] = useState(false);
  return (
    <View style={[{ gap: space.xs }, style]}>
      <Text style={[type.small, { color: c.muted }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        {createElement("input", {
          type: mode, value, "aria-label": label,
          onChange: (e: { target: { value: string } }) => onChange(e.target.value),
          onFocus: () => setFocus(true), onBlur: () => setFocus(false),
          // 和 Field 一样的字号；minWidth 0 让两个并排的框能缩，不然浏览器按内容撑宽、两框挤在一起
          style: { flex: 1, minWidth: 0, width: "100%", minHeight: 52, boxSizing: "border-box", backgroundColor: c.sunken, color: c.text,
            borderRadius: radius.md, padding: `0 ${space.lg}px`, border: `1.5px solid ${focus ? c.primary : "transparent"}`,
            outline: "none", fontFamily: type.num.fontFamily, fontSize: type.body.fontSize,
            fontVariantNumeric: "tabular-nums", colorScheme: dark ? "dark" : "light" },
        })}
        {onClear && !!value && (
          <Pressy onPress={onClear} accessibilityRole="button" accessibilityLabel={`清除${label}`} hitSlop={8}>
            <Text style={[type.label, { color: c.primary }]}>清除</Text>
          </Pressy>
        )}
      </View>
    </View>
  );
}
